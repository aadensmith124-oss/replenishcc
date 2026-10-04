import {
  asc,
  eq,
  ilike,
  inArray,
  sum,
} from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  CreateAdminBalanceAdjustmentBody,
  CreateAdminBalanceAdjustmentParams,
  CreateAdminBalanceAdjustmentResponse,
  GetAdminUsersQueryParams,
  GetAdminUsersResponse,
  UpdateAdminUserAccessBody,
  UpdateAdminUserAccessParams,
  UpdateAdminUserAccessResponse,
} from "@workspace/api-zod";
import {
  accountLedgerTable,
  adminAccessChangesTable,
  db,
  usersTable,
} from "@workspace/db";
import {
  getCurrentUser,
  getEnvironmentAdminEmails,
  isDepositAdmin,
  isEnvironmentAdminEmail,
} from "../lib/auth";

const router: IRouter = Router();

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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

router.get("/admin/users", async (req, res): Promise<void> => {
  const admin = await getCurrentUser(req);
  if (!admin) {
    res.status(401).json({ error: "Sign in to search member accounts." });
    return;
  }
  if (!isDepositAdmin(admin)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const parsed = GetAdminUsersQueryParams.safeParse(req.query);
  const email = parsed.success ? parsed.data.email.trim() : "";
  if (!parsed.success || email.length < 3) {
    res.status(400).json({ error: "Enter at least three characters of an email." });
    return;
  }

  const rows = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      username: usersTable.username,
      email: usersTable.email,
      createdAt: usersTable.createdAt,
      storedAdmin: usersTable.isAdmin,
      balanceCents: sum(accountLedgerTable.amountCents),
    })
    .from(usersTable)
    .leftJoin(accountLedgerTable, eq(accountLedgerTable.userId, usersTable.id))
    .where(ilike(usersTable.email, `%${escapeLike(email)}%`))
    .groupBy(usersTable.id)
    .orderBy(asc(usersTable.email))
    .limit(25);

  res.json(
    GetAdminUsersResponse.parse({
      users: rows.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        username: row.username,
        email: row.email,
        createdAt: row.createdAt,
        balanceCents: Number(row.balanceCents ?? 0),
        isAdmin: isDepositAdmin({
          email: row.email,
          isAdmin: row.storedAdmin,
        }),
        isEnvironmentAdmin: isEnvironmentAdminEmail(row.email),
      })),
    }),
  );
});

router.patch(
  "/admin/users/:userId/access",
  async (req, res): Promise<void> => {
    const admin = await getCurrentUser(req);
    if (!admin) {
      res.status(401).json({ error: "Sign in to change administrator access." });
      return;
    }
    if (!isDepositAdmin(admin)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = UpdateAdminUserAccessParams.safeParse(req.params);
    const body = UpdateAdminUserAccessBody.safeParse(req.body);
    if (!params.success || !body.success || !body.data.reason.trim()) {
      res.status(400).json({ error: "Check the account access change and reason." });
      return;
    }
    if (params.data.userId === admin.id) {
      res.status(400).json({
        error: "Ask another administrator to change your own access.",
      });
      return;
    }

    const reason = body.data.reason.trim();
    const result = await db.transaction(async (tx) => {
      // Lock all stored admins in a consistent order before checking whether
      // this change would leave the application without an administrator.
      const storedAdmins = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.isAdmin, true))
        .orderBy(asc(usersTable.id))
        .for("update");

      const [target] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, params.data.userId))
        .for("update")
        .limit(1);
      if (!target) return { kind: "not-found" as const };
      if (isEnvironmentAdminEmail(target.email)) {
        return { kind: "environment-managed" as const };
      }
      if (target.isAdmin === body.data.isAdmin) {
        return {
          kind: "unchanged" as const,
          isAdmin: target.isAdmin,
        };
      }

      if (!body.data.isAdmin && target.isAdmin) {
        const environmentEmails = getEnvironmentAdminEmails();
        const environmentAdmins = environmentEmails.length
          ? await tx
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(inArray(usersTable.email, environmentEmails))
              .limit(1)
          : [];
        if (storedAdmins.length <= 1 && environmentAdmins.length === 0) {
          return { kind: "last-admin" as const };
        }
      }

      const changedAt = new Date();
      const [updated] = await tx
        .update(usersTable)
        .set({ isAdmin: body.data.isAdmin, updatedAt: changedAt })
        .where(eq(usersTable.id, target.id))
        .returning({ id: usersTable.id, isAdmin: usersTable.isAdmin });
      if (!updated) throw new Error("Administrator access update failed.");

      await tx.insert(adminAccessChangesTable).values({
        targetUserId: target.id,
        actorUserId: admin.id,
        isAdmin: updated.isAdmin,
        reason,
      });

      return {
        kind: "updated" as const,
        userId: updated.id,
        isAdmin: updated.isAdmin,
      };
    });

    if (result.kind === "not-found") {
      res.status(404).json({ error: "Member account not found." });
      return;
    }
    if (result.kind === "environment-managed") {
      res.status(409).json({
        error: "This administrator account is managed by environment configuration.",
      });
      return;
    }
    if (result.kind === "last-admin") {
      res.status(409).json({
        error: "The last administrator cannot be removed.",
      });
      return;
    }

    res.json(
      UpdateAdminUserAccessResponse.parse({
        userId: result.kind === "updated" ? result.userId : params.data.userId,
        isAdmin: result.isAdmin,
        changed: result.kind === "updated",
      }),
    );
  },
);

