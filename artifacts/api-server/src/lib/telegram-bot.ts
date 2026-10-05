import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, sql, sum } from "drizzle-orm";
import {
  accountLedgerTable,
  db,
  usersTable,
} from "@workspace/db";
import type {
  TelegramWebhookCallbackQuery,
  TelegramWebhookMessage,
  TelegramWebhookUpdate,
} from "@workspace/api-zod";
import { logger } from "./logger";

const REWARD_AMOUNT_CENTS = 100;
const REFERRAL_BONUS_AMOUNT_CENTS = 50;
const REWARD_TRIGGER = "ReplenishCC.xyz";
const REWARD_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LINK_LIFETIME_SECONDS = 10 * 60;
const WEBHOOK_PATH = "/api/telegram/webhook";
const TELEGRAM_LINK_PAGE_URL = "https://www.replenishcc.xyz/link";
const WEBHOOK_SECRET_LABEL = "replenishcc-telegram-webhook-v1";
const LINK_SECRET_LABEL = "replenishcc-telegram-reward-link-v1";
const REFERRAL_CODE_SECRET_LABEL = "replenishcc-telegram-referral-code-v1";

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
};

type TelegramBotIdentity = {
  username?: string;
};

type TelegramChatMember = {
  status: string;
  is_member?: boolean;
};

type TelegramWebhookInfo = {
  url: string;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
};

type TelegramInlineKeyboardButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

let botUsername: string | null = null;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return secret;
}

function telegramToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token && /^\d+:[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

async function telegramApi<T>(
  method:
    | "getMe"
    | "getWebhookInfo"
    | "getChatMember"
    | "setWebhook"
    | "setMyCommands"
    | "answerCallbackQuery"
    | "sendMessage",
  body: Record<string, unknown> = {},
): Promise<T> {
  const token = telegramToken();
  if (!token) throw new Error("Telegram bot token is not configured.");

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | TelegramApiResponse<T>
    | null;

  if (!response.ok || !payload?.ok || !("result" in payload)) {
    const failures = [
      `HTTP ${response.status}`,
      typeof payload?.error_code === "number"
        ? `Telegram ${payload.error_code}`
        : null,
    ].filter(Boolean);
    throw new Error(`Telegram API request failed (${failures.join(", ")}).`);
  }
  return payload.result as T;
}

function webhookSecret(): string {
  return createHmac("sha256", sessionSecret())
    .update(WEBHOOK_SECRET_LABEL)
    .digest("base64url");
}

function publicHost(): string | null {
  const vercelEnvironment = process.env.VERCEL_ENV?.trim();
  const configuredVercelOrigin = process.env.TELEGRAM_WEBHOOK_BASE_URL?.trim();
  let configured: string | undefined;
  if (
    process.env.VERCEL === "1" ||
    vercelEnvironment ||
    configuredVercelOrigin
  ) {
    if (vercelEnvironment && vercelEnvironment !== "production") return null;
    if (
      !vercelEnvironment &&
      process.env.NODE_ENV !== "production" &&
      process.env.TELEGRAM_ALLOW_DEV_WEBHOOK !== "true"
    ) {
      return null;
    }
    configured =
      configuredVercelOrigin ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
      (vercelEnvironment === "production"
        ? process.env.VERCEL_URL?.trim()
        : undefined);
  } else {
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.TELEGRAM_ALLOW_DEV_WEBHOOK !== "true"
    ) {
      return null;
    }
    configured =
      process.env.REPLIT_DOMAINS?.split(",").map((part) => part.trim()).find(Boolean) ??
      process.env.REPLIT_DEV_DOMAIN?.trim();
  }
  if (!configured) return null;

  try {
    const url = new URL(
      configured.includes("://") ? configured : `https://${configured}`,
    );
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    if (
      (process.env.VERCEL === "1" || vercelEnvironment) &&
      (url.hostname === "replit.dev" ||
        url.hostname.endsWith(".replit.dev") ||
        url.hostname === "replit.app" ||
        url.hostname.endsWith(".replit.app"))
    ) {
      return null;
    }
    return url.host;
  } catch {
    return null;
  }
}

export function getTelegramWebhookTargetUrl(): string | null {
  const host = publicHost();
  return host ? `https://${host}${WEBHOOK_PATH}` : null;
}

export function getExpectedTelegramWebhookSecret(): string {
  return webhookSecret();
}

