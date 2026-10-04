import { createInsertSchema } from "drizzle-zod";
import {
  index,
  boolean,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const adminAccessChangesTable = pgTable(
  "admin_access_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    isAdmin: boolean("is_admin").notNull(),
    reason: varchar("reason", { length: 250 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("admin_access_changes_target_created_at_index").on(
      table.targetUserId,
      table.createdAt,
    ),
  ],
);

export const insertAdminAccessChangeSchema = createInsertSchema(
  adminAccessChangesTable,
).omit({ id: true, createdAt: true });
export type InsertAdminAccessChange = z.infer<
  typeof insertAdminAccessChangeSchema
>;
export type AdminAccessChangeRecord =
  typeof adminAccessChangesTable.$inferSelect;