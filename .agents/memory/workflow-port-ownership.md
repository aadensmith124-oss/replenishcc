---
name: Workflow port ownership
description: How to handle stale child processes that survive artifact workflow restarts.
---

Failed or repeated artifact workflow starts can leave a child Vite or Node listener running even when the managed workflow reports failure. That process can occupy the configured port or push a later dev server onto a fallback port.

**Why:** In this workspace, API, web, and mockup workflows had stale child listeners after failed runs. Clearing only those project dev-server processes before restarting the exact managed workflows restored all three services.

**How to apply:** Before retrying a failed artifact workflow, inspect its configured port with `lsof`, confirm the listener belongs to that artifact, stop only the confirmed dev-server process tree, then restart the existing managed workflow once.