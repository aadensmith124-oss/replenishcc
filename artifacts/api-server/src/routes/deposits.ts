import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, count, desc, eq, gte, isNull, sum } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  CreateCryptoDepositBody,
  CreateCryptoDepositResponse,
  CreateManualDepositBody,
  CreateManualDepositResponse,
  GetAdminDepositMethodsResponse,
  GetAdminDepositsResponse,
  GetCryptoCurrenciesResponse,
  GetDepositMethodsResponse,
  GetMyDepositsResponse,
  GetMyReferralSummaryResponse,
  PostNowPaymentsWebhookBody,
  PostNowPaymentsWebhookResponse,
  ReviewDepositBody,
  ReviewDepositParams,
  ReviewDepositResponse,
  UpdateAdminDepositMethodsBody,
  UpdateAdminDepositMethodsResponse,
} from "@workspace/api-zod";
import {
  accountLedgerTable,
  db,
  depositSettingsTable,
  depositsTable,
  usersTable,
  type DepositRecord,
} from "@workspace/db";
import { createRateLimit } from "../middlewares/rate-limit";
import { getCurrentUser, isDepositAdmin } from "../lib/auth";
import {
  isMemberPageEnabled,
  requireMemberPage,
} from "../lib/member-page-visibility";

const router: IRouter = Router();
const MAXIMUM_AMOUNT_CENTS = 1_000_000;
const REFERRAL_MINIMUM_AMOUNT_CENTS = 10_000;
const REFERRAL_REWARD_PERCENT = 5;
const NOWPAYMENTS_API = "https://api.nowpayments.io/v1";
const createManualDepositLimit = createRateLimit(
  10,
  60 * 60 * 1000,
  "manual-deposit",
);
const createCryptoDepositLimit = createRateLimit(
  10,
  60 * 60 * 1000,
  "crypto-deposit",
);

function configuredNowPayments(): boolean {
  return Boolean(
    process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET,
  );
}

function createManualPaymentNote(): string {
  const randomNumber =
    BigInt(`0x${randomBytes(8).toString("hex")}`) % 90_000_000_000_000_000n +
    10_000_000_000_000_000n;
  return `Food - ${randomNumber.toString()}`;
}

async function getDepositSettings() {
  await db
    .insert(depositSettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing();

  const [settings] = await db
    .select()
    .from(depositSettingsTable)
    .where(eq(depositSettingsTable.id, 1))
    .limit(1);

  if (!settings) {
    throw new Error("Deposit settings could not be loaded.");
  }
  return settings;
}

function serializeDeposit(deposit: DepositRecord) {
  return {
    id: deposit.id,
    method: deposit.method,
    amountCents: deposit.amountCents,
    transactionId: deposit.providerPaymentId,
    status: deposit.status,
    providerStatus: deposit.providerStatus,
    paymentAddress: deposit.paymentAddress,
    payAmount: deposit.payAmount,
    payCurrency: deposit.payCurrency,
    payinExtraId: deposit.payinExtraId,
    paymentUrl: deposit.paymentUrl,
    recipient: deposit.recipient,
    referenceCode: deposit.referenceCode,
    rejectionReason: deposit.rejectionReason,
    createdAt: deposit.createdAt,
    confirmedAt: deposit.confirmedAt,
    expiresAt: deposit.expiresAt,
  };
}

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
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.path === "/deposits/nowpayments/webhook"
  ) {
    next();
    return;
  }

  if (!isSameOriginWrite(req)) {
    res.status(403).json({ error: "Request origin is not allowed." });
    return;
  }
  next();
});

function amountCentsFromProviderPrice(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const fractional = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fractional;
  return Number.isSafeInteger(cents) ? cents : null;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortObject(source[key]);
        return result;
      }, {});
  }
  return value;
}

function isValidNowPaymentsSignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string,
): boolean {
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret)
    .update(JSON.stringify(sortObject(payload)))
    .digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function fetchNowPaymentsCurrencies(apiKey: string): Promise<string[]> {
  const response = await fetch(`${NOWPAYMENTS_API}/currencies`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => null)) as
    | { currencies?: unknown }
    | null;

  if (
    !response.ok ||
    !result ||
    !Array.isArray(result.currencies) ||
    !result.currencies.every((currency) => typeof currency === "string")
  ) {
    throw new Error(`NOWPayments currency request failed (${response.status}).`);
  }

  return result.currencies.map((currency) => currency.toLowerCase());
}

