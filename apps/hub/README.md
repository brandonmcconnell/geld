# Geld Hub

The Geld review workspace: pull requests, issues, reviews and repositories in one place.
A TanStack Start app that runs as a Cloudflare Worker.

## Run it

From the repository root, with Node 24.22 or newer:

```bash
pnpm install
pnpm dev:hub:demo
```

Demo mode starts a local GitHub emulator (`apps/hub-emulator`, port 4200) with seeded
data and the app on <http://localhost:3200>. Sign in with "Continue with GitHub" and pick
`nova`. No GitHub app or secrets are needed. See [docs/local-demo-mode.md](docs/local-demo-mode.md).

`pnpm dev:hub` runs against github.com instead and needs `apps/hub/.env`
(copy `env.example`; `env.ts` lists every value the Worker reads). See
[docs/local-dev.md](docs/local-dev.md).

## GitHub configuration

Running against github.com needs both a GitHub OAuth App and a GitHub App.

OAuth App:

- Callback URL: `http://localhost:3200/api/auth/callback/github`
- Environment variables: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`
- Used for sign-in and public or external repository reads.

GitHub App:

- Callback URL: `http://localhost:3200/api/github/app/callback`
- Setup URL: `http://localhost:3200/?show-org-setup=true`
- Enable **Redirect on update**
- Leave **Request user authorization (OAuth) during installation** unchecked
- Environment variables: `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`
- Webhook URL: `/api/webhooks/github`
- Used for installation discovery and app-scoped repository access.

Never commit `.env` or private keys.

## Checks

```bash
pnpm --filter @geld/hub check        # typecheck and unit tests
pnpm --filter @geld/hub build        # production build
pnpm test:hub:e2e                    # Playwright against demo mode
```

`biome:check` and `biome:lint` are available in each hub package but are not part of `check` yet.

## Layout

- `src/routes` file-based routes, `src/components` screens, `src/lib` data and server code.
- `packages/hub-ui` components and tokens, `packages/hub-icons` icons from the Geld Font Awesome kit.
- `apps/hub-emulator` the GitHub emulator for demo mode and tests, `apps/hub-e2e` the Playwright suite.
- [docs/data-fetching.md](docs/data-fetching.md) explains caching and revalidation.
