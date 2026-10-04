---
name: Vanilla gift-card store
description: Confirmed ReplenishCC scope for prepaid Vanilla Visa gift-card inventory and delivery.
---

The card store is for authorized, unused Vanilla Visa prepaid gift cards. Administrators create bases with only a name and per-card Price, then upload up to 100 cards in one initial batch, one card per line. Members purchase cards and retrieve them from their own order history; checkout remains one card per base per purchase. A base accepts only one initial batch and cannot be restocked after any inventory or order history exists; create a new base for a separate batch.

Keep the legacy face-value column and API data unless the user explicitly approves a schema/data change. Do not show face value in the card-store UI; new bases populate the required legacy value from Price for compatibility.

The stock format is `number | expiration | security code | address | state | city | ZIP | email/phone`. Address, state, city, and ZIP are intentionally public catalog columns because the user explicitly requested that visibility; this supersedes the earlier restriction on publishing address-related fields.

Automatic issuer, type, and brand detection may use a public BIN lookup after the batch is accepted, but only when all cards in the batch share the same BIN prefix; send only that shared first 8 digits. Expiration, security code, and actual email/phone values stay out of that lookup. Gift-card stock has no PIN field.

**Why:** The user confirmed the inventory is authorized prepaid Visa gift cards, specified the exact stock format, requested public address/state/city/ZIP columns, required credentials and actual contact values to stay private until purchase, chose public BIN lookup, and later expanded initial intake from one card to multiline batches while retaining the no-restock rule.

**How to apply:** Keep this catalog separate from log products. Parse location fields by position and expose address/state/city/ZIP in the member catalog and admin metadata. Encrypt card number, expiration, security code, and actual email/phone values at rest; show full credentials only to the authenticated purchaser, and never add PIN support. Public listings and admin inventory may show whether contact values are present, but never their contents. Accept at most 100 cards in one atomic initial upload, reject inconsistent public locations, and prevent restocking under a product-row lock. Look up BIN metadata only after acceptance and only for a batch with one shared 8-digit prefix; lookup failures must not block upload. Retain single-card checkout.