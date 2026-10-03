---
name: Vanilla gift-card store
description: Confirmed ReplenishCC scope for prepaid Vanilla Visa gift-card inventory and delivery.
---

The card store is for authorized, unused Vanilla Visa prepaid gift cards. Administrators upload inventory; members purchase cards and retrieve them from their own order history. Removing bulk-order controls must still leave a single-card purchase path.

**Why:** The user confirmed the cards are authorized gift cards and specified admin upload, member purchase, and order-history delivery. They clarified that removing bulk controls must not remove the ability to buy one card.

**How to apply:** Keep this catalog separate from log products. Encrypt card credentials at rest, do not expose them in public listings or admin stock views, and return full details only to the authenticated purchaser. If bulk ordering is disabled, retain single-card checkout.