export async function getTelegramWebhookDiagnostics(): Promise<{
  botUsername: string | null;
  targetWebhookUrl: string | null;
  webhookUrl: string;
  pendingUpdateCount: number;
  ipAddress: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}> {
  const identity = await telegramApi<TelegramBotIdentity>("getMe");
  const webhook = await telegramApi<TelegramWebhookInfo>("getWebhookInfo");

  return {
    botUsername: identity.username ?? null,
    targetWebhookUrl: getTelegramWebhookTargetUrl(),
    webhookUrl: webhook.url,
    pendingUpdateCount: webhook.pending_update_count,
    ipAddress: webhook.ip_address ?? null,
    lastErrorAt: webhook.last_error_date
      ? new Date(webhook.last_error_date * 1000).toISOString()
      : null,
    lastErrorMessage: webhook.last_error_message ?? null,
  };
}

export async function createTelegramRewardCode(userId: string): Promise<{
  code: string;
  botUsername: string;
  expiresAt: Date;
}> {
  const identity = await telegramApi<TelegramBotIdentity>("getMe");
  if (!identity.username || !/^[A-Za-z0-9_]{5,32}$/.test(identity.username)) {
    throw new Error("Telegram bot identity is unavailable.");
  }
  botUsername = identity.username;

  const expiresAtSeconds = Math.floor(Date.now() / 1000) + LINK_LIFETIME_SECONDS;
  const payload = Buffer.alloc(20);
  Buffer.from(userId.replaceAll("-", ""), "hex").copy(payload, 0, 0, 16);
  payload.writeUInt32BE(expiresAtSeconds, 16);
  const signature = createHmac("sha256", sessionSecret())
    .update(LINK_SECRET_LABEL)
    .update(payload)
    .digest()
    .subarray(0, 12);
  const code = Buffer.concat([payload, signature]).toString("base64url");

  return {
    code,
    botUsername: identity.username,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

export async function createTelegramReferralVerificationCode(
  userId: string,
): Promise<
  | {
      kind: "created";
      code: string;
      botUsername: string;
      expiresAt: Date;
    }
  | { kind: "not-referred" }
  | { kind: "already-earned" }
  | { kind: "group-unavailable" }
> {
  const [member] = await db
    .select({ referredById: usersTable.referredById })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!member?.referredById) return { kind: "not-referred" };

  const requestId = telegramReferralBonusRequestId(userId);
  const [existingBonus] = await db
    .select({ id: accountLedgerTable.id })
    .from(accountLedgerTable)
    .where(eq(accountLedgerTable.adminRequestId, requestId))
    .limit(1);
  if (existingBonus) return { kind: "already-earned" };
  if (telegramReferralGroupId() === null) {
    return { kind: "group-unavailable" };
  }

  const identity = await telegramApi<TelegramBotIdentity>("getMe");
  if (!identity.username || !/^[A-Za-z0-9_]{5,32}$/.test(identity.username)) {
    throw new Error("Telegram bot identity is unavailable.");
  }
  botUsername = identity.username;

  const expiresAtSeconds = Math.floor(Date.now() / 1000) + LINK_LIFETIME_SECONDS;
  const payload = Buffer.alloc(20);
  Buffer.from(userId.replaceAll("-", ""), "hex").copy(payload, 0, 0, 16);
  payload.writeUInt32BE(expiresAtSeconds, 16);
  const signature = createHmac("sha256", sessionSecret())
    .update(REFERRAL_CODE_SECRET_LABEL)
    .update(payload)
    .digest()
    .subarray(0, 12);
  const code = Buffer.concat([payload, signature]).toString("base64url");

  return {
    kind: "created",
    code,
    botUsername: identity.username,
    expiresAt: new Date(expiresAtSeconds * 1000),
  };
}

export async function configureTelegramWebhook(): Promise<string | null> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    logger.warn("Telegram reward bot is disabled because its token is not configured.");
    return null;
  }

  const host = publicHost();
  if (!host) {
    logger.warn(
      "Telegram webhook was not configured because this runtime is not an eligible production environment or its domain is unavailable.",
    );
    return null;
  }

  const identity = await telegramApi<TelegramBotIdentity>("getMe");
  if (!identity.username || !/^[A-Za-z0-9_]{5,32}$/.test(identity.username)) {
    throw new Error("Telegram bot identity is unavailable.");
  }
  botUsername = identity.username;

  await telegramApi<boolean>("setWebhook", {
    url: `https://${host}${WEBHOOK_PATH}`,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  await telegramApi<boolean>("setMyCommands", {
    commands: [
      { command: "start", description: "Show reward instructions" },
      { command: "link", description: "Get a secure $1 reward code" },
      { command: "verify", description: "Verify referral group membership" },
      { command: "groupid", description: "Show this group ID to administrators" },
      { command: "help", description: "Learn how the Telegram reward works" },
    ],
  });
  logger.info(
    { botUsername: identity.username, host },
    "Telegram reward bot webhook configured.",
  );
  return host;
}

function verifyRewardCode(
  token: string,
): { userId: string; expiresAtSeconds: number } | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const decoded = Buffer.from(token, "base64url");
  if (
    decoded.length !== 32 ||
    decoded.toString("base64url") !== token
  ) {
    return null;
  }

  const payload = decoded.subarray(0, 20);
  const signature = decoded.subarray(20);
  const expected = createHmac("sha256", sessionSecret())
    .update(LINK_SECRET_LABEL)
    .update(payload)
    .digest()
    .subarray(0, 12);
  if (!timingSafeEqual(signature, expected)) return null;

  const expiresAtSeconds = payload.readUInt32BE(16);
  if (expiresAtSeconds <= Math.floor(Date.now() / 1000)) return null;

  const userIdHex = payload.subarray(0, 16).toString("hex");
  const userId = [
    userIdHex.slice(0, 8),
    userIdHex.slice(8, 12),
    userIdHex.slice(12, 16),
    userIdHex.slice(16, 20),
    userIdHex.slice(20),
  ].join("-");
  return { userId, expiresAtSeconds };
}

