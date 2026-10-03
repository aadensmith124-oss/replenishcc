import { createInsertSchema } from "drizzle-zod";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const accountDeletionRequestsTable = pgTable(
  "account_deletion_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    reason: text("reason"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    reviewNote: varchar("review_note", { length: 250 }),
  },
  (table) => [
    uniqueIndex("account_deletion_requests_one_pending_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    index("account_deletion_requests_status_requested_at_index").on(
      table.status,
      table.requestedAt,
    ),
  ],
);

export const insertAccountDeletionRequestSchema = createInsertSchema(
  accountDeletionRequestsTable,
).omit({
  id: true,
  requestedAt: true,
  reviewedAt: true,
});

export type InsertAccountDeletionRequest = z.infer<
  typeof insertAccountDeletionRequestSchema
>;
export type AccountDeletionRequestRecord =
  typeof accountDeletionRequestsTable.$inferSelect;