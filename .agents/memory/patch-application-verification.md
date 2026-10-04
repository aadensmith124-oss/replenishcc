---
name: Patch application verification
description: Verify every intended edit after using the workspace patch tool on multi-part changes.
---

Do not treat a successful multi-hunk patch response as proof that every requested hunk landed. In this project, a large edit to the catalog page reported success while several added UI and API-caller changes were absent; typecheck still passed because those paths were not yet referenced.

**Why:** A partial patch can leave a feature looking complete while required UI or data-flow pieces are missing.

**How to apply:** After multi-part edits, search for each expected symbol and inspect `git diff` before building or restarting workflows. Split larger changes into smaller hunks when needed.