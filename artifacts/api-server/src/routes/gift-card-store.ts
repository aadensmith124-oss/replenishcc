import { and, count, desc, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AddAdminGiftCardStockBody,
  AddAdminGiftCardStockParams,
  AddAdminGiftCardStockResponse,
  BulkPurchaseGiftCardsBody,
  BulkPurchaseGiftCardsResponse,
  CreateAdminGiftCardProductBody,
  CreateAdminGiftCardProductResponse,
  DeleteAdminGiftCardProductParams,
  GetAdminGiftCardProductsResponse,
  GetGiftCardProductsResponse,
  GetMyGiftCardOrdersResponse,
  PurchaseGiftCardBody,
  PurchaseGiftCardResponse,
  UpdateAdminGiftCardProductMetadataBody,
  UpdateAdminGiftCardProductMetadataParams,
} from "@workspace/api-zod";
import {
  accountLedgerTable,
  db,
  giftCardInventoryTable,
  giftCardOrdersTable,
  giftCardProductsTable,
  usersTable,
} from "@workspace/db";
import { getCurrentUser, isDepositAdmin } from "../lib/auth";
import {
  decryptGiftCardCredential,
  encryptGiftCardCredential,
  hashGiftCardCredential,
  type GiftCardCredential,
} from "../lib/gift-card-credentials";

const router: IRouter = Router();

async function listProducts(includeStockEligibility = false) {
  const availableCount = count(giftCardInventoryTable.id);
  const products = await db
    .select({
      id: giftCardProductsTable.id,
      name: giftCardProductsTable.name,
      description: giftCardProductsTable.description,
      address: giftCardProductsTable.address,
      state: giftCardProductsTable.state,
      city: giftCardProductsTable.city,
      regionZip: giftCardProductsTable.regionZip,
      cardType: giftCardProductsTable.cardType,
      issuer: giftCardProductsTable.issuer,
      brand: giftCardProductsTable.brand,
      faceValueCents: giftCardProductsTable.faceValueCents,
      priceCents: giftCardProductsTable.priceCents,
      availableCount,
      hasEmail: sql<boolean>`coalesce(bool_or(${giftCardInventoryTable.hasEmail}), false)`,
      hasPhone: sql<boolean>`coalesce(bool_or(${giftCardInventoryTable.hasPhone}), false)`,
      createdAt: giftCardProductsTable.createdAt,
    })
    .from(giftCardProductsTable)
    .leftJoin(
      giftCardInventoryTable,
      and(
        eq(giftCardInventoryTable.productId, giftCardProductsTable.id),
        eq(giftCardInventoryTable.status, "available"),
      ),
    )
    .groupBy(giftCardProductsTable.id)
    .orderBy(desc(giftCardProductsTable.createdAt));

  const productIds = products.map((product) => product.id);
  const [inventoryHistory, orderHistory] =
    includeStockEligibility && productIds.length
      ? await Promise.all([
          db
            .select({ productId: giftCardInventoryTable.productId })
            .from(giftCardInventoryTable)
            .where(inArray(giftCardInventoryTable.productId, productIds)),
          db
            .select({ productId: giftCardOrdersTable.productId })
            .from(giftCardOrdersTable)
            .where(inArray(giftCardOrdersTable.productId, productIds)),
        ])
      : [[], []];
  const blockedProductIds = new Set([
    ...inventoryHistory.map((item) => item.productId),
    ...orderHistory.map((order) => order.productId),
  ]);

  return products.map((product) => ({
    ...product,
    ...(includeStockEligibility
      ? { canReceiveStock: !blockedProductIds.has(product.id) }
      : {}),
    createdAt: product.createdAt.toISOString(),
  }));
}

