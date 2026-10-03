import { and, count, desc, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AddAdminLicenseStockBody,
  AddAdminLicenseStockParams,
  AddAdminLicenseStockResponse,
  CreateAdminLicenseProductBody,
  CreateAdminLicenseProductResponse,
  CreateLicenseOrderBody,
  CreateLicenseOrderResponse,
  GetAdminLicenseProductsResponse,
  GetLicenseProductsResponse,
  GetMyLicenseOrdersResponse,
} from "@workspace/api-zod";
import {
  accountLedgerTable,
  db,
  licenseInventoryTable,
  licenseOrdersTable,
  licenseProductsTable,
  usersTable,
} from "@workspace/db";
import { decryptLicenseKey, encryptLicenseKey } from "../lib/license-keys";
import { getCurrentUser, isDepositAdmin } from "../lib/auth";

const router: IRouter = Router();

async function listProducts(admin: boolean) {
  const availableCount = count(licenseInventoryTable.id);
  const query = db
    .select({
      id: licenseProductsTable.id,
      name: licenseProductsTable.name,
      description: licenseProductsTable.description,
      category: licenseProductsTable.category,
      priceCents: licenseProductsTable.priceCents,
      availableCount,
      createdAt: licenseProductsTable.createdAt,
    })
    .from(licenseProductsTable)
    .leftJoin(
      licenseInventoryTable,
      and(
        eq(licenseInventoryTable.productId, licenseProductsTable.id),
        eq(licenseInventoryTable.status, "available"),
      ),
    )
    .groupBy(licenseProductsTable.id)
    .orderBy(desc(licenseProductsTable.createdAt));

  const products = await query;
  return products
    .filter((product) => admin || product.availableCount > 0)
    .map((product) => ({
      ...product,
      createdAt: product.createdAt.toISOString(),
    }));
}

router.get("/license-products", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to browse license products." });
    return;
  }

  const products = await listProducts(false);
  res.json(GetLicenseProductsResponse.parse({ products }));
});

router.get("/orders/license-keys", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view your orders." });
    return;
  }

  const orders = await db
    .select()
    .from(licenseOrdersTable)
    .where(eq(licenseOrdersTable.userId, user.id))
    .orderBy(desc(licenseOrdersTable.createdAt))
    .limit(100);

  const orderIds = orders.map((order) => order.id);
  const inventory = orderIds.length
    ? await db
        .select()
        .from(licenseInventoryTable)
        .where(
          and(
            inArray(licenseInventoryTable.orderId, orderIds),
            eq(licenseInventoryTable.status, "sold"),
          ),
        )
        .orderBy(licenseInventoryTable.createdAt)
    : [];
  const keysByOrder = new Map<string, string[]>();
  for (const item of inventory) {
    if (!item.orderId) continue;
    const keys = keysByOrder.get(item.orderId) ?? [];
    keys.push(decryptLicenseKey(item));
    keysByOrder.set(item.orderId, keys);
  }

  res.json(
    GetMyLicenseOrdersResponse.parse({
      orders: orders.map((order) => ({
        id: order.id,
        productId: order.productId,
        productName: order.productName,
        description: order.description,
        quantity: order.quantity,
        unitPriceCents: order.unitPriceCents,
        totalCents: order.totalCents,
        deliveredKeys: keysByOrder.get(order.id) ?? [],
        createdAt: order.createdAt.toISOString(),
      })),
    }),
  );
});