async function appendDepositCredits(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  deposit: DepositRecord,
): Promise<void> {
  await tx
    .insert(accountLedgerTable)
    .values({
      userId: deposit.userId,
      depositId: deposit.id,
      entryType: "deposit",
      amountCents: deposit.amountCents,
    })
    .onConflictDoNothing();

  if (deposit.amountCents < REFERRAL_MINIMUM_AMOUNT_CENTS) return;

  const [user] = await tx
    .select({ referredById: usersTable.referredById })
    .from(usersTable)
    .where(eq(usersTable.id, deposit.userId))
    .limit(1);

  if (!user?.referredById) return;

  await tx
    .insert(accountLedgerTable)
    .values({
      userId: user.referredById,
      depositId: deposit.id,
      entryType: "referral_reward",
      amountCents: Math.round(
        (deposit.amountCents * REFERRAL_REWARD_PERCENT) / 100,
      ),
    })
    .onConflictDoNothing();
}

async function ensureReferralCode(
  userId: string,
  currentCode: string | null,
): Promise<string> {
  if (currentCode) return currentCode;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const referralCode = randomBytes(8).toString("hex").toUpperCase();
    const [updated] = await db
      .update(usersTable)
      .set({ referralCode })
      .where(and(eq(usersTable.id, userId), isNull(usersTable.referralCode)))
      .returning({ referralCode: usersTable.referralCode });
    if (updated?.referralCode) return updated.referralCode;

    const [existing] = await db
      .select({ referralCode: usersTable.referralCode })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (existing?.referralCode) return existing.referralCode;
  }

  throw new Error("A referral code could not be assigned.");
}

router.get("/deposits/methods", requireMemberPage("deposits"), async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view deposit methods." });
    return;
  }

  const settings = await getDepositSettings();
  res.json(
    GetDepositMethodsResponse.parse({
      cashAppHandle: settings.cashAppHandle,
      chimeHandle: settings.chimeHandle,
      applePayRecipient: settings.applePayRecipient,
      venmoHandle: settings.venmoHandle,
      cashAppEnabled: settings.cashAppEnabled,
      chimeEnabled: settings.chimeEnabled,
      applePayEnabled: settings.applePayEnabled,
      venmoEnabled: settings.venmoEnabled,
      nowPaymentsEnabled: settings.nowPaymentsEnabled,
      nowPaymentsConfigured: configuredNowPayments(),
      minimumAmountCents: settings.minimumAmountCents,
      maximumAmountCents: MAXIMUM_AMOUNT_CENTS,
    }),
  );
});

router.get("/deposits/me", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view your deposits." });
    return;
  }

  const [deposits, balanceResult] = await Promise.all([
    isMemberPageEnabled("depositHistory").then((visible) =>
      visible
        ? db
            .select()
            .from(depositsTable)
            .where(eq(depositsTable.userId, user.id))
            .orderBy(desc(depositsTable.createdAt))
        : [],
    ),
    db
      .select({ balanceCents: sum(accountLedgerTable.amountCents) })
      .from(accountLedgerTable)
      .where(eq(accountLedgerTable.userId, user.id)),
  ]);

  res.json(
    GetMyDepositsResponse.parse({
      balanceCents: Number(balanceResult[0]?.balanceCents ?? 0),
      deposits: deposits.map(serializeDeposit),
    }),
  );
});

router.post(
  "/deposits/manual",
  requireMemberPage("deposits"),
  createManualDepositLimit,
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to request a deposit." });
      return;
    }

    const parsed = CreateManualDepositBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid deposit method and amount." });
      return;
    }

    const settings = await getDepositSettings();
    const methodSettings = {
      cashapp: {
        enabled: settings.cashAppEnabled,
        recipient: settings.cashAppHandle,
      },
      chime: { enabled: settings.chimeEnabled, recipient: settings.chimeHandle },
      applepay: {
        enabled: settings.applePayEnabled,
        recipient: settings.applePayRecipient,
      },
      venmo: { enabled: settings.venmoEnabled, recipient: settings.venmoHandle },
    }[parsed.data.method];
    if (!methodSettings.enabled) {
      res.status(409).json({
        error: "This payment method is currently hidden by an administrator.",
      });
      return;
    }
    if (parsed.data.amountCents < settings.minimumAmountCents) {
      res.status(400).json({
        error: `The minimum deposit is $${(settings.minimumAmountCents / 100).toFixed(2)}.`,
      });
      return;
    }
    const recipient = methodSettings.recipient;
    if (!recipient) {
      res.status(400).json({
        error: "This manual payment method is not configured yet.",
      });
      return;
    }

    const [deposit] = await db
      .insert(depositsTable)
      .values({
        userId: user.id,
        method: parsed.data.method,
        amountCents: parsed.data.amountCents,
        recipient,
        referenceCode: createManualPaymentNote(),
      })
      .returning();

    if (!deposit) {
      res.status(500).json({ error: "The deposit request could not be saved." });
      return;
    }
    res
      .status(201)
      .json(CreateManualDepositResponse.parse(serializeDeposit(deposit)));
  },
);

