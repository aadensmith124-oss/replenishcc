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

export const licenseProductsTable = pgTable(
  "license_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description").notNull().default(""),
    category: varchar("category", { length: 40 }).notNull(),
    priceCents: integer("price_cents").notNull(),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("license_products_created_at_index").on(table.createdAt)],
);

export const licenseOrdersTable = pgTable(
  "license_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => licenseProductsTable.id, { onDelete: "restrict" }),
    productName: varchar("product_name", { length: 100 }).notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("license_orders_user_created_at_index").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const licenseInventoryTable = pgTable(
  "license_inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => licenseProductsTable.id, { onDelete: "restrict" }),
    keyCiphertext: text("key_ciphertext").notNull(),
    keyIv: varchar("key_iv", { length: 32 }).notNull(),
    keyTag: varchar("key_tag", { length: 32 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("available"),
    orderId: uuid("order_id").references(() => licenseOrdersTable.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("license_inventory_key_hash_unique").on(table.keyHash),
    index("license_inventory_product_status_index").on(
      table.productId,
      table.status,
    ),
    index("license_inventory_order_id_index").on(table.orderId),
  ],
);

export const insertLicenseProductSchema = createInsertSchema(
  licenseProductsTable,
).omit({ id: true, createdAt: true });
export const insertLicenseOrderSchema = createInsertSchema(
  licenseOrdersTable,
).omit({ id: true, createdAt: true });
export const insertLicenseInventorySchema = createInsertSchema(
  licenseInventoryTable,
).omit({ id: true, createdAt: true });

export type InsertLicenseProduct = z.infer<typeof insertLicenseProductSchema>;
export type LicenseProduct = typeof licenseProductsTable.$inferSelect;
export type InsertLicenseOrder = z.infer<typeof insertLicenseOrderSchema>;
export type LicenseOrderRecord = typeof licenseOrdersTable.$inferSelect;
export type InsertLicenseInventory = z.infer<
  typeof insertLicenseInventorySchema
>;
export type LicenseInventoryItem = typeof licenseInventoryTable.$inferSelect;