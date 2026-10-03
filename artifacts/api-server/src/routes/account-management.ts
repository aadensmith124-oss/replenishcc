import { and, desc, eq, ne } from "drizzle-orm";
import { compare, hash } from "bcryptjs";
import { Router, type IRouter, type Request } from "express";
import {
  CancelMyAccountDeletionRequestResponse,
  ChangeAuthPasswordBody,
  ChangeAuthPasswordResponse,
  CreateAccountDeletionRequestBody,
  CreateAccountDeletionRequestResponse,
  GetAdminAccountDeletionRequestsResponse,
  GetMyAccountDeletionRequestResponse,
  ReviewAccountDeletionRequestBody,
  ReviewAccountDeletionRequestParams,
  ReviewAccountDeletionRequestResponse,
} from "@workspace/api-zod";
import {
  accountDeletionRequestsTable,
  db,
  passwordResetTokensTable,
  userSessionsTable,
  usersTable,
} from "@workspace/db";
import {
  digestToken,
  getCurrentUser,
  isDepositAdmin,
  SESSION_COOKIE_NAME,
} from "../lib/auth";
import { createRateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();
const passwordChangeLimit = createRateLimit(
  5,
  15 * 60 * 1000,
  "password-change",
);
const deletionRequestLimit = createRateLimit(
  5,
  60 * 60 * 1000,
  "account-deletion-request",
);

function isSameOriginWrite(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  if (!isSameOriginWrite(req)) {
    res.status(403).json({ error: "Request origin is not allowed." });
    return;
  }
  next();
});

router.patch(
  "/auth/password",
  passwordChangeLimit,
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to change your password." });
      return;
    }

    const parsed = ChangeAuthPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please check your password details." });
      return;
    }
    if (parsed.data.newPassword !== parsed.data.confirmPassword) {
      res.status(400).json({ error: "Your new passwords do not match." });
      return;
    }
    if (parsed.data.newPassword === parsed.data.currentPassword) {
      res.status(400).json({
        error: "Choose a new password that differs from your current password.",
      });
      return;
    }

    const passwordMatches = await compare(
      parsed.data.currentPassword,
      user.passwordHash,
    );
    if (!passwordMatches) {
      res.status(400).json({ error: "Your current password is incorrect." });
      return;
    }

    const token = req.signedCookies?.[SESSION_COOKIE_NAME];
    const passwordHash = await hash(parsed.data.newPassword, 12);
    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));
      await tx
        .delete(passwordResetTokensTable)
        .where(eq(passwordResetTokensTable.userId, user.id));
      if (typeof token === "string") {
        await tx
          .delete(userSessionsTable)
          .where(
            and(
              eq(userSessionsTable.userId, user.id),
              ne(userSessionsTable.tokenHash, digestToken(token)),
            ),
          );
      }
    });

    res.json(
      ChangeAuthPasswordResponse.parse({
        message:
          "Your password has been changed. Other signed-in sessions have been ended.",
      }),
    );
  },
);

router.get(
  "/account-deletion-requests/me",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to view your account settings." });
      return;
    }

    const [request] = await db
      .select()
      .from(accountDeletionRequestsTable)
      .where(eq(accountDeletionRequestsTable.userId, user.id))
      .orderBy(desc(accountDeletionRequestsTable.requestedAt))
      .limit(1);
    res.json(
      GetMyAccountDeletionRequestResponse.parse({
        request: request
          ? {
              id: request.id,
              status: request.status,
              requestedAt: request.requestedAt,
              reason: request.reason,
              reviewedAt: request.reviewedAt,
              reviewNote: request.reviewNote,
            }
          : null,
      }),
    );
  },
);

router.post(
  "/account-deletion-requests",
  deletionRequestLimit,
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to request account deletion." });
      return;
    }

    const parsed = CreateAccountDeletionRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Please check your deletion request." });
      return;
    }

    try {
      const [request] = await db
        .insert(accountDeletionRequestsTable)
        .values({
          userId: user.id,
          reason: parsed.data.reason?.trim() || null,
        })
        .returning();
      res.status(201).json(
        CreateAccountDeletionRequestResponse.parse({
          request: request
            ? {
                id: request.id,
                status: request.status,
                requestedAt: request.requestedAt,
                reason: request.reason,
                reviewedAt: request.reviewedAt,
                reviewNote: request.reviewNote,
              }
            : null,
        }),
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        res.status(409).json({
          error: "You already have a pending account deletion request.",
        });
        return;
      }
      throw error;
    }
  },
);