router.get(
  "/deposits/crypto/currencies",
  requireMemberPage("deposits"),
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to view payment currencies." });
      return;
    }

    const settings = await getDepositSettings();
    if (!settings.nowPaymentsEnabled) {
      res.status(409).json({
        error: "Cryptocurrency deposits are currently hidden by an administrator.",
      });
      return;
    }

    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    if (!apiKey || !process.env.NOWPAYMENTS_IPN_SECRET) {
      res.status(503).json({ error: "Cryptocurrency deposits are not configured." });
      return;
    }

    try {
      const currencies = await fetchNowPaymentsCurrencies(apiKey);
      res.json(GetCryptoCurrenciesResponse.parse({ currencies }));
    } catch (error) {
      req.log.error({ err: error }, "NOWPayments currencies request failed");
      res.status(503).json({
        error: "NOWPayments is temporarily unavailable. Please try again.",
      });
    }
  },
);

router.post(
  "/deposits/crypto",
  requireMemberPage("deposits"),
  createCryptoDepositLimit,
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to create a deposit." });
      return;
    }

    const parsed = CreateCryptoDepositBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid deposit amount and currency." });
      return;
    }

    const settings = await getDepositSettings();
    if (!settings.nowPaymentsEnabled) {
      res.status(409).json({
        error: "Cryptocurrency deposits are currently hidden by an administrator.",
      });
      return;
    }
    if (parsed.data.amountCents < settings.minimumAmountCents) {
      res.status(400).json({
        error: `The minimum deposit is $${(settings.minimumAmountCents / 100).toFixed(2)}.`,
      });
      return;
    }

    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!apiKey || !ipnSecret) {
      res.status(503).json({ error: "Cryptocurrency deposits are not configured." });
      return;
    }

    const payCurrency = parsed.data.payCurrency.toLowerCase();
    let availableCurrencies: string[];
    try {
      availableCurrencies = await fetchNowPaymentsCurrencies(apiKey);
    } catch (error) {
      req.log.error({ err: error }, "NOWPayments currency validation failed");
      res.status(503).json({
        error: "NOWPayments is temporarily unavailable. Please try again.",
      });
      return;
    }
    if (!availableCurrencies.includes(payCurrency)) {
      res.status(400).json({ error: "That cryptocurrency is not currently available." });
      return;
    }

    const depositId = randomUUID();
    const [initialDeposit] = await db
      .insert(depositsTable)
      .values({
        id: depositId,
        userId: user.id,
        method: "nowpayments",
        amountCents: parsed.data.amountCents,
      })
      .returning();

    if (!initialDeposit) {
      res.status(500).json({ error: "The deposit request could not be saved." });
      return;
    }

    try {
      const host = req.get("host");
      if (!host) throw new Error("The request host is missing.");
      const callbackUrl = new URL(
        "/api/deposits/nowpayments/webhook",
        `${req.protocol}://${host}`,
      );
      if (
        process.env.NODE_ENV === "production" &&
        callbackUrl.protocol !== "https:"
      ) {
        throw new Error("A secure callback URL is required in production.");
      }

      const response = await fetch(`${NOWPAYMENTS_API}/payment`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          price_amount: parsed.data.amountCents / 100,
          price_currency: "usd",
          pay_currency: payCurrency,
          ipn_callback_url: callbackUrl.toString(),
          order_id: depositId,
          order_description: `ReplenishCC deposit ${depositId}`,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const providerResult = (await response.json().catch(() => null)) as
        | Record<string, unknown>
        | null;

      const paymentId =
        providerResult?.payment_id == null
          ? ""
          : String(providerResult.payment_id);
      const paymentAddress =
        typeof providerResult?.pay_address === "string"
          ? providerResult.pay_address
          : "";
      const responsePayAmount =
        providerResult?.pay_amount == null
          ? ""
          : String(providerResult.pay_amount);
      const responsePayCurrency =
        typeof providerResult?.pay_currency === "string"
          ? providerResult.pay_currency.toLowerCase()
          : payCurrency;
      const responseProviderStatus = providerResult?.payment_status;
      const responseExtraId = providerResult?.payin_extra_id;
      const responsePaymentUrl = providerResult?.payment_url;

      if (!response.ok || !paymentId || !paymentAddress || !responsePayAmount) {
        await db
          .update(depositsTable)
          .set({ status: "failed", providerStatus: "creation_failed" })
          .where(eq(depositsTable.id, depositId));
        req.log.error(
          { providerStatus: response.status },
          "NOWPayments did not create a payment",
        );
        res.status(503).json({
          error: "NOWPayments could not create this payment. Please try again.",
        });
        return;
      }

      const expiration =
        typeof providerResult?.expiration_estimate_date === "string"
          ? new Date(providerResult.expiration_estimate_date)
          : null;
      const expiresAt =
        expiration && Number.isNaN(expiration.getTime()) ? null : expiration;
      const [deposit] = await db
        .update(depositsTable)
        .set({
          providerPaymentId: paymentId,
          providerStatus:
            typeof responseProviderStatus === "string"
              ? responseProviderStatus.slice(0, 40)
              : "waiting",
          paymentAddress,
          payAmount: responsePayAmount,
          payCurrency: responsePayCurrency,
          payinExtraId:
            typeof responseExtraId === "string" ? responseExtraId : null,
          paymentUrl:
            typeof responsePaymentUrl === "string"
              ? responsePaymentUrl
              : null,
          expiresAt,
        })
        .where(eq(depositsTable.id, depositId))
        .returning();

      if (!deposit) {
        throw new Error("The provider payment could not be linked to its deposit.");
      }

      res
        .status(201)
        .json(CreateCryptoDepositResponse.parse({ deposit: serializeDeposit(deposit) }));
    } catch (error) {
      await db
        .update(depositsTable)
        .set({ status: "failed", providerStatus: "creation_failed" })
        .where(eq(depositsTable.id, depositId));
      req.log.error({ err: error }, "NOWPayments payment creation failed");
      if (!res.headersSent) {
        res.status(503).json({
          error: "NOWPayments could not create this payment. Please try again.",
        });
      }
    }
  },
);