function verifyReferralVerificationCode(token: string): { userId: string } | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const decoded = Buffer.from(token, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== token) {
    return null;
  }

  const payload = decoded.subarray(0, 20);
  const signature = decoded.subarray(20);
  const expected = createHmac("sha256", sessionSecret())
    .update(REFERRAL_CODE_SECRET_LABEL)
    .update(payload)
    .digest()
    .subarray(0, 12);
  if (!timingSafeEqual(signature, expected)) return null;
  if (payload.readUInt32BE(16) <= Math.floor(Date.now() / 1000)) return null;

  const userIdHex = payload.subarray(0, 16).toString("hex");
  const userId = [
    userIdHex.slice(0, 8),
    userIdHex.slice(8, 12),
    userIdHex.slice(12, 16),
    userIdHex.slice(16, 20),
    userIdHex.slice(20),
  ].join("-");
  return { userId };
}

function telegramReferralGroupId(): number | null {
  const value = process.env.TELEGRAM_REFERRAL_GROUP_ID?.trim();
  if (!value || !/^-?\d+$/.test(value)) return null;
  const groupId = Number(value);
  return Number.isSafeInteger(groupId) && groupId < 0 ? groupId : null;
}

function rewardRequestId(telegramUserId: number, updateId: number): string {
  const digest = createHash("sha256")
    .update(`replenishcc:telegram-reward:v2:${telegramUserId}:${updateId}`)
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function telegramReferralBonusRequestId(referredUserId: string): string {
  const digest = createHash("sha256")
    .update(`replenishcc:telegram-referral-bonus:v1:${referredUserId}`)
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function telegramRewardReason(telegramUserId: number): string {
  const fingerprint = createHmac("sha256", sessionSecret())
    .update("replenishcc-telegram-reward-cooldown-v1:")
    .update(String(telegramUserId))
    .digest("hex")
    .slice(0, 24);
  return `Telegram name reward: ${REWARD_TRIGGER} [telegram:${fingerprint}]`;
}

function telegramLockParts(telegramUserId: number): [number, number] {
  const digest = createHmac("sha256", sessionSecret())
    .update("replenishcc-telegram-reward-lock-v1:")
    .update(String(telegramUserId))
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

function matchesRewardPhrase(message: TelegramWebhookMessage): boolean {
  const phrase = REWARD_TRIGGER.toLowerCase();
  const displayName = [message.from?.first_name, message.from?.last_name]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return [displayName, message.from?.username]
    .some((value) => value?.toLowerCase().includes(phrase) ?? false);
}

function rewardMenuKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "Generate a reward code", url: TELEGRAM_LINK_PAGE_URL }],
      [{ text: "How to claim", callback_data: "reward_help" }],
    ],
  };
}

function referralBonusKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: "Open referral page",
          url: "https://www.replenishcc.xyz/referrals",
        },
      ],
    ],
  };
}

