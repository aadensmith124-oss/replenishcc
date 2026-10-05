---
name: Database error log redaction
description: Avoid logging sensitive SQL parameters from wrapped database errors.
---

Never serialize raw Drizzle/Postgres errors into application logs. Query-wrapper messages or stacks can include SQL text and bound values; gift-card writes include encrypted credentials and per-card location data. Log only allowlisted error type, SQLSTATE, schema, table, column, and constraint identifiers. Omit raw messages, details, query text, parameters, and stacks.

**Why:** A production stock-upload failure logged expanded insert parameters while reporting a missing optional inventory column.

**How to apply:** In API-level and route-level error handlers, walk the error cause chain and emit only validated metadata fields. Keep a request ID for correlation; never log the raw ORM error object.
