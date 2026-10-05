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
  DeleteAdminGiftCardProductResponse,
  GetAdminGiftCardProductsResponse,
  GetGiftCardProductsResponse,
  GetMyGiftCardOrdersResponse,
  PurchaseGiftCardBody,
  PurchaseGiftCardResponse,
  RefreshAdminGiftCardBinMetadataParams,
  RefreshAdminGiftCardBinMetadataResponse,
  RestoreAdminGiftCardProductParams,
  UpdateAdminGiftCardProductMetadataBody,
  UpdateAdminGiftCardProductMetadataParams,
  type AvailableGiftCardLocation,
  type GiftCardPublicLocation,
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
import { requireMemberPage } from "../lib/member-page-visibility";
import {
  decryptGiftCardCredential,
  encryptGiftCardCredential,
  getGiftCardBinPrefix,
  getGiftCardBinMetadataPrefix,
  getGiftCardLastFour,
  hashGiftCardCredential,
  type GiftCardCredential,
} from "../lib/gift-card-credentials";

const router: IRouter = Router();
const MAX_AVAILABLE_CARDS_PER_BASE = 1_000;

let perCardBinMetadataSupportCache: {
  supported: boolean;
  checkedAt: number;
} | null = null;

async function supportsPerCardBinMetadata(): Promise<boolean> {
  if (
    perCardBinMetadataSupportCache &&
    Date.now() - perCardBinMetadataSupportCache.checkedAt < 30_000
  ) {
    return perCardBinMetadataSupportCache.supported;
  }
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*)::integer AS count
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'gift_card_inventory'
        AND column_name IN ('card_type', 'issuer', 'brand')
    `);
    const row = result.rows[0] as { count?: number | string } | undefined;
    const supported = Number(row?.count ?? 0) === 3;
    perCardBinMetadataSupportCache = { supported, checkedAt: Date.now() };
    return supported;
  } catch {
    perCardBinMetadataSupportCache = {
      supported: false,
      checkedAt: Date.now(),
    };
    return false;
  }
}

let perCardPublicAddressSupportCache: {
  supported: boolean;
  checkedAt: number;
} | null = null;

async function supportsPerCardPublicAddress(): Promise<boolean> {
  if (
    perCardPublicAddressSupportCache &&
    Date.now() - perCardPublicAddressSupportCache.checkedAt < 30_000
  ) {
    return perCardPublicAddressSupportCache.supported;
  }
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*)::integer AS count
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'gift_card_inventory'
        AND column_name = 'public_address'
    `);
    const row = result.rows[0] as { count?: number | string } | undefined;
    const supported = Number(row?.count ?? 0) === 1;
    perCardPublicAddressSupportCache = { supported, checkedAt: Date.now() };
    return supported;
  } catch {
    perCardPublicAddressSupportCache = {
      supported: false,
      checkedAt: Date.now(),
    };
    return false;
  }
}

