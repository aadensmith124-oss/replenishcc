---
name: Telegram referral bonus
description: Additive referral bonus triggered by verified membership in the external Telegram group.
---

Each referred member may trigger a one-time $0.50 credit to the original referrer by verifying current membership in the configured Telegram group. This bonus is separate from and additive to the existing 5% qualifying-deposit reward. The bot must be an administrator, and production must configure the group's numeric chat ID.

**Why:** The user selected joining the external Telegram group as the trigger and explicitly said the $0.50 reward supplements the existing referral reward.

**How to apply:** Verify membership through the Telegram Bot API before crediting; keep the referral attribution and deposit-reward rules unchanged. Never award based only on clicking the invite link.