async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<void> {
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

async function awardReward(
  userId: string,
  telegramUserId: number,
  updateId: number,
): Promise<
  | { kind: "credited"; balanceCents: number }
  | { kind: "member-cooldown"; nextEligibleAt: Date }
  | { kind: "telegram-cooldown"; nextEligibleAt: Date }
  | { kind: "already-processed" }
  | { kind: "account-missing" }
> {
  const requestId = rewardRequestId(telegramUserId, updateId);
  const rewardReason = telegramRewardReason(telegramUserId);
  const [lockHigh, lockLow] = telegramLockParts(telegramUserId);
  const result = await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update")
      .limit(1);
    if (!member) return { kind: "account-missing" as const };

    await tx.execute(
      sql`select pg_advisory_xact_lock(${lockHigh}, ${lockLow})`,
    );

    const cooldownCutoff = new Date(Date.now() - REWARD_COOLDOWN_MS);
    const [recentMemberReward] = await tx
      .select({ createdAt: accountLedgerTable.createdAt })
      .from(accountLedgerTable)
      .where(
        and(
          eq(accountLedgerTable.userId, member.id),
          eq(accountLedgerTable.entryType, "telegram_reward"),
          gt(accountLedgerTable.createdAt, cooldownCutoff),
        ),
      )
      .orderBy(desc(accountLedgerTable.createdAt))
      .limit(1);
    if (recentMemberReward) {
      return {
        kind: "member-cooldown" as const,
        nextEligibleAt: new Date(
          recentMemberReward.createdAt.getTime() + REWARD_COOLDOWN_MS,
        ),
      };
    }

    const [recentTelegramReward] = await tx
      .select({ createdAt: accountLedgerTable.createdAt })
      .from(accountLedgerTable)
      .where(
        and(
          eq(accountLedgerTable.entryType, "telegram_reward"),
          eq(accountLedgerTable.reason, rewardReason),
          gt(accountLedgerTable.createdAt, cooldownCutoff),
        ),
      )
      .orderBy(desc(accountLedgerTable.createdAt))
      .limit(1);
    if (recentTelegramReward) {
      return {
        kind: "telegram-cooldown" as const,
        nextEligibleAt: new Date(
          recentTelegramReward.createdAt.getTime() + REWARD_COOLDOWN_MS,
        ),
      };
    }

    const [entry] = await tx
      .insert(accountLedgerTable)
      .values({
        userId: member.id,
        adminRequestId: requestId,
        reason: rewardReason,
        entryType: "telegram_reward",
        amountCents: REWARD_AMOUNT_CENTS,
      })
      .onConflictDoNothing({ target: accountLedgerTable.adminRequestId })
      .returning({ id: accountLedgerTable.id });
    if (!entry) return { kind: "already-processed" as const };

    const [balanceRow] = await tx
      .select({ balanceCents: sum(accountLedgerTable.amountCents) })
      .from(accountLedgerTable)
      .where(eq(accountLedgerTable.userId, member.id));
    return {
      kind: "credited" as const,
      balanceCents: Number(balanceRow?.balanceCents ?? 0),
    };
  });
  return result;
}

async function checkTelegramReferralGroupMembership(
  telegramUserId: number,
): Promise<"member" | "not-member" | "group-unavailable"> {
  const groupId = telegramReferralGroupId();
  if (groupId === null) return "group-unavailable";

  const membership = await telegramApi<TelegramChatMember>("getChatMember", {
    chat_id: groupId,
    user_id: telegramUserId,
  });
  return membership.status === "creator" ||
    membership.status === "administrator" ||
    membership.status === "member" ||
    (membership.status === "restricted" && membership.is_member === true)
    ? "member"
    : "not-member";
}

async function awardTelegramReferralBonus(
  referredUserId: string,
): Promise<
  | { kind: "credited"; balanceCents: number }
  | { kind: "already-earned" }
  | { kind: "not-referred" }
  | { kind: "account-missing" }
