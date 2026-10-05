---
name: Gift-card schema compatibility
description: Detect optional columns on the same relation that unqualified stock queries resolve.
---

For optional gift-card inventory fields used by a write, resolve the table with `to_regclass('gift_card_inventory')` and inspect `pg_catalog.pg_attribute` on the same transaction connection as the write. Do not rely on `information_schema.columns` filtered only by `current_schema()`, or a pre-transaction probe on another pooled connection.

**Why:** A production stock upload continued returning PostgreSQL error 42703 for `card_type` after schema detection was changed to `to_regclass`. Probing outside the transaction can still use a pooled connection with a different `search_path` from the insert.

**How to apply:** When unqualified ORM writes target tables with optional columns, probe on the same transaction connection immediately before the write. Keep related optional fields all-or-none and log only safe schema identifiers when diagnosing failures.