function normalizeCredential(
  card: GiftCardCredential,
): GiftCardCredential | null {
  const cardNumber = card.cardNumber.replace(/\s/g, "");
  const expiration = card.expiration.trim().replace("-", "/");
  const expirationMatch = /^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/.exec(expiration);
  const email = card.email?.trim() || null;
  const phone = card.phone?.trim() || null;
  const phoneDigits = phone?.replace(/\D/g, "") ?? "";
  if (
    !/^\d{13,19}$/.test(cardNumber) ||
    !expirationMatch ||
    !/^\d{3,4}$/.test(card.securityCode) ||
    (email !== null &&
      (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
    (phone !== null &&
      (phone.length > 40 ||
        !/^\+?[\d\s().-]+$/.test(phone) ||
        phoneDigits.length < 10 ||
        phoneDigits.length > 15))
  ) {
    return null;
  }
  return {
    cardNumber,
    expiration,
    securityCode: card.securityCode,
    email,
    phone,
  };
}

type DetectedBinMetadata = {
  cardType: string | null;
  issuer: string | null;
  brand: string | null;
};

type BinLookupResult =
  | { kind: "found"; metadata: DetectedBinMetadata }
  | { kind: "not_found" }
  | { kind: "unavailable"; status?: number };

function cleanBinLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned && cleaned.length <= 80 ? cleaned : null;
}

async function lookupBinMetadata(bin: string): Promise<BinLookupResult> {
  try {
    const response = await fetch(`https://lookup.binlist.net/${bin}`, {
      headers: {
        Accept: "application/json",
        "Accept-Version": "3",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 404) return { kind: "not_found" };
    if (!response.ok) return { kind: "unavailable", status: response.status };

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "not_found" };
    }
    const data = payload as Record<string, unknown>;
    const bank =
      data.bank && typeof data.bank === "object" && !Array.isArray(data.bank)
        ? (data.bank as Record<string, unknown>)
        : null;
    const rawType = cleanBinLabel(data.type);
    const typeLabel = rawType
      ? rawType.charAt(0).toUpperCase() + rawType.slice(1)
      : null;
    const cardType = [
      data.prepaid === true ? "Prepaid" : null,
      typeLabel,
    ]
      .filter((part): part is string => part !== null)
      .join(" ");
    const metadata: DetectedBinMetadata = {
      cardType: cardType || null,
      issuer: cleanBinLabel(bank?.name),
      brand: cleanBinLabel(data.brand) ?? cleanBinLabel(data.scheme),
    };
    return Object.values(metadata).some(Boolean)
      ? { kind: "found", metadata }
      : { kind: "not_found" };
  } catch {
    return { kind: "unavailable" };
  }
}

router.get("/gift-card-products", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to browse gift cards." });
    return;
  }
  const products = await listProducts();
  res.json(GetGiftCardProductsResponse.parse({ products }));
});

router.get("/orders/gift-cards", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view your gift-card orders." });
    return;
  }

  const orders = await db
    .select()
    .from(giftCardOrdersTable)
    .where(eq(giftCardOrdersTable.userId, user.id))
    .orderBy(desc(giftCardOrdersTable.createdAt));

  const orderIds = orders.map((order) => order.id);
  const inventory = orderIds.length
    ? await db
        .select()
        .from(giftCardInventoryTable)
        .where(
          and(
            inArray(giftCardInventoryTable.orderId, orderIds),
            eq(giftCardInventoryTable.status, "sold"),
          ),
        )
        .orderBy(giftCardInventoryTable.createdAt)
    : [];
  const cardsByOrder = new Map<string, GiftCardCredential[]>();
  for (const item of inventory) {
    if (!item.orderId) continue;
    const cards = cardsByOrder.get(item.orderId) ?? [];
    cards.push(decryptGiftCardCredential(item));
    cardsByOrder.set(item.orderId, cards);
  }

  res.json(
    GetMyGiftCardOrdersResponse.parse({
      orders: orders.map((order) => ({
        id: order.id,
        productId: order.productId,
        productName: order.productName,
        description: order.description,
        faceValueCents: order.faceValueCents,
        quantity: order.quantity,
        unitPriceCents: order.unitPriceCents,
        totalCents: order.totalCents,
        deliveredCards: cardsByOrder.get(order.id) ?? [],
        createdAt: order.createdAt.toISOString(),
      })),
    }),
  );
});