async function listProducts({
  includeStockEligibility = false,
  includeArchived = false,
  includeBins = false,
  includeBaseAddress = false,
}: {
  includeStockEligibility?: boolean;
  includeArchived?: boolean;
  includeBins?: boolean;
  includeBaseAddress?: boolean;
} = {}) {
  const hasPerCardMetadata = await supportsPerCardBinMetadata();
  const cardTypeMetadata = hasPerCardMetadata
    ? sql`COALESCE(${giftCardInventoryTable.cardType}, ${giftCardProductsTable.cardType})`
    : sql`${giftCardProductsTable.cardType}`;
  const issuerMetadata = hasPerCardMetadata
    ? sql`COALESCE(${giftCardInventoryTable.issuer}, ${giftCardProductsTable.issuer})`
    : sql`${giftCardProductsTable.issuer}`;
  const brandMetadata = hasPerCardMetadata
    ? sql`COALESCE(${giftCardInventoryTable.brand}, ${giftCardProductsTable.brand})`
    : sql`${giftCardProductsTable.brand}`;
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
      isArchived: giftCardProductsTable.isArchived,
      availableCount,
      availableCardLocations: sql<Omit<AvailableGiftCardLocation, "bin" | "lastFour">[]>`
        COALESCE(
          json_agg(
            json_build_object(
              'inventoryId', ${giftCardInventoryTable.id},
              'cardType', ${cardTypeMetadata},
              'issuer', ${issuerMetadata},
              'brand', ${brandMetadata},
              'cardholderName', null,
              'city', COALESCE(${giftCardInventoryTable.publicCity}, ${giftCardProductsTable.city}),
              'state', COALESCE(${giftCardInventoryTable.publicState}, ${giftCardProductsTable.state}),
              'regionZip', COALESCE(${giftCardInventoryTable.publicRegionZip}, ${giftCardProductsTable.regionZip}),
              'hasEmail', ${giftCardInventoryTable.hasEmail},
              'hasPhone', ${giftCardInventoryTable.hasPhone}
            )
            ORDER BY ${giftCardInventoryTable.createdAt}, ${giftCardInventoryTable.id}
          ) FILTER (WHERE ${giftCardInventoryTable.id} IS NOT NULL),
          '[]'::json
        )
      `,
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
    .where(
      includeArchived
        ? undefined
        : eq(giftCardProductsTable.isArchived, false),
    )
    .groupBy(giftCardProductsTable.id)
    .orderBy(desc(giftCardProductsTable.createdAt));

  const productIds = products.map((product) => product.id);
  const cardIdentifiers = new Map<string, {
    bin: string | null;
    lastFour: string | null;
    cardholderName: string | null;
    cardType: string | null;
    issuer: string | null;
    brand: string | null;
  }>();
  if (includeBins) {
    const inventoryIds = products.flatMap((product) =>
      product.availableCardLocations.map((card) => card.inventoryId),
    );
    if (inventoryIds.length > 0) {
      const inventoryCredentials = await db
        .select({
          id: giftCardInventoryTable.id,
          credentialCiphertext: giftCardInventoryTable.credentialCiphertext,
          credentialIv: giftCardInventoryTable.credentialIv,
          credentialTag: giftCardInventoryTable.credentialTag,
        })
        .from(giftCardInventoryTable)
        .where(inArray(giftCardInventoryTable.id, inventoryIds));
      for (const credential of inventoryCredentials) {
        const card = decryptGiftCardCredential(credential);
        cardIdentifiers.set(credential.id, {
          bin: getGiftCardBinPrefix(card.cardNumber),
          lastFour: getGiftCardLastFour(card.cardNumber),
          cardholderName: card.cardholderName?.trim() || null,
          cardType: card.cardType?.trim() || null,
          issuer: card.issuer?.trim() || null,
          brand: card.brand?.trim() || null,
        });
      }
    }
  }
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
  const productsWithHistory = new Set([
    ...inventoryHistory.map((item) => item.productId),
    ...orderHistory.map((order) => order.productId),
  ]);

  return products.map((product) => {
    const { isArchived, address, ...catalogProduct } = product;
    const visibleProduct = includeBaseAddress
      ? { ...catalogProduct, address }
      : catalogProduct;
    return {
      ...visibleProduct,
      ...(includeBins
        ? {
            availableCardLocations: visibleProduct.availableCardLocations.map(
              (card) => ({
                ...card,
                bin: cardIdentifiers.get(card.inventoryId)?.bin ?? null,
                lastFour: cardIdentifiers.get(card.inventoryId)?.lastFour ?? null,
                cardholderName: cardIdentifiers.get(card.inventoryId)?.cardholderName ?? null,
                cardType: cardIdentifiers.get(card.inventoryId)?.cardType || card.cardType,
                issuer: cardIdentifiers.get(card.inventoryId)?.issuer || card.issuer,
                brand: cardIdentifiers.get(card.inventoryId)?.brand || card.brand,
              }),
            ),
          }
        : {}),
      ...(includeStockEligibility
        ? {
            canReceiveStock:
              !isArchived && product.availableCount < MAX_AVAILABLE_CARDS_PER_BASE,
            hasHistory: productsWithHistory.has(product.id),
            isArchived,
          }
        : {}),
      createdAt: product.createdAt.toISOString(),
    };
  });
}