> {
  const requestId = telegramReferralBonusRequestId(referredUserId);
  return db.transaction(async (tx) => {
    const [referredMember] = await tx
      .select({
        id: usersTable.id,
        referredById: usersTable.referredById,
      })
      .from(usersTable)
      .where(eq(usersTable.id, referredUserId))
      .for("update")
      .limit(1);
    if (!referredMember) return { kind: "account-missing" as const };
    if (!referredMember.referredById) return { kind: "not-referred" as const };

    const [existingBonus] = await tx
      .select({ id: accountLedgerTable.id })
      .from(accountLedgerTable)
      .where(eq(accountLedgerTable.adminRequestId, requestId))
      .limit(1);
    if (existingBonus) return { kind: "already-earned" as const };

    const [entry] = await tx
      .insert(accountLedgerTable)
      .values({
        userId: referredMember.referredById,
        adminRequestId: requestId,
        reason: "Telegram group-join referral bonus",
        entryType: "telegram_referral_reward",
        amountCents: REFERRAL_BONUS_AMOUNT_CENTS,
      })
      .onConflictDoNothing({ target: accountLedgerTable.adminRequestId })
      .returning({ id: accountLedgerTable.id });
    if (!entry) return { kind: "already-earned" as const };

    const [balanceRow] = await tx
      .select({ balanceCents: sum(accountLedgerTable.amountCents) })
      .from(accountLedgerTable)
      .where(eq(accountLedgerTable.userId, referredMember.referredById));
    return {
      kind: "credited" as const,
      balanceCents: Number(balanceRow?.balanceCents ?? 0),
    };
  });
}

function formatUtcDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function handleRewardCode(
  message: TelegramWebhookMessage,
  code: string,
  updateId: number,
): Promise<void> {
  const chatId = message.chat.id;
  const telegramUser = message.from;
  if (!telegramUser || telegramUser.is_bot) return;
  const claim = verifyRewardCode(code);
  if (!claim) {
    await sendMessage(
      chatId,
      "⚠️ This reward code is invalid or expired. Sign in at ReplenishCC.xyz/link and create a new code.",
      rewardMenuKeyboard(),
    );
    return;
  }
  if (!matchesRewardPhrase(message)) {
    await sendMessage(
      chatId,
      `📝 Your Telegram display name must contain ${REWARD_TRIGGER}. Telegram usernames cannot include periods, so this exact phrase can only match your display name. Update it, create a new code, and send it within 10 minutes.`,
      rewardMenuKeyboard(),
    );
    return;
  }

  const result = await awardReward(claim.userId, telegramUser.id, updateId);
  if (result.kind === "account-missing") {
    await sendMessage(
      chatId,
      "⚠️ The ReplenishCC account for this code could not be found.",
      rewardMenuKeyboard(),
    );
    return;
  }
  if (result.kind === "member-cooldown") {
    await sendMessage(
      chatId,
      `⏳ This ReplenishCC account received a reward within the last 24 hours. You can claim again after ${formatUtcDateTime(result.nextEligibleAt)} UTC.`,
      rewardMenuKeyboard(),
    );
    return;
  }
  if (result.kind === "telegram-cooldown") {
    await sendMessage(
      chatId,
      `⏳ This Telegram account received a reward within the last 24 hours. You can claim again after ${formatUtcDateTime(result.nextEligibleAt)} UTC.`,
      rewardMenuKeyboard(),
    );
    return;
  }
  if (result.kind === "already-processed") {
    await sendMessage(
      chatId,
      "ℹ️ This Telegram claim was already processed. A reward can be claimed once every 24 hours per ReplenishCC account and Telegram account.",
      rewardMenuKeyboard(),
    );
    return;
  }

  await sendMessage(
    chatId,
    `🎉 $1.00 has been added to your ReplenishCC account balance. Your new balance is $${(result.balanceCents / 100).toFixed(2)}.`,
    rewardMenuKeyboard(),
  );
}

async function handleReferralVerificationCode(
  message: TelegramWebhookMessage,
  code: string,
): Promise<void> {
  const chatId = message.chat.id;
  const telegramUser = message.from;
  if (!telegramUser || telegramUser.is_bot) return;

  const claim = verifyReferralVerificationCode(code);
  if (!claim) {
    await sendMessage(
      chatId,
      "⚠️ This verification code is invalid or expired. Sign in at ReplenishCC.xyz/referrals and create a new code.",
      referralBonusKeyboard(),
    );
    return;
  }

  let membership: "member" | "not-member" | "group-unavailable";
  try {
    membership = await checkTelegramReferralGroupMembership(telegramUser.id);
  } catch {
    await sendMessage(
      chatId,
      "⚠️ Telegram group membership could not be checked right now. Please try again later.",
      referralBonusKeyboard(),
    );
    return;
  }
  if (membership === "group-unavailable") {
    await sendMessage(
      chatId,
      "⚠️ The Telegram referral group is not configured yet. Please try again later.",
      referralBonusKeyboard(),
    );
    return;
  }
  if (membership === "not-member") {
    await sendMessage(
      chatId,
      "Join the ReplenishCC Telegram group first, then send /verify with a fresh code.",
      referralBonusKeyboard(),
    );
    return;
  }

  const result = await awardTelegramReferralBonus(claim.userId);
  if (result.kind === "account-missing") {
    await sendMessage(
      chatId,
      "⚠️ The ReplenishCC account for this code could not be found.",
      referralBonusKeyboard(),
    );
    return;
  }
  if (result.kind === "not-referred") {
    await sendMessage(
      chatId,
      "This account was not created through a referral, so it cannot earn the group-join bonus.",
      referralBonusKeyboard(),
    );
    return;
  }
  if (result.kind === "already-earned") {
    await sendMessage(
      chatId,
      "ℹ️ This referred ReplenishCC account has already earned its one-time Telegram group bonus.",
      referralBonusKeyboard(),
    );
    return;
  }

  await sendMessage(
    chatId,
    `🎉 $0.50 has been added to your referrer's ReplenishCC account. Their new balance is $${(result.balanceCents / 100).toFixed(2)}.`,
    referralBonusKeyboard(),
  );
}