router.post("/orders/gift-cards", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to purchase a gift card." });
    return;
  }

  const parsed = PurchaseGiftCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid product and quantity." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .for("update")
      .limit(1);

    const [product] = await tx
      .select()
      .from(giftCardProductsTable)
      .where(eq(giftCardProductsTable.id, parsed.data.productId))
      .limit(1);
    if (!product) return { kind: "missing" as const };

    const totalCents = product.priceCents * parsed.data.quantity;
    const [balanceRow] = await tx
      .select({ balanceCents: sum(accountLedgerTable.amountCents) })
      .from(accountLedgerTable)
      .where(eq(accountLedgerTable.userId, user.id));
    const balanceCents = Number(balanceRow?.balanceCents ?? 0);
    if (balanceCents < totalCents) {
      return { kind: "balance" as const };
    }

    const stock = await tx
      .select()
      .from(giftCardInventoryTable)
      .where(
        and(
          eq(giftCardInventoryTable.productId, product.id),
          eq(giftCardInventoryTable.status, "available"),
          isNull(giftCardInventoryTable.orderId),
        ),
      )
      .orderBy(giftCardInventoryTable.createdAt)
      .limit(parsed.data.quantity)
      .for("update", { skipLocked: true });
    if (stock.length < parsed.data.quantity) {
      return { kind: "stock" as const };
    }

    const [order] = await tx
      .insert(giftCardOrdersTable)
      .values({
        userId: user.id,
        productId: product.id,
        productName: product.name,
        description: product.description,
        faceValueCents: product.faceValueCents,
        quantity: parsed.data.quantity,
        unitPriceCents: product.priceCents,
        totalCents,
      })
      .returning();
    if (!order) throw new Error("Gift-card order creation failed.");

    await tx
      .update(giftCardInventoryTable)
      .set({ status: "sold", orderId: order.id, soldAt: order.createdAt })
      .where(
        inArray(
          giftCardInventoryTable.id,
          stock.map((item) => item.id),
        ),
      );

    if (totalCents > 0) {
      await tx.insert(accountLedgerTable).values({
        userId: user.id,
        depositId: null,
        redeemCodeId: null,
        supportRefundId: null,
        orderId: null,
        giftCardOrderId: order.id,
        entryType: "gift_card_purchase",
        amountCents: -totalCents,
      });
    }

    return {
      kind: "success" as const,
      balanceCents: balanceCents - totalCents,
      order: {
        id: order.id,
        productId: order.productId,
        productName: order.productName,
        description: order.description,
        faceValueCents: order.faceValueCents,
        quantity: order.quantity,
        unitPriceCents: order.unitPriceCents,
        totalCents: order.totalCents,
        deliveredCards: stock.map((item) => decryptGiftCardCredential(item)),
        createdAt: order.createdAt.toISOString(),
      },
    };
  });

  if (result.kind === "missing") {
    res.status(404).json({ error: "That gift card is not available." });
    return;
  }
  if (result.kind === "balance") {
    res.status(409).json({
      error: "Your account balance is too low for this purchase.",
    });
    return;
  }
  if (result.kind === "stock") {
    res.status(409).json({
      error: "There is not enough gift-card stock for that quantity.",
    });
    return;
  }

  res
    .status(201)
    .json(
      PurchaseGiftCardResponse.parse({
        order: result.order,
        balanceCents: result.balanceCents,
      }),
    );
});

