import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateTelegramRewardLinkResponse,
  PostTelegramWebhookBody,
  PostTelegramWebhookResponse,
} from "@workspace/api-zod";
import { createTelegramRewardLink, getExpectedTelegramWebhookSecret, handleTelegramUpdate } from "../lib/telegram-bot";
import { getCurrentUser } from "../lib/auth";
import { requireMemberPage } from "../lib/member-page-visibility";

const router: IRouter = Router();

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