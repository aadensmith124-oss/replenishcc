---
name: Development API database environment
description: Distinguish built-in database availability from API workflow DATABASE_URL injection failures.
---

If the Replit development database tool succeeds but the API artifact fails before listening with `DATABASE_URL` missing, do not bypass the database guard or put connection details in code. Check for an overriding `DATABASE_URL` secret or environment configuration and compare it with the Database pane's connection details.

**Why:** A successful database-tool query does not guarantee the API workflow received the managed connection variable; Replit documentation identifies a conflicting secret or configuration as a common cause.

**How to apply:** When API startup reports a missing `DATABASE_URL` despite database-tool connectivity, inspect the Replit environment configuration without printing, requesting, or storing the connection string.