function commandArgument(
  message: TelegramWebhookMessage,
  command: string,
): string | null {
  return message.text
    ?.match(new RegExp(`^\\/${command}(?:@[A-Za-z0-9_]+)?(?:\\s+([\\s\\S]+))?$`))
    ?.[1]
    ?.trim() || null;
}

async function handleGroupIdCommand(message: TelegramWebhookMessage): Promise<void> {
  const sender = message.from;
  if (!sender || sender.is_bot) return;

  let member: TelegramChatMember;
  try {
    member = await telegramApi<TelegramChatMember>("getChatMember", {
      chat_id: message.chat.id,
      user_id: sender.id,
    });
  } catch {
    await sendMessage(
      message.chat.id,
      "I could not check administrator permissions. Make sure this bot is an administrator, then try again.",
    );
    return;
  }

  if (member.status !== "creator" && member.status !== "administrator") {
    await sendMessage(
      message.chat.id,
      "Only group administrators can request the numeric group ID.",
    );
    return;
  }

  await sendMessage(
    message.chat.id,
    `This group's numeric Telegram ID is ${message.chat.id}. Set TELEGRAM_REFERRAL_GROUP_ID to this value in the production environment.`,
  );
}

async function sendRewardInstructions(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    `🎁 Claim $1 by signing in at ReplenishCC.xyz/link, creating a secure code, then sending the code here. Your Telegram display name must contain ${REWARD_TRIGGER}. Each ReplenishCC account and Telegram account can claim once every rolling 24 hours; codes expire after 10 minutes.`,
    rewardMenuKeyboard(),
  );
}

async function sendReferralVerificationInstructions(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "🎁 Referred members can earn their referrer a one-time $0.50 bonus. Sign in at ReplenishCC.xyz/referrals, join the linked Telegram group, create a verification code, then send /verify followed by that code here. Codes expire after 10 minutes.",
    referralBonusKeyboard(),
  );
}

async function handleCallbackQuery(
  callbackQuery: TelegramWebhookCallbackQuery,
): Promise<void> {
  await answerCallbackQuery(callbackQuery.id);
  if (
    callbackQuery.data !== "reward_help" ||
    callbackQuery.message?.chat.type !== "private"
  ) {
    return;
  }
  await sendRewardInstructions(callbackQuery.message.chat.id);
}

export async function handleTelegramUpdate(
  update: TelegramWebhookUpdate,
): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update.message;
  if (!message) return;
  const text = message.text?.trim();
  if (!text) return;

  if (message.chat.type === "group" || message.chat.type === "supergroup") {
    if (/^\/groupid(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) {
      await handleGroupIdCommand(message);
    }
    return;
  }
  if (message.chat.type !== "private") return;

  if (/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) {
    const code = commandArgument(message, "start");
    if (code) {
      await handleRewardCode(message, code, update.update_id);
    } else {
      await sendRewardInstructions(message.chat.id);
    }
    return;
  }
  if (/^\/link(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) {
    const code = commandArgument(message, "link");
    if (code) {
      await handleRewardCode(message, code, update.update_id);
    } else {
      await sendRewardInstructions(message.chat.id);
    }
    return;
  }
  if (/^\/help(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) {
    await sendRewardInstructions(message.chat.id);
    return;
  }
  if (/^\/verify(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) {
    const code = commandArgument(message, "verify");
    if (code) {
      await handleReferralVerificationCode(message, code);
    } else {
      await sendReferralVerificationInstructions(message.chat.id);
    }
    return;
  }
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) {
    await handleRewardCode(message, text, update.update_id);
  }
}