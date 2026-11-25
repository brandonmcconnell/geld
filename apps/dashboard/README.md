# Geld dashboard

The dashboard runs independently from the marketing site.

Run `corepack pnpm install` at the repository root, then `corepack pnpm --filter @geld/dashboard dev`.
It listens on port 3001.
Copy `.env.example` to the ignored `.env.local` and configure the services you need.
Use the local demonstration setting for synthetic queue data without authentication.
Demo writes are always disabled, and demo mode is rejected in production and hosted environments.
Without service configuration the app renders signed-out and unavailable states.

Better Auth uses Postgres, with encrypted OAuth credentials and hashed OTP and magic-link verifications.
Apply the ordered SQL files in `db/migrations` to an empty development database before testing real accounts.
Never apply them to existing user data without an owner-reviewed migration plan.
The schema contract test checks every field against the installed Better Auth version using ephemeral Postgres.
Register callbacks at the configured dashboard origin under `/api/auth/callback/github`, `/gitlab`, `/bitbucket`, `/github-repository` and optionally `/github-oauth`.
Preview deployments disable sign-in.

`corepack pnpm --filter @geld/dashboard check` runs type generation, TypeScript, lint, tests and the production build.
The root `corepack pnpm check` includes the app.
Read the architecture and data inventory in `docs/dashboard` before adding persisted fields.

## Cloudflare Workers

The dashboard also builds with [Vinext and the Cloudflare Vite plugin](https://vinext.dev/docs/deploying/cloudflare).
Run these commands at the repository root with a Node.js version supported by Vite 8 (20.19+, 22.12+ or a newer LTS release).

```sh
corepack pnpm --filter @geld/dashboard exec vinext check
corepack pnpm --filter @geld/dashboard dev:vinext
corepack pnpm --filter @geld/dashboard build:vinext
corepack pnpm --filter @geld/dashboard preview:vinext
```

The Worker runs the App Router on demand and serves immutable frontend files from Workers Static Assets.
It uses the same security headers as Next.js.
The Next.js build continues to use Cache Components for Vercel and self-hosting.
Both tools generate `next-env.d.ts` locally.

For a signed-out smoke deployment, select the test account with `CLOUDFLARE_ACCOUNT_ID`, set `GELD_DASHBOARD_WORKER_NAME` to a unique test Worker name, then run the deploy command.

```sh
corepack pnpm --filter @geld/dashboard deploy:cloudflare --mode preview
```

This mode enables `workers.dev` and omits the database bindings.
Use an empty Worker and leave service secrets unset.
Check `/`, `/sign-in`, `/api/health` and `/api/session` at its URL. `/api/auth/ok` should return 503 in this mode.

For local authentication tests, migrate a disposable Postgres database, set `GELD_HYPERDRIVE_ID` to a Hyperdrive ID, and set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_GELD_DATABASE` to the test connection string.
Set `BETTER_AUTH_URL=http://localhost:3001`, `BETTER_AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY` in the ignored `.dev.vars` file in this directory before running `dev:vinext`.

For a configured Worker, set `GELD_HYPERDRIVE_ID` and bind the primary Postgres database through Hyperdrive with query caching disabled.
If the deployment uses a separate customer content database, set `GELD_CUSTOMER_CONTENT_HYPERDRIVE_ID` to a second Hyperdrive with caching disabled.
The Worker uses bindings for these databases. `DATABASE_URL` and `CUSTOMER_CONTENT_DATABASE_URL` are for Vercel and self-hosting.
Set `BETTER_AUTH_URL` to the Worker's intended HTTPS origin and configure `BETTER_AUTH_SECRET` and `TOKEN_ENCRYPTION_KEY` as Worker secrets.
List additional settings from `.env.example` in `GELD_DASHBOARD_SECRET_NAMES` as comma-separated names and supply their values as Worker secrets.
Keep the signing and encryption keys stable across hosts during cutover so existing cookies and encrypted credentials still work at the same origin.
Run the database migrations and configure the existing `/api/jobs` scheduler, provider callbacks and webhooks for the intended origin before routing traffic to a configured Worker.
