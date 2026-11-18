# Local development

Two ways to run the dashboard locally. Both serve <http://localhost:3200> from
`vite dev` with [Void](https://void.cloud)'s Vite plugin (Miniflare/workerd), so
the Worker runs the same way it does in production. `apps/hub/void.config.ts`
declares its bindings for both; there is no Cloudflare config to copy.

| | `pnpm dev:hub:demo` | `pnpm dev:hub` |
|---|---|---|
| GitHub | local emulator (`apps/hub-emulator`, :4200) with a seeded workspace | real github.com |
| Credentials | none, committed throwaway `apps/hub-emulator/dashboard.env` | your OAuth App + GitHub App in `apps/hub/.env` |
| Postgres | `geld_hub_demo` on the compose Postgres | `DATABASE_URL` in `apps/hub/.env` |
| Cache and Durable Objects | local, `apps/hub/.wrangler/demo-state` | local, `apps/hub/.wrangler/state` |
| Network | not needed | needed |

Requirements: Node 24.22+, pnpm 10 (`corepack enable`) and a Postgres. Run
`pnpm install` once after cloning, and start Postgres with:

```sh
docker compose -f apps/hub/compose.yaml up -d
```

It listens on port 5433 with a `geld_hub` database for real GitHub and a
`geld_hub_demo` one for demo mode and the end-to-end tests. To use another
Postgres, set `DATABASE_URL` in `apps/hub/.env`, and
`GELD_HUB_DEMO_DATABASE_URL` in the shell for demo mode and the tests.

## Demo mode (no GitHub)

```sh
pnpm install
pnpm dev:hub:demo            # --reset empties the demo database and cache and reseeds the emulator
```

It applies the database migrations, starts the emulator and waits for its
seed, starts the dashboard and makes the first request so the Worker is
warm when you open it. Sign in with **Continue with GitHub** and pick **nova**. What is emulated
and how: [local-demo-mode.md](local-demo-mode.md).

## Real GitHub

1. Create a GitHub OAuth App and a GitHub App, and install the App
   ([README, steps 2–4](../README.md#2-create-a-github-oauth-app)).
2. Credentials:
   ```sh
   cp apps/hub/env.example apps/hub/.env
   ```
   Fill in the values ([README, step 5](../README.md#5-configure-environment-variables)).
   `apps/hub/env.ts` lists every value and which ones are required; `pnpm
   --filter @geld/hub exec void env check` validates your file. An
   older checkout's `.dev.vars` works as is once renamed to `.env`.
3. Start it:
   ```sh
   pnpm dev:hub
   ```
   It links `.env` from the main checkout when you are in a git worktree, then
   applies new database migrations (`pnpm --filter @geld/hub db:migrate`) and
   starts the dashboard.

Webhooks need a public tunnel. See
[Local webhook testing](../README.md#local-webhook-testing).

## When something is off

Both commands check for these before starting anything, and stop with a message
that says what to do:

- **Port 3000 or 4001 busy.** The message names the process and its directory.
  Stop it (often another `pnpm dev:hub` or `pnpm dev:hub:demo`, possibly from another
  worktree) and re-run. The ports are fixed because the OAuth callback URLs
  point at them.
- **Missing `.env`, or a leftover `.dev.vars`** (only `pnpm dev:hub`). Void reads
  `.env` only and refuses to start while another env file sits next to it.
- **Dependencies not installed or Node too old.**

Re-running is safe: migrations only apply what is new, and the emulator restores
its saved state, or reseeds when the seed changed. For a clean demo, use `pnpm
dev:demo --reset`.

If the first request fails with a 500, the dashboard output above it has the
cause.

## Production build locally

```sh
pnpm --filter @geld/hub build
pnpm --filter @geld/hub preview
```
