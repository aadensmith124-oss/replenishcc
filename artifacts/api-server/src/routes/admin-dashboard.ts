import { count, eq, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetAdminDashboardOverviewResponse,
  GetMemberPageVisibilityResponse,
  UpdateAdminMemberPageVisibilityBody,
  UpdateAdminMemberPageVisibilityResponse,
} from "@workspace/api-zod";
import {
  db,
  defaultMemberPageVisibility,
  giftCardInventoryTable,
  giftCardProductsTable,
  giftCardOrdersTable,
  licenseInventoryTable,
  licenseOrdersTable,
  licenseProductsTable,
  memberPageVisibilitySettingsTable,
  usersTable,
  type MemberPageKey,
} from "@workspace/db";
import { getCurrentUser, isDepositAdmin } from "../lib/auth";

const router: IRouter = Router();

function pageSettingsFromRow(row?: typeof memberPageVisibilitySettingsTable.$inferSelect) {
  return {
    pages: row
      ? {
          deposits: row.deposits,
          depositHistory: row.depositHistory,
          referrals: row.referrals,
          redeemCode: row.redeemCode,
          leaderboard: row.leaderboard,
          buyLogs: row.buyLogs,
          buyCards: row.buyCards,
          myLogOrders: row.myLogOrders,
          myCardOrders: row.myCardOrders,
          support: row.support,
          accountManagement: row.accountManagement,
        }
      : defaultMemberPageVisibility,
    updatedAt: row?.updatedAt ?? new Date(0),
  };
}

function pageSettingsColumns(pages: Record<MemberPageKey, boolean>) {
  return {
    deposits: pages.deposits,
    depositHistory: pages.depositHistory,
    referrals: pages.referrals,
    redeemCode: pages.redeemCode,
    leaderboard: pages.leaderboard,
    buyLogs: pages.buyLogs,
    buyCards: pages.buyCards,
    myLogOrders: pages.myLogOrders,
    myCardOrders: pages.myCardOrders,
    support: pages.support,
    accountManagement: pages.accountManagement,
  };
}

router.get("/admin/dashboard/overview", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view the admin overview." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const [userCount, logSales, cardSales, logStock, cardStock] =
    await Promise.all([
      db.select({ total: count() }).from(usersTable),
      db.select({ total: sum(licenseOrdersTable.totalCents) }).from(licenseOrdersTable),
      db.select({ total: sum(giftCardOrdersTable.totalCents) }).from(giftCardOrdersTable),
      db
        .select({ total: sum(licenseProductsTable.priceCents) })
        .from(licenseInventoryTable)
        .innerJoin(
          licenseProductsTable,
          eq(licenseProductsTable.id, licenseInventoryTable.productId),
        )
        .where(eq(licenseInventoryTable.status, "available")),
      db
        .select({ total: sum(giftCardProductsTable.priceCents) })
        .from(giftCardInventoryTable)
        .innerJoin(
          giftCardProductsTable,
          eq(giftCardProductsTable.id, giftCardInventoryTable.productId),
        )
        .where(eq(giftCardInventoryTable.status, "available")),
    ]);

  res.json(
    GetAdminDashboardOverviewResponse.parse({
      totalUsers: userCount[0]?.total ?? 0,
      totalSalesCents:
        Number(logSales[0]?.total ?? 0) + Number(cardSales[0]?.total ?? 0),
      stockWorthCents:
        Number(logStock[0]?.total ?? 0) + Number(cardStock[0]?.total ?? 0),
    }),
  );
});

router.get("/member/page-visibility", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view page availability." });
    return;
  }

  const [settings] = await db
    .select()
    .from(memberPageVisibilitySettingsTable)
    .where(eq(memberPageVisibilitySettingsTable.id, 1))
    .limit(1);

  res.json(
    GetMemberPageVisibilityResponse.parse(pageSettingsFromRow(settings)),
  );
});

router.put("/admin/member-page-visibility", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to update member page visibility." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const parsed = UpdateAdminMemberPageVisibilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a visibility state for every page." });
    return;
  }

  const pages = pageSettingsColumns(parsed.data.pages);
  const [settings] = await db
    .insert(memberPageVisibilitySettingsTable)
    .values({ id: 1, ...pages, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: memberPageVisibilitySettingsTable.id,
      set: { ...pages, updatedAt: new Date() },
    })
    .returning();

  if (!settings) {
    res.status(500).json({ error: "Page visibility could not be saved." });
    return;
  }

  res.json(
    UpdateAdminMemberPageVisibilityResponse.parse(
      pageSettingsFromRow(settings),
    ),
  );
});

export default router;