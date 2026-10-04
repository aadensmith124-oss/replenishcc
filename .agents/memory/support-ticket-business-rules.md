---
name: Support ticket business rules
description: ReplenishCC's current order, refund, and replacement boundaries for support tickets.
---

Support purchase-ticket order IDs must match an order owned by the ticket member and the ticket category. Admins should be able to confirm the match, copy the ID, and review order details before deciding whether to credit the member's ReplenishCC balance. Replacements are not offered.

**Why:** The user requested verified order references and an admin review path before any balance refund.

**How to apply:** Resolve purchase references server-side using both member ownership and ticket category; never trust client-supplied order summaries. Keep refunds as auditable balance credits, and do not offer or record replacement actions.