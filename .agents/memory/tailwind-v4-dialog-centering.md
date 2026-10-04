---
name: Tailwind v4 dialog centering
description: Prevent inherited Tailwind individual translate utilities from offsetting custom-centered Radix dialogs.
---

When custom dialog CSS centers content with left/right insets and auto margins while overriding `transform`, clear Tailwind v4's individual `translate` property too. Tailwind's `translate-x-*` utility composes separately with `transform`, so the dialog can remain shifted even when its insets and margins are centered.

**Why:** A custom-positioned Radix dialog remained horizontally offset because the shared dialog classes still applied Tailwind v4's separate translate property.

**How to apply:** When overriding `DialogContent` positioning, inspect the compiled Tailwind utilities and neutralize inherited `translate` if the custom layout already handles horizontal centering.