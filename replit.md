# ReplenishCC Authentication

A mobile-first account portal for ReplenishCC with working registration, sign-in, password recovery, legal placeholders, and a protected dashboard.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/replenishcc-auth run dev` — run the ReplenishCC web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required environment: `DATABASE_URL` (provided by the project's PostgreSQL database) and `SESSION_SECRET` (a private random value of at least 32 characters)

For local development, copy `.env.example` to a private `.env` file and provide the variables. Never commit real secrets. Replit provisions `DATABASE_URL`; the project already has a `SESSION_SECRET` secret configured.

## Database setup

The users, sessions, and password-reset-token tables are defined in `lib/db/src/schema/auth.ts`. Apply development schema changes with:

```sh
pnpm --filter @workspace/db run push
```

The database enforces unique email and username values. Password hashes, session digests, and reset-token digests are stored; plaintext passwords and raw session tokens are not.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Password hashing: bcrypt
- Build: esbuild

## Where things live

- `artifacts/replenishcc-auth` — ReplenishCC React/Vite frontend and account pages
- `artifacts/api-server/src/routes/auth.ts` — authentication API routes
- `lib/db/src/schema/auth.ts` — PostgreSQL auth schema
- `lib/api-spec/openapi.yaml` — API contract; generated client and validation live in `lib/api-client-react` and `lib/api-zod`

## Architecture decisions

- Opaque, signed, HTTP-only cookies reference server-side sessions; the database stores only a keyed digest of the session token.
- Password reset tokens are single-use, expire after one hour, and are stored as keyed digests.
- Same-origin checks and `SameSite=Lax` cookies protect session-changing requests against cross-site requests.
- Login, registration, reset requests, and reset completion have per-process IP rate limits.
- Development reset links are written to the API log. Password-reset email delivery is not configured; the API returns a generic service-unavailable response in production until a mail provider is added.

## Product

- Sign up with full name, optional username, email, and a validated password; registration signs the user in.
- Sign in with a remember-me option, request/reset a password, view privacy and terms placeholders, and access a protected dashboard.

## User preferences

- Keep new work focused on the member and admin features the user has requested; do not add unrelated future modules.
- Use the supplied near-black/charcoal and restrained warm-gold ReplenishCC palette; do not reuse SpiderCC branding or red buttons from reference screenshots.

## Gotchas

- After updating the OpenAPI contract, run codegen before using generated API types.
- Configure an email delivery provider before enabling password recovery in production.
- The current rate limiter is in-memory and should be replaced with a shared store before running multiple API instances.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
