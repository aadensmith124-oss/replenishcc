---
name: Vanilla gift-card store
description: Confirmed ReplenishCC scope for prepaid Vanilla Visa gift-card inventory and delivery.
---

The card store is for authorized, unused Vanilla Visa prepaid gift cards. Administrators upload inventory; members purchase cards and retrieve them from their own order history. Removing bulk-order controls must still leave a single-card purchase path.

The catalog’s public ZIP field describes the product’s redemption region, never a cardholder or billing address. It is product metadata rather than card inventory data.

**Why:** The user confirmed the inventory is authorized prepaid Visa gift cards, asked for public product-region ZIP metadata, and specified that card credentials stay private until purchase.

**How to apply:** Keep this catalog separate from log products. Encrypt card credentials at rest, do not expose them in public listings or admin stock views, and return full details only to the authenticated purchaser. Treat any public ZIP as a product redemption region, not a customer address. If bulk ordering is disabled, retain single-card checkout.