import { and, count, desc, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AddAdminGiftCardStockBody,
  AddAdminGiftCardStockParams,
  AddAdminGiftCardStockResponse,
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
  const pin = card.pin?.trim() || null;
  const email = card.email?.trim() || null;
  const phone = card.phone?.trim() || null;
  const phoneDigits = phone?.replace(/\D/g, "") ?? "";
  if (
    !/^\d{13,19}$/.test(cardNumber) ||
    !expirationMatch ||
    !/^\d{3,4}$/.test(card.securityCode) ||
    (pin !== null && !/^\d{3,16}$/.test(pin)) ||
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
    pin,
    email,
    phone,
  };
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
    .orderBy(desc(giftCardOrdersTable.createdAt))
    .limit(100);

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
  const cardType = parsed.data.cardType.trim();
  const issuer = parsed.data.issuer.trim();
  const brand = parsed.data.brand.trim();
  if (!name || !cardType || !issuer || !brand) {
    res.status(400).json({
      error: "Product name, card type, issuer, and brand cannot be blank.",
    });
    return;
  }

  const [created] = await db
    .insert(giftCardProductsTable)
    .values({
      name,
      description,
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
    if (!cardType || !issuer || !brand) {
      res.status(400).json({
        error: "Card type, issuer, and brand cannot be blank.",
      });
      return;
    }

    const [updated] = await db
      .update(giftCardProductsTable)
      .set({
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
          "Check each card's number, expiration (MM/YY), security code, and optional numeric PIN.",
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
      return { kind: "success" as const, availableCount: inserted.length };
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

    res.json(
      AddAdminGiftCardStockResponse.parse({
        addedCount: values.length,
        availableCount: stockResult.availableCount,
      }),
    );
  },
);

export default router;