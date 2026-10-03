import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Request, Response } from "express";
import {
  db,
  userSessionsTable,
  usersTable,
  type UserRecord,
} from "@workspace/db";

export const SESSION_COOKIE_NAME = "replenishcc_session";
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000;
const REMEMBERED_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured.");
  }
  return secret;
}

export function digestToken(token: string): string {
  return createHmac("sha256", getSessionSecret()).update(token).digest("hex");
}

export function toAuthUser(user: UserRecord) {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
  };
}

export async function createSession(
  userId: string,
  res: Response,
  rememberMe = false,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const duration = rememberMe ? REMEMBERED_SESSION_MS : SHORT_SESSION_MS;
  const expiresAt = new Date(Date.now() + duration);

  await db.insert(userSessionsTable).values({
    userId,
    tokenHash: digestToken(token),
    expiresAt,
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(rememberMe ? { maxAge: duration } : {}),
  });
}

export async function getCurrentUser(req: Request): Promise<UserRecord | null> {
  const token = req.signedCookies?.[SESSION_COOKIE_NAME];
  if (typeof token !== "string") return null;

  const [session] = await db
    .select()
    .from(userSessionsTable)
    .where(
      and(
        eq(userSessionsTable.tokenHash, digestToken(token)),
        gt(userSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) return null;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);

  return user ?? null;
}

export async function destroyCurrentSession(req: Request): Promise<void> {
  const token = req.signedCookies?.[SESSION_COOKIE_NAME];
  if (typeof token !== "string") return;

  await db
    .delete(userSessionsTable)
    .where(eq(userSessionsTable.tokenHash, digestToken(token)));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}