router.post("/orders/gift-cards/bulk", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to purchase gift cards." });
    return;
  }

  const parsed = BulkPurchaseGiftCardsBody.safeParse(req.body);
  if (!parsed.success || new Set(parsed.data?.productIds ?? []).size !== parsed.data?.productIds.length) {
    res.status(400).json({ error: "Choose one or more different gift-card listings." });
    return;
  }

  const productIds = parsed.data.productIds;
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .for("update")
      .limit(1);

    const selectedProducts = await tx
      .select()
      .from(giftCardProductsTable)
      .where(inArray(giftCardProductsTable.id, productIds))
      .orderBy(giftCardProductsTable.id)
      .for("update");
    if (selectedProducts.length !== productIds.length) {
      return { kind: "missing" as const };
    }

    const productsById = new Map(selectedProducts.map((product) => [product.id, product]));
    const purchaseProducts = productIds.map((productId) => productsById.get(productId)!);
    const totalCents = purchaseProducts.reduce((total, product) => total + product.priceCents, 0);
    const [balanceRow] = await tx
      .select({ balanceCents: sum(accountLedgerTable.amountCents) })
      .from(accountLedgerTable)
      .where(eq(accountLedgerTable.userId, user.id));
    const balanceCents = Number(balanceRow?.balanceCents ?? 0);
    if (balanceCents < totalCents) {
      return { kind: "balance" as const };
    }

    const stockByProduct = new Map<string, (typeof giftCardInventoryTable.$inferSelect)>();
    for (const productId of [...productIds].sort()) {
      const [stock] = await tx
        .select()
        .from(giftCardInventoryTable)
        .where(
          and(
            eq(giftCardInventoryTable.productId, productId),
            eq(giftCardInventoryTable.status, "available"),
            isNull(giftCardInventoryTable.orderId),
          ),
        )
        .orderBy(giftCardInventoryTable.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!stock) return { kind: "stock" as const };
      stockByProduct.set(productId, stock);
    }

    const orders = [];
    for (const product of purchaseProducts) {
      const stock = stockByProduct.get(product.id);
      if (!stock) throw new Error("Selected gift-card stock was not locked.");

      const [order] = await tx
        .insert(giftCardOrdersTable)
        .values({
          userId: user.id,
          productId: product.id,
          productName: product.name,
          description: product.description,
          faceValueCents: product.faceValueCents,
          quantity: 1,
          unitPriceCents: product.priceCents,
          totalCents: product.priceCents,
        })
        .returning();
      if (!order) throw new Error("Gift-card order creation failed.");

      await tx
        .update(giftCardInventoryTable)
        .set({ status: "sold", orderId: order.id, soldAt: order.createdAt })
        .where(eq(giftCardInventoryTable.id, stock.id));

      if (order.totalCents > 0) {
        await tx.insert(accountLedgerTable).values({
          userId: user.id,
          depositId: null,
          redeemCodeId: null,
          supportRefundId: null,
          orderId: null,
          giftCardOrderId: order.id,
          entryType: "gift_card_purchase",
          amountCents: -order.totalCents,
        });
      }

      orders.push({
        id: order.id,
        productId: order.productId,
        productName: order.productName,
        totalCents: order.totalCents,
        createdAt: order.createdAt.toISOString(),
      });
    }

    return {
      kind: "success" as const,
      totalCents,
      balanceCents: balanceCents - totalCents,
      orders,
    };
  });

  if (result.kind === "missing") {
    res.status(404).json({ error: "One or more selected listings are no longer available." });
    return;
  }
  if (result.kind === "balance") {
    res.status(409).json({ error: "Your account balance is too low for this selection." });
    return;
  }
  if (result.kind === "stock") {
    res.status(409).json({ error: "One or more selected cards are no longer in stock." });
    return;
  }

  res.status(201).json(
    BulkPurchaseGiftCardsResponse.parse({
      orders: result.orders,
      totalCents: result.totalCents,
      balanceCents: result.balanceCents,
    }),
  );
});

router.get("/admin/gift-card-products", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage gift-card products." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const products = await listProducts(true);
  res.json(GetAdminGiftCardProductsResponse.parse({ products }));
});

router.post("/admin/gift-card-products", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to create gift-card products." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const parsed = CreateAdminGiftCardProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter valid gift-card product details." });
    return;
  }
  const name = parsed.data.name.trim();
  const description = parsed.data.description.trim();
  const address = parsed.data.address?.trim() ?? "";
  const state = parsed.data.state?.trim() ?? "";
  const city = parsed.data.city?.trim() ?? "";
  const cardType = parsed.data.cardType?.trim() ?? "";
  const issuer = parsed.data.issuer?.trim() ?? "";
  const brand = parsed.data.brand?.trim() ?? "";
  if (!name) {
    res.status(400).json({
      error: "Product name cannot be blank.",
    });
    return;
  }

  const [created] = await db
    .insert(giftCardProductsTable)
    .values({
      name,
      description,
      address,
      state,
      city,
      regionZip: parsed.data.regionZip,
      cardType,
      issuer,
      brand,
      faceValueCents: parsed.data.faceValueCents,
      priceCents: parsed.data.priceCents,
      createdByUserId: user.id,
    })
    .returning();
  if (!created) throw new Error("Gift-card product creation failed.");

  res.status(201).json(
    CreateAdminGiftCardProductResponse.parse({
      id: created.id,
      name: created.name,
      description: created.description,
      address: created.address,
      state: created.state,
      city: created.city,
      regionZip: created.regionZip,
      cardType: created.cardType,
      issuer: created.issuer,
      brand: created.brand,
      faceValueCents: created.faceValueCents,
      priceCents: created.priceCents,
      availableCount: 0,
      hasEmail: false,
      hasPhone: false,
      createdAt: created.createdAt.toISOString(),
    }),
  );
});

