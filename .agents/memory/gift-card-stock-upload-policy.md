---
name: Gift-card stock upload policy
description: Admin bulk stock uploads should report row problems without discarding an otherwise valid batch.
---

Do not reject an entire admin stock batch because some rows are malformed, duplicated, or exceed a base's remaining capacity. Import valid, unique cards that fit; skip the rest and show admins clear counts. Preserve admin access checks, archived-base restrictions, encrypted credential storage, and the existing stock cap.

**Why:** The user asked that stock uploads not be rejected and that admins be warned instead.

**How to apply:** Use partial success with visible skipped-row counts. Never store malformed credentials or exceed the base cap just to avoid a warning.