router.post(
  "/admin/users/:userId/balance-adjustments",
  async (req, res): Promise<void> => {
    const admin = await getCurrentUser(req);
    if (!admin) {
      res.status(401).json({ error: "Sign in to adjust member balances." });
      return;
    }
    if (!isDepositAdmin(admin)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = CreateAdminBalanceAdjustmentParams.safeParse(req.params);
    const body = CreateAdminBalanceAdjustmentBody.safeParse(req.body);
    if (!params.success || !body.success || !body.data.reason.trim()) {
      res.status(400).json({ error: "Check the balance adjustment and reason." });
      return;
    }

    const reason = body.data.reason.trim();
    const amountCents =
      body.data.action === "credit"
        ? body.data.amountCents
        : -body.data.amountCents;
    const entryType =
      body.data.action === "credit" ? "admin_credit" : "admin_debit";

    const result = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, params.data.userId))
        .for("update")
        .limit(1);
      if (!target) return { kind: "not-found" as const };

      const findExistingRequest = async () => {
        const [existing] = await tx
          .select()
          .from(accountLedgerTable)
          .where(eq(accountLedgerTable.adminRequestId, body.data.requestId))
          .limit(1);
        return existing;
      };
      const matchesRequest = (
        existing: typeof accountLedgerTable.$inferSelect | undefined,
      ) =>
        existing?.userId === target.id &&
        existing.actorUserId === admin.id &&
        existing.entryType === entryType &&
        existing.amountCents === amountCents &&
        existing.reason === reason;

      const makeResponse = async (
        ledgerEntry: typeof accountLedgerTable.$inferSelect,
        replayed: boolean,
      ) => {
        const [balanceRow] = await tx
          .select({ balanceCents: sum(accountLedgerTable.amountCents) })
          .from(accountLedgerTable)
          .where(eq(accountLedgerTable.userId, target.id));

        return {
          id: ledgerEntry.id,
          userId: target.id,
          action: ledgerEntry.entryType === "admin_credit" ? "credit" : "debit",
          amountCents: Math.abs(ledgerEntry.amountCents),
          signedAmountCents: ledgerEntry.amountCents,
          reason: ledgerEntry.reason ?? "",
          adminName: admin.fullName,
          createdAt: ledgerEntry.createdAt,
          balanceCents: Number(balanceRow?.balanceCents ?? 0),
          replayed,
        };
      };

      const existing = await findExistingRequest();
      if (existing) {
        if (!matchesRequest(existing)) {
          return { kind: "request-conflict" as const };
        }
        return {
          kind: "adjusted" as const,
          adjustment: await makeResponse(existing, true),
        };
      }

      const [balanceRow] = await tx
        .select({ balanceCents: sum(accountLedgerTable.amountCents) })
        .from(accountLedgerTable)
        .where(eq(accountLedgerTable.userId, target.id));
      const currentBalanceCents = Number(balanceRow?.balanceCents ?? 0);
      if (
        body.data.action === "debit" &&
        currentBalanceCents < body.data.amountCents
      ) {
        return { kind: "insufficient-balance" as const };
      }

      const [inserted] = await tx
        .insert(accountLedgerTable)
        .values({
          userId: target.id,
          actorUserId: admin.id,
          adminRequestId: body.data.requestId,
          reason,
          entryType,
          amountCents,
        })
        .onConflictDoNothing({ target: accountLedgerTable.adminRequestId })
        .returning();

      if (!inserted) {
        const conflictingRequest = await findExistingRequest();
        if (!conflictingRequest || !matchesRequest(conflictingRequest)) {
          return { kind: "request-conflict" as const };
        }
        return {
          kind: "adjusted" as const,
          adjustment: await makeResponse(conflictingRequest, true),
        };
      }

      return {
        kind: "adjusted" as const,
        adjustment: await makeResponse(inserted, false),
      };
    });

    if (result.kind === "not-found") {
      res.status(404).json({ error: "Member account not found." });
      return;
    }
    if (result.kind === "insufficient-balance") {
      res.status(409).json({
        error: "This debit is greater than the member's current balance.",
      });
      return;
    }
    if (result.kind === "request-conflict") {
      res.status(409).json({
        error: "This adjustment request ID was already used for a different request.",
      });
      return;
    }

    res.json(
      CreateAdminBalanceAdjustmentResponse.parse({
        adjustment: result.adjustment,
      }),
    );
  },
);

export default router;