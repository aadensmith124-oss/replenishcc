# Vercel deployment

This repository is configured as one Vercel project with three independently
built services. The ReplenishCC web app and API share the public project domain,
so browser requests, authentication cookies, and same-origin checks stay on one
host. The component mockup sandbox is configured as internal-only.

## Services and routing

- `api-server` (`artifacts/api-server`) — Express; public requests under
  `/api/*`. The service receives the original `/api/...` path, which matches
  the existing Express router.
- `replenishcc-auth` (`artifacts/replenishcc-auth`) — Vite; public fallback
  for all other paths, including client-side routes.
- `mockup-sandbox` (`artifacts/mockup-sandbox`) — Vite; internal-only, with no
  public rewrite. It is a component-preview tool and no production service calls
  it, so no service binding is needed.

Connect the Git repository at its root so the service roots can resolve the
shared pnpm workspace. Vercel Services is currently documented as a beta
feature. The API service uses its Express TypeScript entry point; the Vite
services build to `dist/public` and `dist` respectively and use service-level
SPA fallbacks.

## Runtime environment

Set runtime variables in the Vercel project's environment settings before
deploying. The API service requires:

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
- `DEPOSIT_ADMIN_EMAILS` — Comma-separated email addresses allowed to use the
  app's administrator routes. Preserve existing entries when adding an admin.
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
3. Set `DEPOSIT_ADMIN_EMAILS` in Vercel Production to the intended
   comma-separated administrator list.
4. Deploy a preview and check `/api/healthz` returns `{"status":"ok"}`, then
   verify sign-in, balance/deposit flows, and any payment webhook configuration
   against the intended environment.
5. Complete and test production email delivery before enabling account recovery.

For Replit's external PostgreSQL connection details, see
[Connection details](https://docs.replit.com/features/data-and-storage/connection-details).
For Vercel Services routing and configuration, see
[Services](https://vercel.com/docs/services),
[Services routing](https://vercel.com/docs/services/routing),
[Service configuration](https://vercel.com/docs/services/config-reference), and
[Express on Vercel](https://vercel.com/docs/frameworks/backend/express).