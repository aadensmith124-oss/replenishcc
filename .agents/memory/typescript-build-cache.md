---
name: TypeScript build-info cache
description: How to distinguish stale TypeScript build metadata from real source errors after dependency changes.
---

When package or code-generator types change, stale TypeScript build info can preserve old declarations and report version-mismatch errors that do not match the current lockfile. A clean compile with a fresh `--tsBuildInfoFile` helps distinguish cached metadata from a source problem.

**Why:** Dependency rollback exposed stale generated type metadata; the isolated clean compile passed while the cached workspace check failed.

**How to apply:** If TypeScript errors contradict the currently resolved package versions, run the affected project once with a fresh build-info path before changing application code.