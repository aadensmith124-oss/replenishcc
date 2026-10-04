import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, memberPageVisibilitySettingsTable, type MemberPageKey } from "@workspace/db";
import { getCurrentUser, isDepositAdmin } from "./auth";

export async function isMemberPageEnabled(page: MemberPageKey): Promise<boolean> {
  const [settings] = await db
    .select({ enabled: memberPageVisibilitySettingsTable[page] })
    .from(memberPageVisibilitySettingsTable)
    .where(eq(memberPageVisibilitySettingsTable.id, 1))
    .limit(1);

  return settings?.enabled ?? true;
}

export function requireMemberPage(page: MemberPageKey): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user || isDepositAdmin(user) || (await isMemberPageEnabled(page))) {
      next();
      return;
    }

    res.status(403).json({
      error: "This member page is currently unavailable.",
    });
  };
}