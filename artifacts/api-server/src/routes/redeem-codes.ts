import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sum } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAdminRedeemCodeBody,
  CreateAdminRedeemCodeResponse,
  CreateAdminRedeemCodeBatchBody,
  GetAdminRedeemCodesResponse,
  RedeemCodeBody,
  RedeemCodeResponse,
} from "@workspace/api-zod";
import {
  accountLedgerTable,
  db,
  redeemCodesTable,
  usersTable,
} from "@workspace/db";
import { getCurrentUser, isDepositAdmin } from "../lib/auth";
import { requireMemberPage } from "../lib/member-page-visibility";
import { createRateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();
const redeemCodeRateLimit = createRateLimit(
  10,
  60 * 60 * 1000,
  "redeem-code",
);

router.get("/admin/redeem-codes", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage redemption codes." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const rows = await db
    .select({
      id: redeemCodesTable.id,
      code: redeemCodesTable.code,
      amountCents: redeemCodesTable.amountCents,
      createdAt: redeemCodesTable.createdAt,
      redeemedAt: redeemCodesTable.redeemedAt,
      redeemedByName: usersTable.fullName,
      redeemedByEmail: usersTable.email,
    })
    .from(redeemCodesTable)
    .leftJoin(
      usersTable,
      eq(redeemCodesTable.redeemedByUserId, usersTable.id),
    )
    .orderBy(desc(redeemCodesTable.createdAt));

  res.json(
    GetAdminRedeemCodesResponse.parse({
      codes: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        redeemedAt: row.redeemedAt?.toISOString() ?? null,
      })),
    }),
  );
});

router.post("/admin/redeem-codes", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to create redemption codes." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const parsed = CreateAdminRedeemCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid code and positive amount." });
    return;
  }

  const suppliedCode = parsed.data.code?.trim().toUpperCase();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code =
      suppliedCode ?? randomBytes(8).toString("hex").toUpperCase();
    const [created] = await db
      .insert(redeemCodesTable)
      .values({
        code,
        amountCents: parsed.data.amountCents,
        createdByUserId: user.id,
      })
      .onConflictDoNothing({ target: redeemCodesTable.code })
      .returning();

    if (created) {
      res
        .status(201)
        .json(
          CreateAdminRedeemCodeResponse.parse({
            id: created.id,
            code: created.code,
            amountCents: created.amountCents,
            createdAt: created.createdAt.toISOString(),
            redeemedAt: null,
            redeemedByName: null,
            redeemedByEmail: null,
          }),
        );
      return;
    }

    if (suppliedCode) {
      res.status(409).json({ error: "That redemption code already exists." });
      return;
    }
  }

  res.status(503).json({ error: "A unique redemption code could not be created. Try again." });
});

router.post(
  "/admin/redeem-codes/bulk",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to create redemption codes." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const parsed = CreateAdminRedeemCodeBatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid batch size and positive amount." });
      return;
    }

    const created = await db
      .transaction(async (tx) => {
        const rows: Array<{
          id: string;
          code: string;
          amountCents: number;
          createdAt: Date;
        }> = [];
        const batchCodes = new Set<string>();

        for (let attempt = 0; attempt < 6 && rows.length < parsed.data.count; attempt += 1) {
          const values = [];
          while (values.length < parsed.data.count - rows.length) {
            const code = randomBytes(8).toString("hex").toUpperCase();
            if (batchCodes.has(code)) continue;
            batchCodes.add(code);
            values.push({
              code,
              amountCents: parsed.data.amountCents,
              createdByUserId: user.id,
            });
          }

          const inserted = await tx
            .insert(redeemCodesTable)
            .values(values)
            .onConflictDoNothing({ target: redeemCodesTable.code })
            .returning({
              id: redeemCodesTable.id,
              code: redeemCodesTable.code,
              amountCents: redeemCodesTable.amountCents,
              createdAt: redeemCodesTable.createdAt,
            });
          rows.push(...inserted);
        }

        if (rows.length !== parsed.data.count) {
          throw new Error("REDEEM_CODE_BATCH_FAILED");
        }
        return rows;
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === "REDEEM_CODE_BATCH_FAILED") {
          return null;
        }
        throw error;
      });

    if (!created) {
      res.status(503).json({
        error: "A full batch of unique codes could not be created. Try again.",
      });
      return;
    }

    res.status(201).json(
      GetAdminRedeemCodesResponse.parse({
        codes: created.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
          redeemedAt: null,
          redeemedByName: null,
          redeemedByEmail: null,
        })),
      }),
    );
  },
);

router.post(
  "/redeem-codes/redeem",
  requireMemberPage("redeemCode"),
  redeemCodeRateLimit,
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to redeem a code." });
      return;
    }

    const parsed = RedeemCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid redemption code." });
      return;
    }

    const normalizedCode = parsed.data.code.trim().toUpperCase();
    const result = await db.transaction(async (tx) => {
      const [code] = await tx
        .select()
        .from(redeemCodesTable)
        .where(eq(redeemCodesTable.code, normalizedCode))
        .for("update")
        .limit(1);

      if (!code || code.redeemedAt) return null;

      const redeemedAt = new Date();
      const [claimed] = await tx
        .update(redeemCodesTable)
        .set({ redeemedByUserId: user.id, redeemedAt })
        .where(
          and(
            eq(redeemCodesTable.id, code.id),
            isNull(redeemCodesTable.redeemedAt),
          ),
        )
        .returning({ id: redeemCodesTable.id });

      if (!claimed) return null;

      await tx.insert(accountLedgerTable).values({
        userId: user.id,
        depositId: null,
        redeemCodeId: code.id,
        entryType: "redeem_code",
        amountCents: code.amountCents,
      });

      const [balance] = await tx
        .select({ balanceCents: sum(accountLedgerTable.amountCents) })
        .from(accountLedgerTable)
        .where(eq(accountLedgerTable.userId, user.id));

      return {
        code: code.code,
        amountCents: code.amountCents,
        balanceCents: Number(balance?.balanceCents ?? 0),
      };
    });

    if (!result) {
      res.status(400).json({
        error: "That code is invalid or has already been redeemed.",
      });
      return;
    }

    res.json(RedeemCodeResponse.parse(result));
  },
);

export default router;