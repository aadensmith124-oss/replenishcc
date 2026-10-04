---
name: Development API database environment
description: Distinguish built-in database availability from API workflow DATABASE_URL injection failures.
---

If the Replit development database tool succeeds but the API artifact fails before listening with `DATABASE_URL` missing, do not bypass the database guard or put connection details in code. Check for an overriding `DATABASE_URL` secret or environment configuration and compare it with the Database pane's connection details. Replit documents that a user-created secret named `DATABASE_URL` overrides the runtime-managed database variable.

The current custom `DATABASE_URL` is a production or external database. Do not run development schema pushes against it; use a confirmed development/test database for schema changes.

**Why:** A successful database-tool query does not guarantee the API workflow received the managed connection variable; a same-name secret can shadow it and leave the app using the wrong connection or receiving no usable URL. The user also explicitly identified the current connection as production/external and said not to apply schema changes to it.

**How to apply:** When API startup reports a missing `DATABASE_URL` despite database-tool connectivity, inspect the Replit environment configuration without printing, requesting, or storing the connection string. Confirm which database the user intends before changing or removing a same-name secret. Never run `db push` against the current external/production connection.