# Vercel deployment

This repository is configured as one Vercel project: Vite serves the web app
and a Node.js Function serves the existing Express API at `/api/*`. This keeps
browser requests, authentication cookies, and same-origin checks on one host.

## Vercel project settings

- Connect the repository at its root (do not set a monorepo subdirectory).
- Use the **Other** framework preset. `vercel.json` supplies the install command,
  build command, static output directory, and SPA fallback.
- Keep the default Node.js runtime. The `api/[...path].ts` function forwards API
  requests to the existing Express app.
- Add the environment variables below to the Vercel Production environment
  before the first production deployment. Add Preview values separately if
  preview deployments should connect to a database.

The build runs the workspace typechecks and builds only the web app. Vercel
builds the API function from its TypeScript entry point.

## Runtime environment

Required:

- `DATABASE_URL` — A PostgreSQL connection string reachable from Vercel. Replit
  documents that its database can be reached by external PostgreSQL clients;
  use the connection string from the database's **Settings** page. This lets
  Vercel use the existing Replit database without migrating it. This project
  cannot verify connectivity for a particular database or Vercel region.
- `SESSION_SECRET` — The same value used by the existing Replit deployment if
  Vercel will use its database. Gift-card credentials and license-key stock are
  encrypted using this value. Store it in Vercel's environment settings; never
  commit or paste it into source files or chat.

Optional, depending on enabled features:

- `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET` — Required for
  NOWPayments crypto deposits.
- `DEPOSIT_ADMIN_EMAILS` — Comma-separated email addresses allowed to manage
  deposits.
- `LOG_LEVEL` — Overrides the API logger level.

Vercel production password recovery is not enabled in the current code: the
forgot-password API returns `503` in production until an email delivery
provider is implemented and configured. Do not advertise password recovery as
available until that work is complete.

## Before switching production traffic

1. Confirm the chosen `DATABASE_URL` connects from a Vercel deployment. Do not
   put a database URL in this repository. If you choose a different database,
   plan and authorize a data migration separately; this setup does not migrate
   data or run schema changes.
2. Set `SESSION_SECRET` to the existing value if the deployment will read
   existing encrypted gift-card or license-key stock.
3. Deploy a preview and check `/api/healthz` returns `{"status":"ok"}`, then
   verify sign-in, balance/deposit flows, and any payment webhook configuration
   against the intended environment.
4. Complete and test production email delivery before enabling account recovery.

For Replit's external PostgreSQL connection details, see
[Connection details](https://docs.replit.com/features/data-and-storage/connection-details).
For Vercel's Node.js Functions and Express support, see
[Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js) and
[Express on Vercel](https://vercel.com/docs/frameworks/backend/express).