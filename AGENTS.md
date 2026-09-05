# Geld — guide for agents and contributors

Geld is a browser extension that hides test files (and, optionally, other review noise) from GitHub diffs. This repository is a pnpm monorepo that also hosts the marketing site for geld.sh. Read this file before changing anything; it captures decisions that are not obvious from the code.

## Layout

```
packages/core/       @geld/core — pure TypeScript, no browser APIs. Glob matcher, hidden-file
                     categories & patterns, repository rules, settings model, unified-diff parser,
                     number formatting. Unit tested with Vitest. Consumed as TS source via
                     package.json "exports" (no build step).
apps/extension/      @geld/extension — the WXT extension (Chrome, Edge, Firefox, Safari).
apps/site/           @geld/site — Next.js site for geld.sh (see "Website" below).
assets/brand/        Logo + logomark SVGs (black and white variants). Both apps reference these.
.github/workflows/   CI: `pnpm check` (typecheck + tests everywhere) and `pnpm zip:all` artifacts.
```

Commands (root): `pnpm check` (typecheck + tests for core and the extension, plus lint + production build of the site), `pnpm test`, `pnpm build`, `pnpm zip:all` (zips for all four browsers into `apps/extension/.output/`), `pnpm dev` (extension), `pnpm dev:site`.

## Conventions

- TypeScript strict everywhere. **Never use `any`**, explicitly or implicitly, and never `ZodTypeAny`. Prefer type guards and `unknown` over casts; the codebase has no `as X` casts outside a couple of well-commented interop shims. Keep it that way.
- Extension imports shared logic only from `@geld/core` (never `../../packages/core/...`). Anything that could be reused by the site belongs in core; anything touching `browser.*`, the DOM or WXT stays in the extension.
- UI copy is short and specific; commit messages explain *why*.
- Website stack (fixed by the owner): latest stable Next.js (App Router, static generation; Cache Components/PPR for any dynamic bits), Tailwind, **shadcn on base-ui (not Radix)**, the **`cn` package** for class merging (not `clsx`, `tailwind-merge` or `cnfast`). Deployed on Vercel under the **dreamthinkbuild** account to **geld.sh**.

## How the extension works (short)

- `apps/extension/entrypoints/github.content/` runs on github.com (and user-added GitHub Enterprise hosts). `src/github/controller.ts` is the brain: a debounced `MutationObserver` re-runs an idempotent `apply()` that classifies each diff entry with `@geld/core`'s matcher, hides matches with **CSS flex `order` + attributes** (GitHub's DOM is never moved — the React view breaks otherwise), rewrites header counts, renders the bottom "N files hidden" row, and turns the file-tree sidebar into a full-height accordion ("Changes" + one panel per hidden category).
- Two adapters read GitHub's DOM: `views/legacy.ts` (classic Turbo/web-components diff view) and `views/react.ts` (commit pages and the newer PR files experience). Selectors were verified live against github.com in Sep 2026; the signed-in React PR files view was verified only indirectly (same components as commit pages). GitHub Enterprise Server was not tested against a real instance.
- Line counts come from the page when it renders per-file diffs; otherwise (PR conversation tab, PR lists, partially loaded large PRs) the background fetches the same `.diff` GitHub serves, via `entrypoints/background.ts` (needed because github.com redirects to `patch-diff.githubusercontent.com` without CORS). Parsed diffs are cached in `storage.local` keyed by the PR head SHA. Rate limiting: four concurrent fetches, only for rows near the viewport, 60 s backoff on 429/403. **No GitHub API is used.**
- Settings live in `storage.sync` (`src/lib/storage.ts`, writes serialised). Categories are opt-in except tests. Repo rules are gitignore-style (`owner/repo` off, `!` on, last match wins). Custom patterns support `[owner/repo]` scope headers.
- GitHub sign-in is the OAuth **device flow** (`src/lib/github-auth.ts`, no secret, no server); settings sync to a secret gist orchestrated by `src/lib/account-service.ts` in the background. Client id comes from `WXT_GITHUB_CLIENT_ID` (`.env`) or the options override; tokens live in `storage.local` only.
- **Settings are described once, in `@geld/core/settings-schema.ts`** (`SETTINGS_SCHEMA`): sections, fields (`toggle`, `categories`, `test-groups`, `list`), copy, placeholders, a `popup` flag (also show in the toolbar popup) and optional `surfaces` (`extension` / `site`) for fields that only make sense in a browser (badge, shortcut, Enterprise hosts, which need permission prompts). The popup renders `fieldsFor('extension', true)`, the options page fills its cards (`data-section="…"`) from `sectionsFor('extension')`, and geld.sh renders `sectionsFor('site')`. Add a setting by extending `GeldSettings`, `DEFAULT_SETTINGS`, `normalizeSettings` and the schema — the schema test fails until every boolean/list key is covered. Copy may use `backticks`; render them with `splitInlineCode`.
- **The gist format is shared too:** `@geld/core/gist-sync.ts` owns the file name (`geld-settings.json`), the `{ geld: 1, savedAt, settings }` payload (also what Export/Import uses), `settingsEqual`, and the read/find/write calls. The extension's `src/lib/gist-sync.ts` only re-exports it.
- Toolbar icon dark mode: Chrome/Edge use an offscreen `MATCH_MEDIA` document; Firefox uses `theme_icons`; Safari tints template icons. Icons are pixel-snapped renders of `assets/brand/geld-logomark.svg` (see git history for the generator approach; regenerate at 1/2/3 px per grid unit).