router.post(
  "/deposits/nowpayments/webhook",
  async (req, res): Promise<void> => {
    const secret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!secret) {
      res.status(503).json({
        error: "NOWPayments webhook verification is not configured.",
      });
      return;
    }

    const parsed = PostNowPaymentsWebhookBody.safeParse(req.body);
    const signature = req.get("x-nowpayments-sig");
    if (
      !parsed.success ||
      !signature ||
      !isValidNowPaymentsSignature(parsed.data, signature, secret)
    ) {
      res.status(401).json({ error: "Invalid NOWPayments signature." });
      return;
    }

    const payload = parsed.data;
    const depositId =
      typeof payload.order_id === "string" ? payload.order_id : "";
    const paymentId =
      payload.payment_id == null ? "" : String(payload.payment_id);
    const providerStatus =
      typeof payload.payment_status === "string"
        ? payload.payment_status.toLowerCase()
        : "";
    const amountCents = amountCentsFromProviderPrice(payload.price_amount);
    if (
      !depositId ||
      !paymentId ||
      !providerStatus ||
      amountCents === null ||
      String(payload.price_currency ?? "").toLowerCase() !== "usd"
    ) {
      res.status(400).json({ error: "The payment notification is incomplete." });
      return;
    }

    const applied = await db.transaction(async (tx) => {
      const [deposit] = await tx
        .select()
        .from(depositsTable)
        .where(eq(depositsTable.id, depositId))
        .for("update")
        .limit(1);

      if (
        !deposit ||
        deposit.method !== "nowpayments" ||
        deposit.providerPaymentId !== paymentId ||
        deposit.amountCents !== amountCents
      ) {
        return false;
      }

      if (deposit.status === "confirmed") return true;

      const nextStatus =
        providerStatus === "finished"
          ? "confirmed"
          : providerStatus === "failed"
            ? "failed"
            : providerStatus === "expired"
              ? "expired"
              : providerStatus === "refunded"
                ? "refunded"
                : "pending";
      const confirmedAt =
        nextStatus === "confirmed" ? new Date() : deposit.confirmedAt;
      const [updated] = await tx
        .update(depositsTable)
        .set({
          status: nextStatus,
          providerStatus: providerStatus.slice(0, 40),
          confirmedAt,
        })
        .where(eq(depositsTable.id, deposit.id))
        .returning();

      if (updated && nextStatus === "confirmed") {
        await appendDepositCredits(tx, updated);
      }
      return Boolean(updated);
    });

    if (!applied) {
      req.log.warn(
        { paymentId },
        "A valid NOWPayments notification did not match a local deposit",
      );
    }
    res.json(
      PostNowPaymentsWebhookResponse.parse({
        message: "Payment notification accepted.",
      }),
    );
  },
);