function normalizeCredential(
  card: GiftCardCredential,
): GiftCardCredential | null {
  const cardNumber = card.cardNumber.replace(/\s/g, "");
  const expiration = card.expiration.trim().replace("-", "/");
  const expirationMatch = /^(0[1-9]|1[0-2])\/(\d{2}|\d{4})$/.exec(expiration);
  const email = card.email?.trim() || null;
  const phone = card.phone?.trim() || null;
  const cardholderName = card.cardholderName?.trim().replace(/\s+/g, " ") || null;
  const cardType = card.cardType?.trim().replace(/\s+/g, " ") || null;
  const issuer = card.issuer?.trim().replace(/\s+/g, " ") || null;
  const brand = card.brand?.trim().replace(/\s+/g, " ") || null;
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
        phoneDigits.length > 15)) ||
    (cardholderName !== null && cardholderName.length > 120) ||
    (cardType !== null && cardType.length > 80) ||
    (issuer !== null && issuer.length > 80) ||
    (brand !== null && brand.length > 80)
  ) {
    return null;
  }
  return {
    cardNumber,
    expiration,
    securityCode: card.securityCode,
    email,
    phone,
    cardholderName,
    cardType,
    issuer,
    brand,
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

const binMetadataCache = new Map<
  string,
  { result: BinLookupResult; expiresAt: number }
>();
const binMetadataInFlight = new Map<string, Promise<BinLookupResult>>();

async function requestBinMetadata(binPrefix: string): Promise<BinLookupResult> {
  try {
    const response = await fetch(`https://lookup.binlist.net/${binPrefix}`, {
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

async function lookupBinMetadata(binPrefix: string): Promise<BinLookupResult> {
  if (!/^\d{8}$/.test(binPrefix)) return { kind: "not_found" };

  const cached = binMetadataCache.get(binPrefix);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) binMetadataCache.delete(binPrefix);

  const inFlight = binMetadataInFlight.get(binPrefix);
  if (inFlight) return inFlight;

  const pending = requestBinMetadata(binPrefix);
  binMetadataInFlight.set(binPrefix, pending);
  try {
    const result = await pending;
    const cacheDuration =
      result.kind === "found"
        ? 24 * 60 * 60 * 1000
        : result.kind === "not_found"
          ? 6 * 60 * 60 * 1000
          : 30 * 1000;
    binMetadataCache.set(binPrefix, {
      result,
      expiresAt: Date.now() + cacheDuration,
    });
    return result;
  } finally {
    binMetadataInFlight.delete(binPrefix);
  }
}

async function lookupBinMetadataForPrefixes(
  prefixes: string[],
): Promise<Map<string, BinLookupResult>> {
  const uniquePrefixes = [...new Set(prefixes)].filter((prefix) =>
    /^\d{8}$/.test(prefix),
  );
  const results = new Map<string, BinLookupResult>();
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < uniquePrefixes.length) {
      const prefix = uniquePrefixes[nextIndex++]!;
      results.set(prefix, await lookupBinMetadata(prefix));
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(5, uniquePrefixes.length) },
      () => worker(),
    ),
  );
  return results;
}

router.get("/gift-card-products", requireMemberPage("buyCards"), async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to browse gift cards." });
    return;
  }
  const products = await listProducts({ includeBins: true });
  res.json(GetGiftCardProductsResponse.parse({ products }));
});

