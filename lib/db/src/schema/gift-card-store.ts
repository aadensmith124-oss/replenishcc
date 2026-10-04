import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const giftCardProductsTable = pgTable(
  "gift_card_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description").notNull().default(""),
    regionZip: varchar("region_zip", { length: 10 }),
    cardType: varchar("card_type", { length: 80 }).notNull().default(""),
    issuer: varchar("issuer", { length: 80 }).notNull().default(""),
    brand: varchar("brand", { length: 80 }).notNull().default(""),
    faceValueCents: integer("face_value_cents").notNull(),
    priceCents: integer("price_cents").notNull(),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("gift_card_products_created_at_index").on(table.createdAt),
  ],
);

export const giftCardOrdersTable = pgTable(
  "gift_card_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => giftCardProductsTable.id, { onDelete: "restrict" }),
    productName: varchar("product_name", { length: 100 }).notNull(),
    description: text("description").notNull(),
    faceValueCents: integer("face_value_cents").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("gift_card_orders_user_created_at_index").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const giftCardInventoryTable = pgTable(
  "gift_card_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => giftCardProductsTable.id, { onDelete: "restrict" }),
    credentialCiphertext: text("credential_ciphertext").notNull(),
    credentialIv: varchar("credential_iv", { length: 32 }).notNull(),
    credentialTag: varchar("credential_tag", { length: 32 }).notNull(),
    credentialHash: varchar("credential_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("available"),
    orderId: uuid("order_id").references(() => giftCardOrdersTable.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("gift_card_inventory_credential_hash_unique").on(
      table.credentialHash,
    ),
    index("gift_card_inventory_product_status_index").on(
      table.productId,
      table.status,
    ),
    index("gift_card_inventory_order_id_index").on(table.orderId),
  ],
);

export const insertGiftCardProductSchema = createInsertSchema(
  giftCardProductsTable,
).omit({ id: true, createdAt: true });
export const insertGiftCardOrderSchema = createInsertSchema(
  giftCardOrdersTable,
).omit({ id: true, createdAt: true });
export const insertGiftCardInventorySchema = createInsertSchema(
  giftCardInventoryTable,
).omit({ id: true, createdAt: true });

export type InsertGiftCardProduct = z.infer<typeof insertGiftCardProductSchema>;
export type GiftCardProduct = typeof giftCardProductsTable.$inferSelect;
export type InsertGiftCardOrder = z.infer<typeof insertGiftCardOrderSchema>;
export type GiftCardOrderRecord = typeof giftCardOrdersTable.$inferSelect;
export type InsertGiftCardInventory = z.infer<
  typeof insertGiftCardInventorySchema
>;
export type GiftCardInventoryItem = typeof giftCardInventoryTable.$inferSelect;