router.get("/referrals/me", requireMemberPage("referrals"), async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view your referral summary." });
    return;
  }

  const referralCode = await ensureReferralCode(user.id, user.referralCode);
  const [referralCount, qualifiedReferrals, confirmedDeposits, rewards] =
    await Promise.all([
      db
        .select({ total: count() })
        .from(usersTable)
        .where(eq(usersTable.referredById, user.id)),
      db
        .selectDistinct({ referredUserId: usersTable.id })
        .from(usersTable)
        .innerJoin(depositsTable, eq(depositsTable.userId, usersTable.id))
        .where(
          and(
            eq(usersTable.referredById, user.id),
            eq(depositsTable.status, "confirmed"),
            gte(depositsTable.amountCents, REFERRAL_MINIMUM_AMOUNT_CENTS),
          ),
        ),
      db
        .select({ total: sum(depositsTable.amountCents) })
        .from(usersTable)
        .innerJoin(depositsTable, eq(depositsTable.userId, usersTable.id))
        .where(
          and(
            eq(usersTable.referredById, user.id),
            eq(depositsTable.status, "confirmed"),
          ),
        ),
      db
        .select({ total: sum(accountLedgerTable.amountCents) })
        .from(accountLedgerTable)
        .where(
          and(
            eq(accountLedgerTable.userId, user.id),
            eq(accountLedgerTable.entryType, "referral_reward"),
          ),
        ),
    ]);

  const totalReferrals = referralCount[0]?.total ?? 0;

  res.json(
    GetMyReferralSummaryResponse.parse({
      referralCode,
      totalReferrals,
      paidReferrals: qualifiedReferrals.length,
      pendingReferrals: Math.max(0, totalReferrals - qualifiedReferrals.length),
      totalRewardsCents: Number(rewards[0]?.total ?? 0),
      totalDepositsCents: Number(confirmedDeposits[0]?.total ?? 0),
      minimumDepositCents: REFERRAL_MINIMUM_AMOUNT_CENTS,
      rewardPercent: REFERRAL_REWARD_PERCENT,
    }),
  );
});

router.get("/admin/deposits", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to review deposits." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const rows = await db
    .select({
      deposit: depositsTable,
      memberName: usersTable.fullName,
      memberEmail: usersTable.email,
    })
    .from(depositsTable)
    .innerJoin(usersTable, eq(depositsTable.userId, usersTable.id))
    .orderBy(desc(depositsTable.createdAt));

  res.json(
    GetAdminDepositsResponse.parse({
      deposits: rows.map(({ deposit, memberName, memberEmail }) => ({
        ...serializeDeposit(deposit),
        memberName,
        memberEmail,
      })),
    }),
  );
});