router.patch(
  "/admin/gift-card-products/:productId/metadata",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to update a gift-card listing." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = UpdateAdminGiftCardProductMetadataParams.safeParse(
      req.params,
    );
    const parsed = UpdateAdminGiftCardProductMetadataBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Enter valid gift-card listing metadata." });
      return;
    }
    const cardType = parsed.data.cardType.trim();
    const issuer = parsed.data.issuer.trim();
    const brand = parsed.data.brand.trim();
    const address = parsed.data.address.trim();
    const state = parsed.data.state.trim();
    const city = parsed.data.city.trim();
    if (!cardType || !issuer || !brand) {
      res.status(400).json({
        error: "Card type, issuer, and brand cannot be blank.",
      });
      return;
    }

    const [updated] = await db
      .update(giftCardProductsTable)
      .set({
        address,
        state,
        city,
        regionZip: parsed.data.regionZip,
        cardType,
        issuer,
        brand,
      })
      .where(eq(giftCardProductsTable.id, params.data.productId))
      .returning({ id: giftCardProductsTable.id });
    if (!updated) {
      res.status(404).json({ error: "Gift-card product not found." });
      return;
    }
    res.status(204).end();
  },
);

router.delete(
  "/admin/gift-card-products/:productId",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to delete gift-card products." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = DeleteAdminGiftCardProductParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid product." });
      return;
    }
    const [product] = await db
      .select({ id: giftCardProductsTable.id })
      .from(giftCardProductsTable)
      .where(eq(giftCardProductsTable.id, params.data.productId))
      .limit(1);
    if (!product) {
      res.status(404).json({ error: "Gift-card product not found." });
      return;
    }

    const [orders, inventory] = await Promise.all([
      db
        .select({ count: count() })
        .from(giftCardOrdersTable)
        .where(eq(giftCardOrdersTable.productId, product.id)),
      db
        .select({ count: count() })
        .from(giftCardInventoryTable)
        .where(eq(giftCardInventoryTable.productId, product.id)),
    ]);
    if (
      Number(orders[0]?.count ?? 0) > 0 ||
      Number(inventory[0]?.count ?? 0) > 0
    ) {
      res.status(409).json({
        error: "This product has stock or order history and cannot be deleted.",
      });
      return;
    }

    const [deleted] = await db
      .delete(giftCardProductsTable)
      .where(eq(giftCardProductsTable.id, product.id))
      .returning({ id: giftCardProductsTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Gift-card product not found." });
      return;
    }
    res.status(204).end();
  },
);

