# Geld — guide for agents and contributors

Geld is a browser extension that hides test files (and, optionally, other review noise) from GitHub diffs. This repository is a pnpm monorepo that also hosts the marketing site for geld.sh. Read this file before changing anything; it captures decisions that are not obvious from the code.

## Layout

```
packages/core/       @geld/core — pure TypeScript, no browser APIs. Glob matcher, hidden-file
                     categories & patterns, repository rules, settings model, unified-diff parser,
                     number formatting. Unit tested with Vitest. Consumed as TS source via
                     package.json "exports" (no build step).
apps/extension/      @geld/extension — the WXT extension (Chrome, Edge, Firefox, Safari).
apps/site/           @geld/site — Next.js site for geld.sh (planned; see "Website" below).
assets/brand/        Logo + logomark SVGs (black and white variants). Both apps reference these.
.github/workflows/   CI: `pnpm check` (typecheck + tests everywhere) and `pnpm zip:all` artifacts.
```

Commands (root): `pnpm check`, `pnpm test`, `pnpm build`, `pnpm zip:all` (zips for all four browsers into `apps/extension/.output/`), `pnpm dev`.

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
- GitHub sign-in is the OAuth **device flow** (`src/lib/github-auth.ts`, no secret, no server); settings sync to a secret gist (`src/lib/gist-sync.ts`) orchestrated by `src/lib/account-service.ts` in the background. Client id comes from `WXT_GITHUB_CLIENT_ID` (`.env`) or the options override; tokens live in `storage.local` only.
- Toolbar icon dark mode: Chrome/Edge use an offscreen `MATCH_MEDIA` document; Firefox uses `theme_icons`; Safari tints template icons. Icons are pixel-snapped renders of `assets/brand/geld-logomark.svg` (see git history for the generator approach; regenerate at 1/2/3 px per grid unit).

## Website (apps/site) — intent

A small, fast marketing site, not a docs site: home (hero, screenshots, install buttons per browser), how it works, patterns (rendered **from `@geld/core`'s `CATEGORIES`**, never hand-written), a live "try a path" demo using `createMatcher` from core, FAQ, privacy (Geld collects nothing; this page doubles as the store privacy policy), links to the owner's profiles. Download buttons read the latest GitHub Release until store listings exist. Configure `transpilePackages: ['@geld/core']` in Next so the TS-source package builds. Settings sync already works from the extension alone (device flow + secret gist), so the site needs no auth endpoint.

## Verifying changes

There is no GitHub login available to automation here. Verify against public pages: `https://github.com/wxt-dev/wxt/pull/2544/files` (classic view, 6 test files), `https://github.com/wxt-dev/wxt/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef` (React view), `https://github.com/vitest-dev/vitest/pull/10554/files` (124 files, progressive loading), `https://github.com/wxt-dev/wxt/pulls` (PR list). Branded Chrome ignores `--load-extension`; install the built folder with Puppeteer's `browser.installExtension()` and `--enable-unsafe-extension-debugging`, and bring a tab to the front before interacting with it (background tabs stall element handles).