router.get("/orders/gift-cards", requireMemberPage("myCardOrders"), async (req, res): Promise<void> => {
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

  const productIds = [...new Set(orders.map((order) => order.productId))];
  const productLocations = productIds.length
    ? await db
        .select({
          id: giftCardProductsTable.id,
          address: giftCardProductsTable.address,
          city: giftCardProductsTable.city,
          state: giftCardProductsTable.state,
          regionZip: giftCardProductsTable.regionZip,
          cardType: giftCardProductsTable.cardType,
          issuer: giftCardProductsTable.issuer,
          brand: giftCardProductsTable.brand,
        })
        .from(giftCardProductsTable)
        .where(inArray(giftCardProductsTable.id, productIds))
    : [];
  const productLocationsById = new Map(
    productLocations.map((location) => [location.id, location]),
  );

  const orderIds = orders.map((order) => order.id);
  const hasPerCardMetadata = await supportsPerCardBinMetadata();
  const hasPerCardPublicAddress = await supportsPerCardPublicAddress();
  const inventory = orderIds.length
    ? await db
        .select({
          id: giftCardInventoryTable.id,
          productId: giftCardInventoryTable.productId,
          orderId: giftCardInventoryTable.orderId,
          credentialCiphertext: giftCardInventoryTable.credentialCiphertext,
          credentialIv: giftCardInventoryTable.credentialIv,
          credentialTag: giftCardInventoryTable.credentialTag,
          publicAddress: hasPerCardPublicAddress
            ? giftCardInventoryTable.publicAddress
            : sql<string | null>`NULL`,
          publicCity: giftCardInventoryTable.publicCity,
          publicState: giftCardInventoryTable.publicState,
          publicRegionZip: giftCardInventoryTable.publicRegionZip,
          cardType: hasPerCardMetadata
            ? giftCardInventoryTable.cardType
            : sql<string | null>`NULL`,
          issuer: hasPerCardMetadata
            ? giftCardInventoryTable.issuer
            : sql<string | null>`NULL`,
          brand: hasPerCardMetadata
            ? giftCardInventoryTable.brand
            : sql<string | null>`NULL`,
        })
        .from(giftCardInventoryTable)
        .where(
          and(
            inArray(giftCardInventoryTable.orderId, orderIds),
            eq(giftCardInventoryTable.status, "sold"),
          ),
        )
        .orderBy(giftCardInventoryTable.createdAt)
    : [];
  const cardsByOrder = new Map<
    string,
    Array<
      GiftCardCredential & {
        cardType: string;
        issuer: string;
        brand: string;
        publicLocation: GiftCardPublicLocation;
      }
    >
  >();
  for (const item of inventory) {
    if (!item.orderId) continue;
    const baseLocation = productLocationsById.get(item.productId);
    if (!baseLocation) {
      throw new Error(`Public location metadata missing for gift-card inventory ${item.id}.`);
    }
    const credential = decryptGiftCardCredential(item);
    const cards = cardsByOrder.get(item.orderId) ?? [];
    cards.push({
      ...credential,
      cardType: credential.cardType || item.cardType || baseLocation.cardType,
      issuer: credential.issuer || item.issuer || baseLocation.issuer,
      brand: credential.brand || item.brand || baseLocation.brand,
      publicLocation: {
        address: item.publicAddress ?? baseLocation.address,
        city: item.publicCity ?? baseLocation.city,
        state: item.publicState ?? baseLocation.state,
        regionZip: item.publicRegionZip ?? baseLocation.regionZip,
      },
    });
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

router.post("/orders/gift-cards", requireMemberPage("buyCards"), async (req, res): Promise<void> => {
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

  const hasPerCardMetadata = await supportsPerCardBinMetadata();
  const hasPerCardPublicAddress = await supportsPerCardPublicAddress();
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .for("update")
      .limit(1);

    const [inventoryReference] = await tx
      .select({ productId: giftCardInventoryTable.productId })
      .from(giftCardInventoryTable)
      .where(eq(giftCardInventoryTable.id, parsed.data.inventoryId))
      .limit(1);
    if (!inventoryReference || inventoryReference.productId !== parsed.data.productId) {
      return { kind: "missing" as const };
    }

    const [product] = await tx
      .select()
      .from(giftCardProductsTable)
      .where(
        and(
          eq(giftCardProductsTable.id, inventoryReference.productId),
          eq(giftCardProductsTable.isArchived, false),
        ),
      )
      .for("update")
      .limit(1);
    if (!product) return { kind: "missing" as const };

    const totalCents = product.priceCents;
    const [balanceRow] = await tx
      .select({ balanceCents: sum(accountLedgerTable.amountCents) })
      .from(accountLedgerTable)
      .where(eq(accountLedgerTable.userId, user.id));
    const balanceCents = Number(balanceRow?.balanceCents ?? 0);
    if (balanceCents < totalCents) {
      return { kind: "balance" as const };
    }

    const [stock] = await tx
      .select({
        id: giftCardInventoryTable.id,
        credentialCiphertext: giftCardInventoryTable.credentialCiphertext,
        credentialIv: giftCardInventoryTable.credentialIv,
        credentialTag: giftCardInventoryTable.credentialTag,
        publicAddress: hasPerCardPublicAddress
          ? giftCardInventoryTable.publicAddress
          : sql<string | null>`NULL`,
        publicCity: giftCardInventoryTable.publicCity,
        publicState: giftCardInventoryTable.publicState,
        publicRegionZip: giftCardInventoryTable.publicRegionZip,
        cardType: hasPerCardMetadata
          ? giftCardInventoryTable.cardType
          : sql<string | null>`NULL`,
        issuer: hasPerCardMetadata
          ? giftCardInventoryTable.issuer
          : sql<string | null>`NULL`,
        brand: hasPerCardMetadata
          ? giftCardInventoryTable.brand
          : sql<string | null>`NULL`,
      })
      .from(giftCardInventoryTable)
      .where(
        and(
          eq(giftCardInventoryTable.id, parsed.data.inventoryId),
          eq(giftCardInventoryTable.productId, product.id),
          eq(giftCardInventoryTable.status, "available"),
          isNull(giftCardInventoryTable.orderId),
        ),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!stock) {
      return { kind: "stock" as const };
    }

    const deliveredCredential = decryptGiftCardCredential(stock);
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
        totalCents,
      })
      .returning();
    if (!order) throw new Error("Gift-card order creation failed.");

    await tx
      .update(giftCardInventoryTable)
      .set({ status: "sold", orderId: order.id, soldAt: order.createdAt })
      .where(eq(giftCardInventoryTable.id, stock.id));

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
        deliveredCards: [{
          ...deliveredCredential,
          cardType: deliveredCredential.cardType || stock.cardType || product.cardType,
          issuer: deliveredCredential.issuer || stock.issuer || product.issuer,
          brand: deliveredCredential.brand || stock.brand || product.brand,
          publicLocation: {
            address: stock.publicAddress ?? product.address,
            city: stock.publicCity ?? product.city,
            state: stock.publicState ?? product.state,
            regionZip: stock.publicRegionZip ?? product.regionZip,
          },
        }],
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

router.post("/orders/gift-cards/bulk", requireMemberPage("buyCards"), async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to purchase gift cards." });
    return;
  }

  const parsed = BulkPurchaseGiftCardsBody.safeParse(req.body);
  if (!parsed.success || new Set(parsed.data?.inventoryIds ?? []).size !== parsed.data?.inventoryIds.length) {
    res.status(400).json({ error: "Choose one or more different available cards." });
    return;
  }

  const inventoryIds = parsed.data.inventoryIds;
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .for("update")
      .limit(1);

    const selectedStockRefs = await tx
      .select({
        id: giftCardInventoryTable.id,
        productId: giftCardInventoryTable.productId,
      })
      .from(giftCardInventoryTable)
      .where(inArray(giftCardInventoryTable.id, inventoryIds))
      .orderBy(giftCardInventoryTable.id);
    if (selectedStockRefs.length !== inventoryIds.length) {
      return { kind: "missing" as const };
    }

    const productIds = selectedStockRefs.map((stock) => stock.productId);
    if (new Set(productIds).size !== productIds.length) {
      return { kind: "duplicate-base" as const };
    }

    const selectedProducts = await tx
      .select()
      .from(giftCardProductsTable)
      .where(
        and(
          inArray(giftCardProductsTable.id, productIds),
          eq(giftCardProductsTable.isArchived, false),
        ),
      )
      .orderBy(giftCardProductsTable.id)
      .for("update");
    if (selectedProducts.length !== productIds.length) {
      return { kind: "missing" as const };
    }

    const productsById = new Map(selectedProducts.map((product) => [product.id, product]));
    const stockRows = await tx
      .select({
        id: giftCardInventoryTable.id,
        productId: giftCardInventoryTable.productId,
      })
      .from(giftCardInventoryTable)
      .where(
        and(
          inArray(giftCardInventoryTable.id, inventoryIds),
          eq(giftCardInventoryTable.status, "available"),
          isNull(giftCardInventoryTable.orderId),
        ),
      )
      .orderBy(giftCardInventoryTable.id)
      .for("update", { skipLocked: true });
    if (
      stockRows.length !== inventoryIds.length
      || selectedStockRefs.some((reference) => (
        stockRows.find((stock) => stock.id === reference.id)?.productId !== reference.productId
      ))
    ) {
      return { kind: "stock" as const };
    }

    const stockById = new Map(stockRows.map((stock) => [stock.id, stock]));
    const totalCents = selectedStockRefs.reduce(
      (total, stock) => total + productsById.get(stock.productId)!.priceCents,
      0,
    );
    const [balanceRow] = await tx
      .select({ balanceCents: sum(accountLedgerTable.amountCents) })
      .from(accountLedgerTable)
      .where(eq(accountLedgerTable.userId, user.id));
    const balanceCents = Number(balanceRow?.balanceCents ?? 0);
    if (balanceCents < totalCents) {
      return { kind: "balance" as const };
    }

    const orders = [];
    for (const reference of selectedStockRefs) {
      const product = productsById.get(reference.productId);
      const stock = stockById.get(reference.id);
      if (!product || !stock) throw new Error("Selected gift-card stock was not locked.");

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
  if (result.kind === "duplicate-base") {
    res.status(400).json({ error: "Choose no more than one card from each base." });
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

  const products = await listProducts({
    includeStockEligibility: true,
    includeArchived: true,
    includeBaseAddress: true,
  });
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
      canReceiveStock: true,
      hasHistory: false,
      isArchived: false,
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
    const result = await db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: giftCardProductsTable.id })
        .from(giftCardProductsTable)
        .where(eq(giftCardProductsTable.id, params.data.productId))
        .for("update")
        .limit(1);
      if (!product) return { kind: "missing" as const };

      const [orders, inventory] = await Promise.all([
        tx
          .select({ count: count() })
          .from(giftCardOrdersTable)
          .where(eq(giftCardOrdersTable.productId, product.id)),
        tx
          .select({ count: count() })
          .from(giftCardInventoryTable)
          .where(eq(giftCardInventoryTable.productId, product.id)),
      ]);
      const hasHistory =
        Number(orders[0]?.count ?? 0) > 0 ||
        Number(inventory[0]?.count ?? 0) > 0;

      if (hasHistory) {
        await tx
          .update(giftCardProductsTable)
          .set({ isArchived: true })
          .where(eq(giftCardProductsTable.id, product.id));
        return { kind: "archived" as const };
      }

      const [deleted] = await tx
        .delete(giftCardProductsTable)
        .where(eq(giftCardProductsTable.id, product.id))
        .returning({ id: giftCardProductsTable.id });
      return deleted
        ? { kind: "deleted" as const }
        : { kind: "missing" as const };
    });

    if (result.kind === "missing") {
      res.status(404).json({ error: "Gift-card product not found." });
      return;
    }

    res.json(DeleteAdminGiftCardProductResponse.parse({ action: result.kind }));
  },
);

