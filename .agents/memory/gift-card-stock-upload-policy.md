---
name: Gift-card stock upload policy
description: Admin bulk stock uploads should report row problems without discarding an otherwise valid batch.
---

Do not reject an entire admin stock batch because some rows are malformed, duplicated, unrelated, or exceed a base's remaining capacity. Scan mixed input for card records, import valid unique cards that fit, skip unrelated or unusable rows, and show admins clear counts. Preserve admin access checks, archived-base restrictions, encrypted credential storage, and the existing stock cap.

**Why:** The user asked that stock uploads not be rejected and that admins be warned instead. They also confirmed that mixed content is acceptable on the Cards page: auto-parse detected card records and skip other rows.

**How to apply:** Use partial success with visible counts for unrelated rows, invalid card rows, duplicates, and capacity overflow. Never store malformed credentials or exceed the base cap just to avoid a warning.