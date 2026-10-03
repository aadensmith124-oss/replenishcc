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

export const redeemCodesTable = pgTable(
  "redeem_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 40 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    redeemedByUserId: uuid("redeemed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("redeem_codes_code_unique").on(table.code),
    index("redeem_codes_created_at_index").on(table.createdAt),
  ],
);

export const insertRedeemCodeSchema = createInsertSchema(
  redeemCodesTable,
).omit({
  id: true,
  createdAt: true,
  redeemedByUserId: true,
  redeemedAt: true,
});

export type RedeemCode = typeof redeemCodesTable.$inferSelect;
export type InsertRedeemCode = z.infer<typeof insertRedeemCodeSchema>;