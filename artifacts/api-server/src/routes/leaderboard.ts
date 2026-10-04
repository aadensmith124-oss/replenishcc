import { and, asc, desc, eq, gte, lt, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetWeeklyLeaderboardResponse } from "@workspace/api-zod";
import { db, depositsTable, usersTable } from "@workspace/db";
import { getCurrentUser } from "../lib/auth";
import { requireMemberPage } from "../lib/member-page-visibility";

const router: IRouter = Router();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function currentUtcWeek(now: Date) {
  const weekStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);

  return {
    weekStart,
    weekEnd: new Date(weekStart.getTime() + WEEK_MS),
  };
}

function maskEmail(email: string): string {
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return "Member";

  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1).toLowerCase();
  const visibleLength = Math.min(3, Math.max(0, localPart.length - 1));
  const visiblePrefix = localPart.slice(0, visibleLength).toLowerCase();
  return `${visiblePrefix}***@${domain}`;
}

router.get("/leaderboard/weekly", requireMemberPage("leaderboard"), async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view the leaderboard." });
    return;
  }

  const { weekStart, weekEnd } = currentUtcWeek(new Date());
  const totalCents = sum(depositsTable.amountCents);
  const rows = await db
    .select({
      email: usersTable.email,
      amountCents: totalCents,
    })
    .from(depositsTable)
    .innerJoin(usersTable, eq(depositsTable.userId, usersTable.id))
    .where(
      and(
        eq(depositsTable.status, "confirmed"),
        gte(depositsTable.confirmedAt, weekStart),
        lt(depositsTable.confirmedAt, weekEnd),
      ),
    )
    .groupBy(usersTable.id, usersTable.email)
    .orderBy(desc(totalCents), asc(usersTable.id))
    .limit(10);

  res.setHeader("Cache-Control", "no-store");
  res.json(
    GetWeeklyLeaderboardResponse.parse({
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      rankings: rows.map((row, index) => ({
        rank: index + 1,
        maskedEmail: maskEmail(row.email),
        amountCents: Number(row.amountCents ?? 0),
      })),
    }),
  );
});

export default router;