## Website (apps/site)

A small, fast marketing site for geld.sh, not a docs site. Run it with `pnpm --filter @geld/site dev` (or `pnpm dev:site`); `pnpm --filter @geld/site check` runs typecheck, lint, unit tests and a production build, and is part of root `pnpm check`.

- **Stack:** Next.js 16 App Router with `cacheComponents: true`, Tailwind CSS 4, shadcn components generated on **Base UI** (`components/ui/`), the `cn` package for class merging, Geist via the `geist` package, `lucide-react` icons. Everything is prerendered; the only cached-async piece is the latest-release lookup (`lib/release.ts`, `use cache`, revalidated hourly, falls back to the Releases page when there is no release yet). Light/dark follows `prefers-color-scheme` only; the white brand SVGs are served in dark mode through `<picture>` (`components/logo.tsx` references `assets/brand/` via `new URL(..., import.meta.url)`).
- **Pages:** `/` (hero, before/after PR header + hidden row built from `components/demo/sample-pr.ts`, which classifies its sample files with `createMatcher(DEFAULT_SETTINGS)` so the picture cannot lie; install buttons; live "try a path" demo in `components/path-tester.tsx`), `/how-it-works`, `/patterns` (rendered from `CATEGORIES`, never hand-written), `/faq`, `/privacy` (doubles as the store privacy policy). OG image and favicons are drawn from the brand SVGs at build time (`lib/brand.ts`).
- **Data that must stay in sync with the extension:** the version comes from `apps/extension/package.json` (`lib/version.ts`); patterns and categories from `@geld/core`; install links from the latest GitHub Release until store listings exist — set a URL in `STORE_URLS` (`lib/downloads.ts`) to switch a browser over. Author profile URLs live in `lib/site.ts` (`TODO(owner)` placeholders render nothing until filled).
- **Deployment:** Vercel, dreamthinkbuild account, Root Directory `apps/site`, domain geld.sh. `apps/site/vercel.json` points the Ignored Build Step at `scripts/vercel-ignore.sh`, which skips builds for commits that only touch the extension (core, the extension's `package.json`, brand assets and the lockfile do trigger builds).
- **No database, ever.** The only user data is the settings gist on the user's own GitHub account. The site may sign users in with the **same OAuth App** as the extension, using the web flow (the App's callback URL is `https://geld.sh/auth`; the extension's device flow never uses it): `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` live in Vercel env vars, the callback exchanges the code server-side, and the `gist`-scoped token is kept only in an encrypted, HttpOnly session cookie. `/settings` renders `sectionsFor('site')` from `@geld/core` and reads/writes the gist with `@geld/core/gist-sync`, so the extension and the site edit the same document. Those routes are necessarily dynamic; everything else stays prerendered.

## Verifying changes

There is no GitHub login available to automation here. Verify against public pages: `https://github.com/wxt-dev/wxt/pull/2544/files` (classic view, 6 test files), `https://github.com/wxt-dev/wxt/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef` (React view), `https://github.com/vitest-dev/vitest/pull/10554/files` (124 files, progressive loading), `https://github.com/wxt-dev/wxt/pulls` (PR list). Branded Chrome ignores `--load-extension`; install the built folder with Puppeteer's `browser.installExtension()` and `--enable-unsafe-extension-debugging`, and bring a tab to the front before interacting with it (background tabs stall element handles).