router.patch(
  "/admin/deposits/:depositId",
  async (req, res): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to review deposits." });
      return;
    }
    if (!isDepositAdmin(user)) {
      res.status(403).json({ error: "Admin access is required." });
      return;
    }

    const params = ReviewDepositParams.safeParse(req.params);
    const parsed = ReviewDepositBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Choose a valid deposit action." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [deposit] = await tx
        .select()
        .from(depositsTable)
        .where(eq(depositsTable.id, params.data.depositId))
        .for("update")
        .limit(1);

      if (!deposit) return { kind: "not-found" as const };
      if (deposit.status !== "pending" || deposit.method === "nowpayments") {
        return { kind: "not-pending" as const };
      }

      const now = new Date();
      const nextStatus =
        parsed.data.action === "approve" ? "confirmed" : "rejected";
      const reason = parsed.data.reason?.trim() || null;
      const [updated] = await tx
        .update(depositsTable)
        .set({
          status: nextStatus,
          reviewedByUserId: user.id,
          reviewedAt: now,
          reviewerNote: reason,
          rejectionReason:
            parsed.data.action === "reject"
              ? reason ?? "Rejected by an administrator."
              : null,
          confirmedAt: nextStatus === "confirmed" ? now : null,
        })
        .where(eq(depositsTable.id, deposit.id))
        .returning();

      if (updated && nextStatus === "confirmed") {
        await appendDepositCredits(tx, updated);
      }
      return updated
        ? { kind: "updated" as const, deposit: updated }
        : { kind: "not-found" as const };
    });

    if (result.kind === "not-found") {
      res.status(404).json({ error: "Deposit request not found." });
      return;
    }
    if (result.kind === "not-pending") {
      res.status(400).json({ error: "This deposit is no longer awaiting review." });
      return;
    }
    res.json(ReviewDepositResponse.parse(serializeDeposit(result.deposit)));
  },
);

router.get("/admin/deposit-methods", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage deposit settings." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const settings = await getDepositSettings();
  res.json(
    GetAdminDepositMethodsResponse.parse({
      cashAppHandle: settings.cashAppHandle,
      chimeHandle: settings.chimeHandle,
      applePayRecipient: settings.applePayRecipient,
      venmoHandle: settings.venmoHandle,
      cashAppEnabled: settings.cashAppEnabled,
      chimeEnabled: settings.chimeEnabled,
      applePayEnabled: settings.applePayEnabled,
      venmoEnabled: settings.venmoEnabled,
      nowPaymentsEnabled: settings.nowPaymentsEnabled,
      nowPaymentsConfigured: configuredNowPayments(),
      minimumAmountCents: settings.minimumAmountCents,
      maximumAmountCents: MAXIMUM_AMOUNT_CENTS,
    }),
  );
});

router.put("/admin/deposit-methods", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage deposit settings." });
    return;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }

  const parsed = UpdateAdminDepositMethodsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter valid payment settings." });
    return;
  }

  const cashAppHandle = parsed.data.cashAppHandle?.trim() || null;
  const chimeHandle = parsed.data.chimeHandle?.trim() || null;
  const applePayRecipient = parsed.data.applePayRecipient?.trim() || null;
  const venmoHandle = parsed.data.venmoHandle?.trim() || null;
  const cashAppEnabled = parsed.data.cashAppEnabled;
  const chimeEnabled = parsed.data.chimeEnabled;
  const applePayEnabled = parsed.data.applePayEnabled;
  const venmoEnabled = parsed.data.venmoEnabled;
  const nowPaymentsEnabled = parsed.data.nowPaymentsEnabled;
  const minimumAmountCents = parsed.data.minimumAmountCents;
  await db
    .insert(depositSettingsTable)
    .values({
      id: 1,
      cashAppHandle,
      chimeHandle,
      applePayRecipient,
      venmoHandle,
      cashAppEnabled,
      chimeEnabled,
      applePayEnabled,
      venmoEnabled,
      nowPaymentsEnabled,
      minimumAmountCents,
    })
    .onConflictDoUpdate({
      target: depositSettingsTable.id,
      set: {
        cashAppHandle,
        chimeHandle,
        applePayRecipient,
        venmoHandle,
        cashAppEnabled,
        chimeEnabled,
        applePayEnabled,
        venmoEnabled,
        nowPaymentsEnabled,
        minimumAmountCents,
        updatedAt: new Date(),
      },
    });
  const settings = await getDepositSettings();
  res.json(
    UpdateAdminDepositMethodsResponse.parse({
      cashAppHandle: settings.cashAppHandle,
      chimeHandle: settings.chimeHandle,
      applePayRecipient: settings.applePayRecipient,
      venmoHandle: settings.venmoHandle,
      cashAppEnabled: settings.cashAppEnabled,
      chimeEnabled: settings.chimeEnabled,
      applePayEnabled: settings.applePayEnabled,
      venmoEnabled: settings.venmoEnabled,
      nowPaymentsEnabled: settings.nowPaymentsEnabled,
      nowPaymentsConfigured: configuredNowPayments(),
      minimumAmountCents: settings.minimumAmountCents,
      maximumAmountCents: MAXIMUM_AMOUNT_CENTS,
    }),
  );
});

export default router;