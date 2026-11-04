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
