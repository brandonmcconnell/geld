# Marketing site on Cloudflare Workers

The site supports Vinext alongside its existing Next.js commands. Install from the workspace root with the pinned pnpm version and the private Font Awesome kit token supplied via `FONTAWESOME_PACKAGE_TOKEN`.

## Local validation

```sh
pnpm --filter @geld/site exec vinext check
pnpm --filter @geld/site dev:vinext
```

To test the built Worker locally, set `GELD_SITE_PREVIEW_ORIGIN` to `http://localhost:4173` before the build, then run the preview and check it from a second terminal.

```sh
pnpm --filter @geld/site build:vinext
pnpm --filter @geld/site start:vinext
pnpm --filter @geld/site check:vinext-preview http://localhost:4173
```

The check reads the homepage as Discordbot, follows its `og:image` from the HTML head, and decodes the 1200 × 630 PNG. The Vinext build renders the shared card with Next's image renderer so the Worker can serve the PNG within the CPU limit on a cold request.

## Deploy an isolated test Worker

The deploy command requires `CLOUDFLARE_ACCOUNT_ID` for the test account, `CLOUDFLARE_WORKER_NAME` for a unique Worker name, and `GELD_SITE_PREVIEW_ORIGIN` for that Worker's HTTPS `workers.dev` origin. It checks the origin against the selected account and builds from source for every deployment. That build-time origin makes the preview's share metadata same-origin and sets `noindex`.

Use the project's `cf` CLI to authenticate to the test account if needed. For an account with no Workers yet, supply a `CLOUDFLARE_API_TOKEN` with Workers Scripts Write so the command can look up the subdomain directly.

```sh
pnpm --filter @geld/site exec cf auth login
pnpm --filter @geld/site deploy:vinext --dry-run
pnpm --filter @geld/site deploy:vinext
pnpm --filter @geld/site check:vinext-preview https://your-worker.your-subdomain.workers.dev
```

The first deploy provisions a Worker-specific KV namespace for Vinext's data cache. It backs the existing hourly GitHub release lookup and eligible route caching. Vinext supports the `use cache` directive and cache profiles used here. Its Cache Components and partial prerendering behavior can differ from Next.js.

Use the test origin without production OAuth or analytics credentials. Before a production cutover, verify sign-in, refresh and sign-out against the registered GitHub callback, confirm analytics still requires consent, and confirm the canonical homepage and its image on the production hostname. Build with `GELD_SITE_PREVIEW_ORIGIN` unset for the canonical `www.geld.sh` metadata. Keep the Vercel deployment available for rollback until those checks pass on Cloudflare.