router.post(
  "/admin/gift-card-products/:productId/restore",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to restore gift-card products." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = RestoreAdminGiftCardProductParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid product." });
      return;
    }

    const [restored] = await db
      .update(giftCardProductsTable)
      .set({ isArchived: false })
      .where(eq(giftCardProductsTable.id, params.data.productId))
      .returning({ id: giftCardProductsTable.id });
    if (!restored) {
      res.status(404).json({ error: "Gift-card product not found." });
      return;
    }
    res.status(204).end();
  },
);

router.post(
  "/admin/gift-card-products/:productId/refresh-bin-metadata",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to refresh card metadata." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = RefreshAdminGiftCardBinMetadataParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Choose a valid gift-card base." });
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
    if (!(await supportsPerCardBinMetadata())) {
      res.status(409).json({
        error:
          "Per-card BIN metadata is not enabled for this database. No public lookup was sent.",
      });
      return;
    }

    const inventory = await db
      .select({
        id: giftCardInventoryTable.id,
        credentialCiphertext: giftCardInventoryTable.credentialCiphertext,
        credentialIv: giftCardInventoryTable.credentialIv,
        credentialTag: giftCardInventoryTable.credentialTag,
        cardType: giftCardInventoryTable.cardType,
        issuer: giftCardInventoryTable.issuer,
        brand: giftCardInventoryTable.brand,
      })
      .from(giftCardInventoryTable)
      .where(eq(giftCardInventoryTable.productId, product.id));
    const inventoryByPrefix = new Map<
      string,
      Array<{ id: string; cardType: string | null; issuer: string | null; brand: string | null }>
    >();
    for (const item of inventory) {
      if (item.cardType && item.issuer && item.brand) continue;
      const credential = decryptGiftCardCredential(item);
      const prefix = getGiftCardBinMetadataPrefix(credential.cardNumber);
      if (!prefix) continue;
      const cards = inventoryByPrefix.get(prefix) ?? [];
      cards.push({
        id: item.id,
        cardType: item.cardType,
        issuer: item.issuer,
        brand: item.brand,
      });
      inventoryByPrefix.set(prefix, cards);
    }

    const lookups = await lookupBinMetadataForPrefixes([
      ...inventoryByPrefix.keys(),
    ]);
    let cardsUpdated = 0;
    let prefixesUnavailable = 0;
    for (const [prefix, result] of lookups) {
      if (result.kind === "unavailable") {
        prefixesUnavailable += 1;
        continue;
      }
      if (result.kind !== "found") continue;
      const changes = {
        ...(result.metadata.cardType
          ? {
              cardType: sql`COALESCE(${giftCardInventoryTable.cardType}, ${result.metadata.cardType})`,
            }
          : {}),
        ...(result.metadata.issuer
          ? {
              issuer: sql`COALESCE(${giftCardInventoryTable.issuer}, ${result.metadata.issuer})`,
            }
          : {}),
        ...(result.metadata.brand
          ? {
              brand: sql`COALESCE(${giftCardInventoryTable.brand}, ${result.metadata.brand})`,
            }
          : {}),
      };
      if (Object.keys(changes).length === 0) continue;
      const ids = inventoryByPrefix.get(prefix)?.map((card) => card.id) ?? [];
      if (!ids.length) continue;
      try {
        const updated = await db
          .update(giftCardInventoryTable)
          .set(changes)
          .where(inArray(giftCardInventoryTable.id, ids))
          .returning({ id: giftCardInventoryTable.id });
        cardsUpdated += updated.length;
      } catch {
        req.log.error(
          { cardCount: ids.length },
          "Automatic gift-card metadata could not be saved for an existing batch.",
        );
      }
    }
    res.json(
      RefreshAdminGiftCardBinMetadataResponse.parse({
        cardCount: inventory.length,
        prefixesLookedUp: lookups.size,
        cardsUpdated,
        prefixesUnavailable,
      }),
    );
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
    const hashes = credentials.map(hashGiftCardCredential);

    const defaultLocation = {
      address: parsed.data.address?.trim() || null,
      state: parsed.data.state?.trim() || null,
      city: parsed.data.city?.trim() || null,
      regionZip: parsed.data.redemptionRegionZip ?? null,
    };
    const cardLocations = parsed.data.cards.map((card) => ({
      address: card.publicLocation?.address?.trim() || defaultLocation.address,
      city: card.publicLocation?.city?.trim() || defaultLocation.city,
      state: card.publicLocation?.state?.trim() || defaultLocation.state,
      regionZip: card.publicLocation?.regionZip ?? defaultLocation.regionZip,
    }));
    const incomingRows = credentials.map((credential, index) => ({
      credential,
      hash: hashes[index]!,
      location: cardLocations[index]!,
      prefix: getGiftCardBinMetadataPrefix(credential.cardNumber),
    }));
    const binMetadataStorageAvailable = await supportsPerCardBinMetadata();
    const publicAddressStorageAvailable = await supportsPerCardPublicAddress();
    let stockResult:
      | { kind: "missing" }
      | { kind: "archived" }
      | {
          kind: "success";
          addedCount: number;
          availableCount: number;
          duplicateCount: number;
          capacitySkippedCount: number;
          redemptionZipApplied: boolean;
          locationMetadataApplied: boolean;
          inventoryItems: Array<{ id: string; prefix: string }>;
        };
    stockResult = await db.transaction(async (tx) => {
        const [product] = await tx
          .select({
            id: giftCardProductsTable.id,
            address: giftCardProductsTable.address,
            city: giftCardProductsTable.city,
            state: giftCardProductsTable.state,
            regionZip: giftCardProductsTable.regionZip,
            isArchived: giftCardProductsTable.isArchived,
          })
          .from(giftCardProductsTable)
          .where(eq(giftCardProductsTable.id, params.data.productId))
          .for("update")
          .limit(1);
        if (!product) return { kind: "missing" as const };
        if (product.isArchived) return { kind: "archived" as const };

        const [currentStock] = await tx
          .select({ count: count() })
          .from(giftCardInventoryTable)
          .where(
            and(
              eq(giftCardInventoryTable.productId, product.id),
              eq(giftCardInventoryTable.status, "available"),
            ),
          );
        const currentAvailableCount = Number(currentStock?.count ?? 0);
        const remainingCount = Math.max(
          0,
          MAX_AVAILABLE_CARDS_PER_BASE - currentAvailableCount,
        );

        let duplicateCount = 0;
        const uniqueRows = new Map<
          string,
          (typeof incomingRows)[number]
        >();
        for (const row of incomingRows) {
          if (uniqueRows.has(row.hash)) {
            duplicateCount += 1;
          } else {
            uniqueRows.set(row.hash, row);
          }
        }
        const uniqueHashes = [...uniqueRows.keys()];
        const existingRows = uniqueHashes.length
          ? await tx
              .select({ credentialHash: giftCardInventoryTable.credentialHash })
              .from(giftCardInventoryTable)
              .where(inArray(giftCardInventoryTable.credentialHash, uniqueHashes))
          : [];
        const existingHashes = new Set(
          existingRows.map((row) => row.credentialHash),
        );
        const candidates = [...uniqueRows.values()].filter((row) => {
          if (!existingHashes.has(row.hash)) return true;
          duplicateCount += 1;
          return false;
        });
        const acceptedRows = candidates.slice(0, remainingCount);
        const capacitySkippedCount = candidates.length - acceptedRows.length;
        const values = acceptedRows.map(({ credential, location }) => ({
          productId: product.id,
          hasEmail: Boolean(credential.email),
          hasPhone: Boolean(credential.phone),
          ...(publicAddressStorageAvailable
            ? { publicAddress: location.address ?? product.address }
            : {}),
          publicCity: location.city ?? product.city,
          publicState: location.state ?? product.state,
          publicRegionZip: location.regionZip ?? product.regionZip,
          ...(binMetadataStorageAvailable
            ? {
                cardType: credential.cardType ?? null,
                issuer: credential.issuer ?? null,
                brand: credential.brand ?? null,
              }
            : {}),
          ...encryptGiftCardCredential(credential),
        }));
        const inserted = values.length
          ? await tx
              .insert(giftCardInventoryTable)
              .values(values)
              .onConflictDoNothing({
                target: giftCardInventoryTable.credentialHash,
              })
              .returning({
                id: giftCardInventoryTable.id,
                credentialHash: giftCardInventoryTable.credentialHash,
              })
          : [];
        duplicateCount += acceptedRows.length - inserted.length;
        const insertedHashes = new Set(
          inserted.map((item) => item.credentialHash),
        );
        const insertedRows = acceptedRows.filter((row) =>
          insertedHashes.has(row.hash),
        );
        const [availableStock] = await tx
          .select({ count: count() })
          .from(giftCardInventoryTable)
          .where(
            and(
              eq(giftCardInventoryTable.productId, product.id),
              eq(giftCardInventoryTable.status, "available"),
            ),
          );
        return {
          kind: "success" as const,
          addedCount: inserted.length,
          availableCount: Number(availableStock?.count ?? 0),
          duplicateCount,
          capacitySkippedCount,
          redemptionZipApplied: insertedRows.some(
            (row) => row.location.regionZip !== null,
          ),
          locationMetadataApplied: insertedRows.some(
            (row) =>
              Boolean(
                (publicAddressStorageAvailable && row.location.address) ||
                  row.location.state ||
                  row.location.city,
              ),
          ),
          inventoryItems: inserted.flatMap((item) => {
            const prefix = incomingRows.find(
              (row) => row.hash === item.credentialHash,
            )?.prefix;
            return prefix ? [{ id: item.id, prefix }] : [];
          }),
        };
      });

    if (stockResult.kind === "missing") {
      res.status(404).json({ error: "Gift-card product not found." });
      return;
    }
    if (stockResult.kind === "archived") {
      res.status(409).json({
        error: "Restore this base before uploading stock.",
      });
      return;
    }
    if (stockResult.duplicateCount > 0 || stockResult.capacitySkippedCount > 0) {
      req.log.warn(
        {
          duplicateCount: stockResult.duplicateCount,
          capacitySkippedCount: stockResult.capacitySkippedCount,
        },
        "Gift-card stock upload completed with skipped rows.",
      );
    }
    // Only look up distinct 8-digit prefixes for newly inserted cards.
    const cardsByPrefix = new Map<string, string[]>();
    for (const item of stockResult.inventoryItems) {
      const ids = cardsByPrefix.get(item.prefix) ?? [];
      ids.push(item.id);
      cardsByPrefix.set(item.prefix, ids);
    }
    const lookups = binMetadataStorageAvailable
      ? await lookupBinMetadataForPrefixes([...cardsByPrefix.keys()])
      : new Map<string, BinLookupResult>();
    let binMetadataCardsUpdated = 0;
    let unavailablePrefixCount = 0;
    for (const [prefix, result] of lookups) {
      if (result.kind === "unavailable") {
        unavailablePrefixCount += 1;
        continue;
      }
      if (result.kind !== "found") continue;
      const metadataChanges: {
        cardType?: string;
        issuer?: string;
        brand?: string;
      } = {};
      if (result.metadata.cardType) {
        metadataChanges.cardType = result.metadata.cardType;
      }
      if (result.metadata.issuer) {
        metadataChanges.issuer = result.metadata.issuer;
      }
      if (result.metadata.brand) {
        metadataChanges.brand = result.metadata.brand;
      }
      if (Object.keys(metadataChanges).length === 0) continue;
      const ids = cardsByPrefix.get(prefix) ?? [];
      if (!ids.length) continue;
      try {
        const updated = await db
          .update(giftCardInventoryTable)
          .set(metadataChanges)
          .where(inArray(giftCardInventoryTable.id, ids))
          .returning({ id: giftCardInventoryTable.id });
        binMetadataCardsUpdated += updated.length;
      } catch {
        req.log.error(
          { cardCount: ids.length },
          "Automatic gift-card metadata could not be saved for an accepted batch.",
        );
      }
    }
    if (unavailablePrefixCount > 0) {
      req.log.warn(
        { prefixCount: unavailablePrefixCount },
        "Some public BIN lookups were unavailable; the accepted card batch remains available.",
      );
    }
    res.json(
      AddAdminGiftCardStockResponse.parse({
        addedCount: stockResult.addedCount,
        availableCount: stockResult.availableCount,
        duplicateCount: stockResult.duplicateCount,
        capacitySkippedCount: stockResult.capacitySkippedCount,
        binMetadataApplied: binMetadataCardsUpdated > 0,
        binMetadataCardsUpdated,
        binMetadataPrefixesLookedUp: lookups.size,
        redemptionZipApplied: stockResult.redemptionZipApplied,
        locationMetadataApplied: stockResult.locationMetadataApplied,
      }),
    );
  },
);

export default router;