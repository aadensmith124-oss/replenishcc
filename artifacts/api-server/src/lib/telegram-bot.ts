import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, sql, sum } from "drizzle-orm";
import {
  accountLedgerTable,
  db,
  usersTable,
} from "@workspace/db";
import type {
  TelegramWebhookMessage,
  TelegramWebhookUpdate,
} from "@workspace/api-zod";
import { logger } from "./logger";

const REWARD_AMOUNT_CENTS = 100;
const REWARD_TRIGGER = "ReplenishCC.xyz";
const REWARD_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LINK_LIFETIME_SECONDS = 10 * 60;
const WEBHOOK_PATH = "/api/telegram/webhook";
const WEBHOOK_SECRET_LABEL = "replenishcc-telegram-webhook-v1";
const LINK_SECRET_LABEL = "replenishcc-telegram-reward-link-v1";

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
};

type TelegramBotIdentity = {
  username?: string;
};

type TelegramWebhookInfo = {
  url: string;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
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
  method: "getMe" | "getWebhookInfo" | "setWebhook" | "sendMessage",
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

export async function createTelegramRewardLink(userId: string): Promise<{
  deepLink: string;
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
  const startToken = Buffer.concat([payload, signature]).toString("base64url");

  return {
    deepLink: `https://t.me/${identity.username}?start=${startToken}`,
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
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  logger.info(
    { botUsername: identity.username, host },
    "Telegram reward bot webhook configured.",
  );
  return host;
}

function verifyStartToken(
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

async function sendMessage(chatId: number, text: string): Promise<void> {
  await telegramApi("sendMessage", { chat_id: chatId, text });
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

function formatUtcDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function handleStartMessage(
  message: TelegramWebhookMessage,
  updateId: number,
): Promise<void> {
  const chatId = message.chat.id;
  const telegramUser = message.from;
  const token = message.text?.match(
    /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]+))?/,
  )?.[1];

  if (!telegramUser || telegramUser.is_bot) return;
  if (!token) {
    await sendMessage(
      chatId,
      "To claim the $1 ReplenishCC reward (available once every 24 hours), sign in and create a Telegram reward link from Account management.",
    );
    return;
  }

  const claim = verifyStartToken(token);
  if (!claim) {
    await sendMessage(
      chatId,
      "This reward link is invalid or expired. Sign in to ReplenishCC and create a new Telegram reward link.",
    );
    return;
  }
  if (!matchesRewardPhrase(message)) {
    await sendMessage(
      chatId,
      `Your Telegram display name must contain ${REWARD_TRIGGER}. Telegram usernames cannot include periods, so this exact phrase can only match your display name. Update it and tap Start again within 10 minutes.`,
    );
    return;
  }

  const result = await awardReward(claim.userId, telegramUser.id, updateId);
  if (result.kind === "account-missing") {
    await sendMessage(chatId, "The ReplenishCC account for this link could not be found.");
    return;
  }
  if (result.kind === "member-cooldown") {
    await sendMessage(
      chatId,
      `This ReplenishCC account received a reward within the last 24 hours. You can claim again after ${formatUtcDateTime(result.nextEligibleAt)} UTC.`,
    );
    return;
  }
  if (result.kind === "telegram-cooldown") {
    await sendMessage(
      chatId,
      `This Telegram account received a reward within the last 24 hours. You can claim again after ${formatUtcDateTime(result.nextEligibleAt)} UTC.`,
    );
    return;
  }
  if (result.kind === "already-processed") {
    await sendMessage(
      chatId,
      "This Telegram claim was already processed. A reward can be claimed once every 24 hours per ReplenishCC account and Telegram account.",
    );
    return;
  }

  await sendMessage(
    chatId,
    `$1.00 has been added to your ReplenishCC account balance. Your new balance is $${(result.balanceCents / 100).toFixed(2)}.`,
  );
}

export async function handleTelegramUpdate(
  update: TelegramWebhookUpdate,
): Promise<void> {
  const message = update.message;
  if (!message || message.chat.type !== "private") return;
  const text = message.text?.trim();
  if (!text) return;

  if (/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) {
    await handleStartMessage(message, update.update_id);
    return;
  }
  if (/^\/help(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(text)) {
    await sendMessage(
      message.chat.id,
      "Sign in to ReplenishCC, open Account management, create a Telegram reward link, then open it here. Set your Telegram display name to include ReplenishCC.xyz. Telegram usernames cannot include periods, so this exact phrase can only match the display name.",
    );
  }
}