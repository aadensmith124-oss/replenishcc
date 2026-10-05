import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CreateTelegramRewardLinkResponse,
  PostTelegramWebhookBody,
  PostTelegramWebhookResponse,
} from "@workspace/api-zod";
import {
  createTelegramRewardLink,
  configureTelegramWebhook,
  getExpectedTelegramWebhookSecret,
  getTelegramWebhookDiagnostics,
  handleTelegramUpdate,
} from "../lib/telegram-bot";
import { getCurrentUser, isDepositAdmin } from "../lib/auth";
import { requireMemberPage } from "../lib/member-page-visibility";

const router: IRouter = Router();

async function requireTelegramAdmin(
  req: Request,
  res: Response,
): Promise<boolean> {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to manage Telegram webhook settings." });
    return false;
  }
  if (!isDepositAdmin(user)) {
    res.status(403).json({ error: "Admin access is required." });
    return false;
  }
  return true;
}

function isSameOriginWrite(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}

function safeTelegramError(error: unknown): string {
  return error instanceof Error &&
    error.message.startsWith("Telegram API request failed (")
    ? error.message
    : "Could not reach the Telegram Bot API.";
}

router.get(
  "/admin/telegram-webhook-status",
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    if (!(await requireTelegramAdmin(req, res))) return;

    try {
      res.json(await getTelegramWebhookDiagnostics());
    } catch (error) {
      const message = safeTelegramError(error);
      req.log.error({ message }, "Telegram webhook status check failed.");
      res.status(502).json({ error: message });
    }
  },
);

router.post(
  "/admin/telegram-webhook-register",
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    if (!isSameOriginWrite(req)) {
      res.status(403).json({ error: "Request origin is not allowed." });
      return;
    }
    if (!(await requireTelegramAdmin(req, res))) return;

    try {
      const host = await configureTelegramWebhook();
      if (!host) {
        res.status(409).json({
          error:
            "Webhook was not registered. Check that the production bot token and production domain are configured.",
        });
        return;
      }
      res.json(await getTelegramWebhookDiagnostics());
    } catch (error) {
      const message = safeTelegramError(error);
      req.log.error({ message }, "Telegram webhook registration failed.");
      res.status(502).json({ error: message });
    }
  },
);

router.get(
  "/admin/telegram-webhook-tool",
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    if (!(await requireTelegramAdmin(req, res))) return;

    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Telegram webhook settings</title>
  <style>
    body { margin: 0; padding: 32px 16px; background: #f5f7fb; color: #182230; font: 16px/1.5 system-ui, sans-serif; }
    main { max-width: 720px; margin: 0 auto; padding: 24px; background: white; border: 1px solid #dce2ea; border-radius: 12px; }
    h1 { margin-top: 0; font-size: 1.5rem; }
    p { color: #475467; }
    pre { overflow-wrap: anywhere; white-space: pre-wrap; padding: 16px; background: #f5f7fb; border-radius: 8px; }
    button { margin: 8px 8px 0 0; padding: 10px 14px; border: 0; border-radius: 8px; background: #155eef; color: white; font: inherit; cursor: pointer; }
    button:disabled { opacity: .6; cursor: wait; }
    #message { min-height: 1.5em; }
  </style>
</head>
<body>
  <main>
    <h1>Telegram webhook</h1>
    <p>This admin-only tool checks Telegram’s current webhook. Registering it updates the bot to use this deployment’s configured production domain and keeps pending updates.</p>
    <pre id="status" aria-live="polite">Loading status…</pre>
    <p id="message" role="status"></p>
    <button id="refresh" type="button">Refresh status</button>
    <button id="register" type="button">Register production webhook</button>
  </main>
  <script>
    const status = document.getElementById("status");
    const message = document.getElementById("message");
    const refreshButton = document.getElementById("refresh");
    const registerButton = document.getElementById("register");

    async function loadStatus() {
      status.textContent = "Loading status…";
      try {
        const response = await fetch("/api/admin/telegram-webhook-status", {
          credentials: "same-origin",
          cache: "no-store"
        });
        const data = await response.json();
        status.textContent = JSON.stringify(data, null, 2);
        if (!response.ok) message.textContent = "Status check failed.";
      } catch {
        status.textContent = "Could not load Telegram status.";
      }
    }

    refreshButton.addEventListener("click", loadStatus);
    registerButton.addEventListener("click", async () => {
      if (!window.confirm("Set Telegram's webhook to this deployment's production domain? Pending updates will be kept.")) return;
      registerButton.disabled = true;
      message.textContent = "Registering webhook…";
      try {
        const response = await fetch("/api/admin/telegram-webhook-register", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: "{}"
        });
        const data = await response.json();
        status.textContent = JSON.stringify(data, null, 2);
        message.textContent = response.ok ? "Webhook registered and verified." : "Registration failed.";
      } catch {
        message.textContent = "Could not register the webhook.";
      } finally {
        registerButton.disabled = false;
      }
    });

    loadStatus();
  </script>
</body>
</html>`);
  },
);

function secretMatches(received: string | undefined, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

router.post(
  "/telegram-reward-link",
  requireMemberPage("accountManagement"),
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    const member = await getCurrentUser(req);
    if (!member) {
      res.status(401).json({ error: "Sign in to create a Telegram reward link." });
      return;
    }

    try {
      const link = await createTelegramRewardLink(member.id);
      res.json(
        CreateTelegramRewardLinkResponse.parse({
          deepLink: link.deepLink,
          botUsername: link.botUsername,
          expiresAt: link.expiresAt,
          amountCents: 100,
        }),
      );
    } catch {
      res.status(503).json({
        error: "The Telegram reward bot is not available right now.",
      });
    }
  },
);

router.post(
  "/telegram/webhook",
  async (req, res): Promise<void> => {
    const expectedSecret = getExpectedTelegramWebhookSecret();
    if (
      !secretMatches(
        req.get("X-Telegram-Bot-Api-Secret-Token"),
        expectedSecret,
      )
    ) {
      res.status(401).json({ error: "Webhook secret is invalid." });
      return;
    }

    const parsed = PostTelegramWebhookBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Telegram update is invalid." });
      return;
    }

    try {
      await handleTelegramUpdate(parsed.data);
    } catch {
      req.log.error(
        { updateId: parsed.data.update_id },
        "Telegram update could not be processed.",
      );
      res.status(500).json({ error: "Telegram update could not be processed." });
      return;
    }

    res.json(PostTelegramWebhookResponse.parse({ ok: true }));
  },
);

export default router;