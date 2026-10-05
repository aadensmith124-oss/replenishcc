---
name: Gift-card schema compatibility
description: Detect optional columns on the same relation that unqualified stock queries resolve.
---

For optional gift-card inventory fields, resolve the table with `to_regclass('gift_card_inventory')` and inspect `pg_catalog.pg_attribute`; do not rely on `information_schema.columns` filtered only by `current_schema()`.

**Why:** A production stock upload returned PostgreSQL error 42703 even though the compatibility probe used `current_schema()`. The unqualified table name may resolve to a relation in a later schema on `search_path`.

**How to apply:** When unqualified ORM queries target tables with optional columns, probe columns on the exact relation they resolve to. Keep related optional fields all-or-none and log only safe schema identifiers when diagnosing failures.
