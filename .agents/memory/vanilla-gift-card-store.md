---
name: Vanilla gift-card store
description: Confirmed ReplenishCC scope for prepaid Vanilla Visa gift-card inventory and delivery.
---

The card store is for authorized, unused Vanilla Visa prepaid gift cards. Administrators upload inventory; members purchase cards and retrieve them from their own order history. Removing bulk-order controls must still leave a single-card purchase path. Each listing can receive exactly one card; after any inventory or order history exists, it can never be restocked. Create a new listing for each card.

The catalog’s public ZIP field describes the product’s redemption region, never a cardholder or billing address. It is product metadata rather than card inventory data.

Automatic issuer, type, and brand detection may use a public BIN lookup, but only the first 8 digits of an accepted card may be sent. Expiration, security code, PIN, email, and phone stay out of that lookup. Detect a public redemption ZIP from a 5-digit value in optional stock fields, excluding card credentials, the numeric PIN slot, contact values, and explicitly labeled billing/address data.

**Why:** The user confirmed the inventory is authorized prepaid Visa gift cards, asked for public product metadata, required credentials to stay private until purchase, specified one card per listing with no restocking after sale, requested automatic email/phone detection, chose public BIN lookup, and later requested ZIP detection from a 5-digit stock value.

**How to apply:** Keep this catalog separate from log products. Encrypt card credentials and optional email/phone values at rest. Public listings and admin inventory may show whether contact values are present, but never their contents; return full details only to the authenticated purchaser. Perform BIN lookup only after stock acceptance and do not block the upload when the public service is unavailable. Treat a detected 5-digit value as product redemption-region metadata, never as a cardholder or billing address; preserve the first optional numeric field as a PIN unless it is explicitly labeled as a redemption ZIP. Enforce the one-card lifetime stock rule server-side under a product-row lock, and retain single-card checkout.