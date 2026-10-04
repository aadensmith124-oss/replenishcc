---
name: Vanilla gift-card store
description: Confirmed ReplenishCC scope for prepaid Vanilla Visa gift-card inventory and delivery.
---

The card store is for authorized, unused Vanilla Visa prepaid gift cards. Administrators create bases with only a name and per-card Price, then upload up to 100 cards per batch. Active bases may receive additional batches up to 1,000 currently available cards; sold cards remain in history and free capacity for restocking. Archived bases must be restored first. Members purchase cards and retrieve them from their own order history; checkout remains one card per base per purchase.

Bases with inventory or purchase history can be archived to hide them from member sales while preserving all records; admins can restore them. Only empty bases are physically deleted.

Keep the legacy face-value column and API data unless the user explicitly approves a schema/data change. Do not show face value in the card-store UI; new bases populate the required legacy value from Price for compatibility.

Card stock can be pasted or imported from common delimited, labeled text, CSV, TSV, JSON, or JSON Lines layouts. Address, state, city, and ZIP remain stored per-card fields; cards in one base may have different locations. Blank fields use that base's location defaults, and new uploads snapshot the resolved values so later default edits do not change them. The member catalog displays each card's city, state, and ZIP, but not its street address. Order history pairs the purchased card with its own location.

Automatic issuer, type, and brand detection may use a public BIN lookup after the batch is accepted, but only when all cards in the batch share the same BIN prefix; send only that shared first 8 digits. Expiration, security code, and actual email/phone values stay out of that lookup. Gift-card stock has no PIN field.

The member catalog displays a per-card BIN using the first 6 digits. This is separate from the 8-digit prefix used for shared metadata lookup.

The member catalog's Card column displays only the card number's last four digits. Never send the full card number to the browser.

**Why:** The user confirmed the inventory is authorized prepaid Visa gift cards and required credentials and actual contact values to stay private until purchase. They first requested public per-card location fields, then clarified that member catalog rows must omit street addresses while keeping city/state/ZIP and preserving admin/order data. They chose public BIN lookup, repeated uploads to active bases, a 1,000-card per-base cap, and reversible archiving. The member BIN uses six digits; the lookup prefix stays eight. The user also requested a last-four-only member display; full card numbers must never reach member browsers.

**How to apply:** Derive the suffix on the server from the encrypted credential and expose only that suffix in member-facing catalog responses.

**How to apply:** Keep this catalog separate from log products. Locally detect and normalize supported import layouts, then preview and validate records before upload. Store each card's public location; do not reject different locations within one base. Blank per-card location fields use base defaults, snapshotted at upload time. List only public locations in the catalog and return the matching location with each card in authenticated order history. Keep base metadata as a fallback for legacy rows. Encrypt card number, expiration, security code, and actual email/phone values at rest; show full credentials only to the authenticated purchaser, and never add PIN support. Public listings and admin inventory may show whether contact values are present, but never their contents. Accept up to 100 cards per atomic batch on any active base, under a product-row lock; reject credentials already in inventory, including across earlier batches, and never let available stock exceed 1,000 cards per base. Sold cards do not count toward this active-stock cap. If a base has inventory or order history, archive it instead of deleting linked card, order, or ledger rows; hide archived bases from member sales and let admins restore them. Physically delete only bases with no inventory or history. Catalog BINs show six digits per card; lookup metadata only after acceptance and only for a batch with one shared 8-digit prefix; lookup failures must not block upload. Retain single-card checkout.

The member catalog's Filters dialog should remain an inset panel centered on mobile, not expand edge-to-edge.

**Why:** The user chose the centered panel over the full-screen mobile layout and confirmed that the resulting panel appears centered.

**How to apply:** Preserve the centered, inset mobile dialog when adjusting the card catalog filters.