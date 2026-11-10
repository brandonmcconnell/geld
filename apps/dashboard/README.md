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

## Private deployment at app.geld.sh

The `dreamthinkbuild/geld-dashboard` Vercel project serves `https://app.geld.sh` behind Vercel Authentication during testing.
The website's sign-in and settings links remain on the legacy website flow until the dashboard rollout is explicitly approved.
Workspace pages require an authenticated actor before rendering.
Sign-in, password recovery and privacy pages remain public and do not show workspace navigation.

Use a new, isolated Neon database for this deployment.
Connect its pooled URL as `DATABASE_URL` and verify the database is empty before the initial migration.
Use the direct connection for schema administration if the database provider requires it.
Never point an initial migration at another application's database.

The minimum configuration for GitHub sign-in is `BETTER_AUTH_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GITHUB_IDENTITY_CLIENT_ID` and `GITHUB_IDENTITY_CLIENT_SECRET`.
Use `https://app.geld.sh` for the hosted origin and `http://localhost:3001` for local development.
Use independent authentication and encryption secrets for each environment.
The GitHub identity App must retain the website callbacks and additionally allow `/api/auth/callback/github` at both dashboard origins.
Preview deployments intentionally disable sign-in; the protected custom domain uses Vercel's Production target for live account testing.

After configuring a new database, run `corepack pnpm --filter @geld/dashboard db:initialize` with its connection string supplied through the environment or the ignored `.env.local`.
Initialization refuses a database with existing public tables, views or sequences, before creating the migration ledger.
The migration runner records applied files and runs schema changes in one transaction, preferring `DATABASE_URL_UNPOOLED` when available.
Use `db:migrate` for subsequent, reviewed migrations; neither command runs automatically during normal builds or application startup.
Verify sign-in, automatic personal workspace creation, sign-out, and repository authorization before testing review writes on a disposable repository.
Add email delivery for codes, password recovery and invitations, then configure AI and Stripe test mode for guide testing.
The background runner needs `CRON_SECRET` and a scheduler that can reach the protected deployment.

`/api/health` is a process liveness check, not proof of database or authentication readiness.
Verify `/api/auth/get-session` and a real authenticated flow before considering setup complete.
Keep dashboard CI advisory during private rollout, then restore required checks before public launch.
