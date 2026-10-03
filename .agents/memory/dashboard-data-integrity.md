---
name: Dashboard data integrity
description: ReplenishCC dashboard data and future member-page behavior.
---

For ReplenishCC, do not use mock dashboard data. Keep feature pages deferred until requested, and show only real authenticated session data or real service data; keep unfinished destinations clearly unavailable.

**Why:** The user asked for a dashboard shell without mock data and said the pages would be made later.

**How to apply:** When adding member pages, follow real API contracts and render honest loading, empty, or unavailable states instead of sample balances, orders, transactions, or activity.