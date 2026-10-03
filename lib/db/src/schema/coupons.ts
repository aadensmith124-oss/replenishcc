import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const discountCouponsTable = pgTable(
  "discount_coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 40 }).notNull(),
    percentOff: integer("percent_off").notNull(),
    maxRedemptions: integer("max_redemptions").notNull(),
    redemptionCount: integer("redemption_count").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("discount_coupons_code_unique").on(table.code),
    index("discount_coupons_created_at_index").on(table.createdAt),
  ],
);

export const insertDiscountCouponSchema = createInsertSchema(
  discountCouponsTable,
).omit({
  id: true,
  redemptionCount: true,
  createdAt: true,
});

export type InsertDiscountCoupon = z.infer<typeof insertDiscountCouponSchema>;
export type DiscountCoupon = typeof discountCouponsTable.$inferSelect;