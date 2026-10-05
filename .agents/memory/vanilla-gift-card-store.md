---
name: Vanilla gift-card store
description: Confirmed ReplenishCC scope for prepaid Vanilla Visa gift-card inventory and delivery.
---

The card store is for authorized, unused Vanilla Visa prepaid gift cards. Administrators create bases with only a name and per-card Price, then upload up to 100 cards per batch. Active bases may receive additional batches up to 1,000 currently available cards; sold cards remain in history and free capacity for restocking. Archived bases must be restored first. Members purchase cards and retrieve them from their own order history; checkout remains one card per base per purchase.

Bases with inventory or purchase history can be archived to hide them from member sales while preserving all records; admins can restore them. Only empty bases are physically deleted.

Keep the legacy face-value column and API data unless the user explicitly approves a schema/data change. Do not show face value in the card-store UI; new bases populate the required legacy value from Price for compatibility.

Card stock can be pasted or imported from common delimited, labeled text, CSV, TSV, JSON, or JSON Lines layouts. Address, state, city, and ZIP remain stored per-card fields; cards in one base may have different locations. Blank fields use that base's location defaults, and new uploads snapshot the resolved values so later default edits do not change them. The member catalog, order history, and member exports show each card's city, state, and ZIP, but never its street address. Stored order data and admin views retain the address.

Automatic issuer, type, and brand detection may use a public BIN lookup after a batch is accepted. Look up each distinct first 6-digit prefix once and store the resulting metadata per inventory card so mixed-prefix batches work; product-level metadata remains the fallback. Existing inventory may be rechecked by an administrator. Send only 6-digit prefixes—never full card numbers, expiration, security codes, or actual email/phone values—to the lookup.

The member catalog display and shared metadata lookup both use the first 6 digits of each card number.

The member catalog's Card column displays only the card number's last four digits. Never send the full card number to the browser.

Keep the member catalog's Name, Base, and City fields distinct: Name is the cardholder's name, Base is the product/base name, and City is the card's city.

**Why:** The user clarified that the Name category means the person's name, not the base name, and explicitly approved showing and filtering it for signed-in buyers before purchase.

**How to apply:** Keep cardholder name, base name, and per-card city separate in imports, encrypted storage, admin previews, the pre-purchase member catalog, and post-purchase delivery; keep full card credentials private until purchase.

When source headers provide Name, City, State, Type, Issuer, or Brand, preserve each as its own per-card value; supplied type/issuer/brand should take precedence over BIN or base-level fallback. Do not bulk-move historical City values into Name based on text alone.

**Why:** Existing values cannot reliably distinguish a person's name from a place name; corrections need labeled source data or individual review.

**How to apply:** Keep labeled imports and member-facing columns aligned, and require explicit review before correcting ambiguous historical rows.

**Why:** The user confirmed the inventory is authorized prepaid Visa gift cards and required credentials and actual contact values to stay private until purchase. They requested public per-card location fields, reiterated that street addresses must not appear in member-facing views, and required city/state/ZIP to remain visible while stored/admin address data is preserved. They chose per-card type, issuer, and brand lookup so mixed-prefix batches work, repeated uploads to active bases, a 1,000-card per-base cap, and reversible archiving. Per the user's correction, both the member BIN and metadata lookup use six digits. The user also requested a last-four-only member display; full card numbers must never reach member browsers.

**How to apply:** Derive the six-digit BIN and last four digits on the server from the encrypted credential. For public metadata, deduplicate first-six-digit prefixes after acceptance and persist results on individual inventory rows; use product metadata only as fallback.

**How to apply:** Keep this catalog separate from log products. Locally detect and normalize supported import layouts, then preview and validate records before upload. Store each card's public location; do not reject different locations within one base. Blank per-card location fields use base defaults, snapshotted at upload time. List only public locations in the catalog and pair each purchased card with its own location in authenticated order history, while rendering city/state/ZIP only in member pages and exports. Keep base metadata as a fallback for legacy rows. Encrypt card number, expiration, security code, and actual email/phone values at rest; show full credentials only to the authenticated purchaser, and never add PIN support. Public listings and admin inventory may show whether contact values are present, but never their contents. Accept up to 100 cards per atomic batch on any active base, under a product-row lock; reject credentials already in inventory, including across earlier batches, and never let available stock exceed 1,000 cards per base. Sold cards do not count toward this active-stock cap. If a base has inventory or order history, archive it instead of deleting linked card, order, or ledger rows; hide archived bases from member sales and let admins restore them. Physically delete only bases with no inventory or history. Catalog BINs and metadata lookups use the first six digits; run metadata lookup only after acceptance, deduplicated per batch; lookup failures must not block upload. Retain single-card checkout.

The member catalog's Filters dialog should remain an inset panel centered on mobile, not expand edge-to-edge.

**Why:** The user chose the centered panel over the full-screen mobile layout and confirmed that the resulting panel appears centered.

**How to apply:** Preserve the centered, inset mobile dialog when adjusting the card catalog filters.