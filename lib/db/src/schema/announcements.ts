import { createInsertSchema } from "drizzle-zod";
import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  boolean,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const announcementsTable = pgTable(
  "announcements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 120 }).notNull(),
    body: text("body").notNull(),
    showAsPopup: boolean("show_as_popup").notNull().default(false),
    telegramUrl: text("telegram_url"),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("announcements_archive_published_at_index").on(
      table.archivedAt,
      table.publishedAt,
    ),
  ],
);

export const insertAnnouncementSchema = createInsertSchema(
  announcementsTable,
).omit({
  id: true,
  createdAt: true,
  publishedAt: true,
  archivedAt: true,
});

export type AnnouncementRecord = typeof announcementsTable.$inferSelect;
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;