router.post(
  "/admin/gift-card-products/:productId/stock",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to upload gift-card stock." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = AddAdminGiftCardStockParams.safeParse(req.params);
    const parsed = AddAdminGiftCardStockBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Enter a valid gift-card batch." });
      return;
    }
    const cards = parsed.data.cards.map(normalizeCredential);
    if (cards.some((card) => card === null)) {
      res.status(400).json({
        error:
          "Check each card's number, expiration (MM/YY), security code, and optional email or phone.",
      });
      return;
    }
    const credentials = cards as GiftCardCredential[];
    if (credentials.length !== 1) {
      res.status(400).json({
        error:
          "Upload exactly one card per listing. Create a new listing for each card.",
      });
      return;
    }
    const hashes = credentials.map(hashGiftCardCredential);
    if (new Set(hashes).size !== hashes.length) {
      res.status(400).json({
        error: "Remove duplicate cards from the batch before uploading it.",
      });
      return;
    }

    const address = parsed.data.address?.trim() ?? null;
    const state = parsed.data.state?.trim() ?? null;
    const city = parsed.data.city?.trim() ?? null;
    const redemptionRegionZip = parsed.data.redemptionRegionZip ?? null;
    const values = credentials.map((credential) => ({
      productId: params.data.productId,
      hasEmail: Boolean(credential.email),
      hasPhone: Boolean(credential.phone),
      ...encryptGiftCardCredential(credential),
    }));
    const stockResult = await db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: giftCardProductsTable.id })
        .from(giftCardProductsTable)
        .where(eq(giftCardProductsTable.id, params.data.productId))
        .for("update")
        .limit(1);
      if (!product) return { kind: "missing" as const };

      const [existingInventory, existingOrder] = await Promise.all([
        tx
          .select({ id: giftCardInventoryTable.id })
          .from(giftCardInventoryTable)
          .where(eq(giftCardInventoryTable.productId, product.id))
          .limit(1),
        tx
          .select({ id: giftCardOrdersTable.id })
          .from(giftCardOrdersTable)
          .where(eq(giftCardOrdersTable.productId, product.id))
          .limit(1),
      ]);
      if (existingInventory.length > 0 || existingOrder.length > 0) {
        return { kind: "ineligible" as const };
      }

      const inserted = await tx
        .insert(giftCardInventoryTable)
        .values(values)
        .onConflictDoNothing({
          target: giftCardInventoryTable.credentialHash,
        })
        .returning({ id: giftCardInventoryTable.id });
      if (inserted.length !== values.length) {
        return { kind: "duplicate" as const };
      }
      return {
        kind: "success" as const,
        availableCount: inserted.length,
      };
    });

    if (stockResult.kind === "missing") {
      res.status(404).json({ error: "Gift-card product not found." });
      return;
    }
    if (stockResult.kind === "ineligible") {
      res.status(409).json({
        error:
          "This listing already has or previously had inventory or orders. Create a new listing for each card.",
      });
      return;
    }
    if (stockResult.kind === "duplicate") {
      res.status(409).json({
        error: "One or more cards already exist in the inventory.",
      });
      return;
    }

    // Only disclose a card's BIN prefix to the public lookup after stock was accepted.
    const binLookup = await lookupBinMetadata(credentials[0]!.cardNumber.slice(0, 8));
    if (binLookup.kind === "unavailable") {
      req.log.warn(
        { status: binLookup.status },
        "Public BIN lookup was unavailable; existing product metadata was kept.",
      );
    }
    const metadataChanges: {
      address?: string;
      state?: string;
      city?: string;
      regionZip?: string;
      cardType?: string;
      issuer?: string;
      brand?: string;
    } = {};
    if (address) metadataChanges.address = address;
    if (state) metadataChanges.state = state;
    if (city) metadataChanges.city = city;
    if (redemptionRegionZip) metadataChanges.regionZip = redemptionRegionZip;
    if (binLookup.kind === "found") {
      if (binLookup.metadata.cardType) {
        metadataChanges.cardType = binLookup.metadata.cardType;
      }
      if (binLookup.metadata.issuer) {
        metadataChanges.issuer = binLookup.metadata.issuer;
      }
      if (binLookup.metadata.brand) {
        metadataChanges.brand = binLookup.metadata.brand;
      }
    }
    let metadataSaved = false;
    if (Object.keys(metadataChanges).length > 0) {
      try {
        const [updated] = await db
          .update(giftCardProductsTable)
          .set(metadataChanges)
          .where(eq(giftCardProductsTable.id, params.data.productId))
          .returning({ id: giftCardProductsTable.id });
        metadataSaved = Boolean(updated);
      } catch {
        req.log.error("Automatic gift-card metadata could not be saved.");
      }
    }
    res.json(
      AddAdminGiftCardStockResponse.parse({
        addedCount: values.length,
        availableCount: stockResult.availableCount,
        binMetadataApplied: metadataSaved && binLookup.kind === "found",
        redemptionZipApplied: metadataSaved && redemptionRegionZip !== null,
        locationMetadataApplied:
          metadataSaved && Boolean(address || state || city),
      }),
    );
  },
);

export default router;