router.post("/orders/license-keys", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to purchase a license." });
    return;
  }

  const parsed = CreateLicenseOrderBody.safeParse(req.body);
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
      .from(licenseProductsTable)
      .where(eq(licenseProductsTable.id, parsed.data.productId))
      .limit(1);
    if (!product) return { kind: "missing" as const };

    const totalCents = product.priceCents * parsed.data.quantity;
    const [balanceRow] = await tx
      .select({ balanceCents: sum(accountLedgerTable.amountCents) })
      .from(accountLedgerTable)
      .where(eq(accountLedgerTable.userId, user.id));
    const balanceCents = Number(balanceRow?.balanceCents ?? 0);
    if (balanceCents < totalCents) {
      return { kind: "balance" as const, balanceCents };
    }

    const stock = await tx
      .select()
      .from(licenseInventoryTable)
      .where(
        and(
          eq(licenseInventoryTable.productId, product.id),
          eq(licenseInventoryTable.status, "available"),
          isNull(licenseInventoryTable.orderId),
        ),
      )
      .orderBy(licenseInventoryTable.createdAt)
      .limit(parsed.data.quantity)
      .for("update", { skipLocked: true });
    if (stock.length < parsed.data.quantity) {
      return { kind: "stock" as const };
    }

    const [order] = await tx
      .insert(licenseOrdersTable)
      .values({
        userId: user.id,
        productId: product.id,
        productName: product.name,
        description: product.description,
        quantity: parsed.data.quantity,
        unitPriceCents: product.priceCents,
        totalCents,
      })
      .returning();
    if (!order) throw new Error("License order creation failed.");

    await tx
      .update(licenseInventoryTable)
      .set({ status: "sold", orderId: order.id, soldAt: order.createdAt })
      .where(inArray(licenseInventoryTable.id, stock.map((item) => item.id)));

    await tx.insert(accountLedgerTable).values({
      userId: user.id,
      depositId: null,
      redeemCodeId: null,
      supportRefundId: null,
      orderId: order.id,
      entryType: "license_purchase",
      amountCents: -totalCents,
    });

    return {
      kind: "success" as const,
      balanceCents: balanceCents - totalCents,
      order: {
        id: order.id,
        productId: order.productId,
        productName: order.productName,
        description: order.description,
        quantity: order.quantity,
        unitPriceCents: order.unitPriceCents,
        totalCents: order.totalCents,
        deliveredKeys: stock.map((item) => decryptLicenseKey(item)),
        createdAt: order.createdAt.toISOString(),
      },
    };
  });

  if (result.kind === "missing") {
    res.status(404).json({ error: "That product is not available." });
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
      error: "There is not enough stock for that quantity.",
    });
    return;
  }

  res
    .status(201)
    .json(
      CreateLicenseOrderResponse.parse({
        order: result.order,
        balanceCents: result.balanceCents,
      }),
    );
});

router.get("/admin/license-products", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage license products." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const products = await listProducts(true);
  res.json(GetAdminLicenseProductsResponse.parse({ products }));
});

router.post("/admin/license-products", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to create license products." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const parsed = CreateAdminLicenseProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter valid product details." });
    return;
  }

  const [created] = await db
    .insert(licenseProductsTable)
    .values({
      name: parsed.data.name.trim(),
      description: parsed.data.description.trim(),
      category: parsed.data.category.trim(),
      priceCents: parsed.data.priceCents,
      createdByUserId: user.id,
    })
    .returning();
  if (!created) throw new Error("License product creation failed.");

  res.status(201).json(
    CreateAdminLicenseProductResponse.parse({
      id: created.id,
      name: created.name,
      description: created.description,
      category: created.category,
      priceCents: created.priceCents,
      availableCount: 0,
      createdAt: created.createdAt.toISOString(),
    }),
  );
});

router.post(
  "/admin/license-products/:productId/stock",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to add license stock." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = AddAdminLicenseStockParams.safeParse(req.params);
    const parsed = AddAdminLicenseStockBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Enter a valid batch of license keys." });
      return;
    }

    const keys = parsed.data.keys.map((key) => key.trim());
    if (
      keys.some((key) => key.length === 0 || key.length > 500) ||
      new Set(keys).size !== keys.length
    ) {
      res.status(400).json({
        error: "Remove blank or duplicate keys from the batch before adding it.",
      });
      return;
    }

    const [product] = await db
      .select({ id: licenseProductsTable.id })
      .from(licenseProductsTable)
      .where(eq(licenseProductsTable.id, params.data.productId))
      .limit(1);
    if (!product) {
      res.status(404).json({ error: "License product not found." });
      return;
    }

    const values = keys.map((key) => ({
      productId: product.id,
      ...encryptLicenseKey(key),
    }));

    const stockResult = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(licenseInventoryTable)
        .values(values)
        .onConflictDoNothing({
          target: licenseInventoryTable.keyHash,
        })
        .returning({ id: licenseInventoryTable.id });
      if (inserted.length !== values.length) {
        throw new Error("DUPLICATE_LICENSE_KEY");
      }
      const [available] = await tx
        .select({ count: count() })
        .from(licenseInventoryTable)
        .where(
          and(
            eq(licenseInventoryTable.productId, product.id),
            eq(licenseInventoryTable.status, "available"),
          ),
        );
      return Number(available?.count ?? 0);
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === "DUPLICATE_LICENSE_KEY") {
        return null;
      }
      throw error;
    });

    if (stockResult === null) {
      res.status(409).json({
        error: "One or more keys already exist in the inventory.",
      });
      return;
    }

    res.json(
      AddAdminLicenseStockResponse.parse({
        addedCount: values.length,
        availableCount: stockResult,
      }),
    );
  },
);

export default router;