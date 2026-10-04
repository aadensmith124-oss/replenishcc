import { boolean, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

export const memberPageKeys = [
  "deposits",
  "depositHistory",
  "referrals",
  "redeemCode",
  "leaderboard",
  "buyLogs",
  "buyCards",
  "myLogOrders",
  "myCardOrders",
  "support",
  "accountManagement",
] as const;

export type MemberPageKey = (typeof memberPageKeys)[number];

export const defaultMemberPageVisibility = {
  deposits: true,
  depositHistory: true,
  referrals: true,
  redeemCode: true,
  leaderboard: true,
  buyLogs: true,
  buyCards: true,
  myLogOrders: true,
  myCardOrders: true,
  support: true,
  accountManagement: true,
} satisfies Record<MemberPageKey, boolean>;

export const memberPageVisibilitySettingsTable = pgTable(
  "member_page_visibility_settings",
  {
    id: integer("id").primaryKey().default(1),
    deposits: boolean("deposits_enabled").notNull().default(true),
    depositHistory: boolean("deposit_history_enabled").notNull().default(true),
    referrals: boolean("referrals_enabled").notNull().default(true),
    redeemCode: boolean("redeem_code_enabled").notNull().default(true),
    leaderboard: boolean("leaderboard_enabled").notNull().default(true),
    buyLogs: boolean("buy_logs_enabled").notNull().default(true),
    buyCards: boolean("buy_cards_enabled").notNull().default(true),
    myLogOrders: boolean("my_log_orders_enabled").notNull().default(true),
    myCardOrders: boolean("my_card_orders_enabled").notNull().default(true),
    support: boolean("support_enabled").notNull().default(true),
    accountManagement: boolean("account_management_enabled")
      .notNull()
      .default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);