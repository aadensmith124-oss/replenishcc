---
name: Account management scope
description: ReplenishCC deletion approval and email two-factor boundaries.
---

Account deletion approval must permanently erase the account and linked records, including deposits, balance/ledger data, sessions, and deletion-request history. The admin review UI must clearly disclose those consequences and require explicit confirmation before approval.

Email-based two-factor authentication must not simulate delivery. Until a real email sender is configured, show it as unavailable and do not present fake verification codes or an enable flow.

**Why:** The user explicitly chose permanent linked-record erasure and dismissed the proposed email-sender connection.

**How to apply:** Preserve these constraints when extending ReplenishCC account settings or admin deletion review.