router.delete(
  "/account-deletion-requests/me",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to cancel your deletion request." });
      return;
    }

    const [request] = await db
      .delete(accountDeletionRequestsTable)
      .where(
        and(
          eq(accountDeletionRequestsTable.userId, user.id),
          eq(accountDeletionRequestsTable.status, "pending"),
        ),
      )
      .returning({ id: accountDeletionRequestsTable.id });
    if (!request) {
      res.status(404).json({ error: "No pending deletion request exists." });
      return;
    }
    res.json(
      CancelMyAccountDeletionRequestResponse.parse({
        message: "Your account deletion request has been cancelled.",
      }),
    );
  },
);

router.get(
  "/admin/account-deletion-requests",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to review account requests." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const rows = await db
      .select({
        id: accountDeletionRequestsTable.id,
        userId: accountDeletionRequestsTable.userId,
        memberName: usersTable.fullName,
        memberEmail: usersTable.email,
        requestedAt: accountDeletionRequestsTable.requestedAt,
        reason: accountDeletionRequestsTable.reason,
      })
      .from(accountDeletionRequestsTable)
      .innerJoin(
        usersTable,
        eq(accountDeletionRequestsTable.userId, usersTable.id),
      )
      .where(eq(accountDeletionRequestsTable.status, "pending"))
      .orderBy(accountDeletionRequestsTable.requestedAt);
    res.json(
      GetAdminAccountDeletionRequestsResponse.parse({ requests: rows }),
    );
  },
);

router.patch(
  "/admin/account-deletion-requests/:requestId",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to review account requests." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = ReviewAccountDeletionRequestParams.safeParse(req.params);
    const parsed = ReviewAccountDeletionRequestBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Please check the review details." });
      return;
    }

    const reviewedAt = new Date();
    const note = parsed.data.note?.trim() || null;
    const result = await db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(accountDeletionRequestsTable)
        .where(eq(accountDeletionRequestsTable.id, params.data.requestId))
        .for("update")
        .limit(1);

      if (!request) return { kind: "not-found" as const };
      if (request.status !== "pending") return { kind: "not-pending" as const };

      const [member] = await tx
        .select({
          id: usersTable.id,
          fullName: usersTable.fullName,
          email: usersTable.email,
        })
        .from(usersTable)
        .where(eq(usersTable.id, request.userId))
        .limit(1);
      if (!member) return { kind: "not-found" as const };

      if (parsed.data.action === "reject") {
        await tx
          .update(accountDeletionRequestsTable)
          .set({
            status: "rejected",
            reviewedAt,
            reviewedByUserId: user.id,
            reviewNote: note,
          })
          .where(eq(accountDeletionRequestsTable.id, request.id));
        return {
          kind: "reviewed" as const,
          data: {
            id: request.id,
            userId: member.id,
            memberName: member.fullName,
            memberEmail: member.email,
            status: "rejected" as const,
            requestedAt: request.requestedAt,
            reviewedAt,
            reason: request.reason,
            reviewNote: note,
          },
        };
      }

      await tx.delete(usersTable).where(eq(usersTable.id, member.id));
      return {
        kind: "reviewed" as const,
        data: {
          id: request.id,
          userId: member.id,
          memberName: member.fullName,
          memberEmail: member.email,
          status: "approved" as const,
          requestedAt: request.requestedAt,
          reviewedAt,
          reason: request.reason,
          reviewNote: note,
        },
      };
    });

    if (result.kind === "not-found") {
      res.status(404).json({ error: "Account deletion request not found." });
      return;
    }
    if (result.kind === "not-pending") {
      res.status(400).json({
        error: "This account deletion request is no longer pending.",
      });
      return;
    }
    res.json(ReviewAccountDeletionRequestResponse.parse(result.data));
  },
);

export default router;