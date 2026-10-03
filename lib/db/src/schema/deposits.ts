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

export const depositSettingsTable = pgTable("deposit_settings", {
  id: integer("id").primaryKey().default(1),
  cashAppHandle: varchar("cash_app_handle", { length: 100 }),
  chimeHandle: varchar("chime_handle", { length: 100 }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const depositsTable = pgTable(
  "deposits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    method: varchar("method", { length: 24 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    providerStatus: varchar("provider_status", { length: 40 }),
    providerPaymentId: varchar("provider_payment_id", { length: 100 }),
    paymentAddress: text("payment_address"),
    payAmount: varchar("pay_amount", { length: 100 }),
    payCurrency: varchar("pay_currency", { length: 32 }),
    payinExtraId: text("payin_extra_id"),
    paymentUrl: text("payment_url"),
    recipient: text("recipient"),
    referenceCode: varchar("reference_code", { length: 24 }),
    rejectionReason: varchar("rejection_reason", { length: 250 }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    reviewerNote: varchar("reviewer_note", { length: 250 }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("deposits_user_created_at_index").on(table.userId, table.createdAt),
    index("deposits_status_created_at_index").on(table.status, table.createdAt),
    uniqueIndex("deposits_provider_payment_id_unique").on(
      table.providerPaymentId,
    ),
    uniqueIndex("deposits_reference_code_unique").on(table.referenceCode),
  ],
);

export const accountLedgerTable = pgTable(
  "account_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    depositId: uuid("deposit_id")
      .notNull()
      .references(() => depositsTable.id, { onDelete: "cascade" }),
    entryType: varchar("entry_type", { length: 32 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("account_ledger_user_created_at_index").on(
      table.userId,
      table.createdAt,
    ),
    uniqueIndex("account_ledger_deposit_entry_type_unique").on(
      table.depositId,
      table.entryType,
    ),
  ],
);

export const insertDepositSettingsSchema = createInsertSchema(
  depositSettingsTable,
).omit({ updatedAt: true });
export const insertDepositSchema = createInsertSchema(depositsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertAccountLedgerSchema = createInsertSchema(
  accountLedgerTable,
).omit({ id: true, createdAt: true });

export type DepositSettings = typeof depositSettingsTable.$inferSelect;
export type InsertDepositSettings = z.infer<typeof insertDepositSettingsSchema>;
export type DepositRecord = typeof depositsTable.$inferSelect;
export type InsertDeposit = z.infer<typeof insertDepositSchema>;
export type AccountLedgerEntry = typeof accountLedgerTable.$inferSelect;
export type InsertAccountLedgerEntry = z.infer<
  typeof insertAccountLedgerSchema
>;