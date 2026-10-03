import { createInsertSchema } from "drizzle-zod";
import {
  check,
  index,
  integer,
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

export const supportTicketsTable = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 32 }).notNull(),
    subject: varchar("subject", { length: 140 }).notNull(),
    orderReference: varchar("order_reference", { length: 120 }),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("support_tickets_user_created_at_index").on(
      table.userId,
      table.createdAt,
    ),
    index("support_tickets_status_updated_at_index").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export const supportTicketMessagesTable = pgTable(
  "support_ticket_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTicketsTable.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    authorName: varchar("author_name", { length: 100 }).notNull(),
    authorRole: varchar("author_role", { length: 16 }).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("support_ticket_messages_ticket_created_at_index").on(
      table.ticketId,
      table.createdAt,
    ),
  ],
);

export const supportTicketRefundsTable = pgTable(
  "support_ticket_refunds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTicketsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    adminUserId: uuid("admin_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    adminName: varchar("admin_name", { length: 100 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    reason: varchar("reason", { length: 250 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("support_ticket_refunds_ticket_id_unique").on(table.ticketId),
    check(
      "support_ticket_refunds_amount_positive",
      sql`${table.amountCents} > 0`,
    ),
    index("support_ticket_refunds_user_created_at_index").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const insertSupportTicketSchema = createInsertSchema(
  supportTicketsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSupportTicketMessageSchema = createInsertSchema(
  supportTicketMessagesTable,
).omit({ id: true, createdAt: true });
export const insertSupportTicketRefundSchema = createInsertSchema(
  supportTicketRefundsTable,
).omit({ id: true, createdAt: true });

export type SupportTicketRecord = typeof supportTicketsTable.$inferSelect;
export type SupportTicketMessageRecord =
  typeof supportTicketMessagesTable.$inferSelect;
export type SupportTicketRefundRecord =
  typeof supportTicketRefundsTable.$inferSelect;
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type InsertSupportTicketMessage = z.infer<
  typeof insertSupportTicketMessageSchema
>;
export type InsertSupportTicketRefund = z.infer<
  typeof insertSupportTicketRefundSchema
>;