<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/geld-logo-white.svg" />
    <img src="assets/brand/geld-logo.svg" alt="Geld" width="292" height="75" />
  </picture>
</p>

Geld is a browser extension that hides test files from GitHub diffs so you can review the code that matters first. Tests are not deleted from the page; they are collected into a tidy, collapsible section at the bottom of the diff, removed from the file tree, and excluded from the line and file counts in the header. Hover the counts to see the full breakdown.

Built with [WXT](https://wxt.dev) and shipped for **Chrome, Edge, Firefox and Safari** from a single codebase. This repository is a small pnpm monorepo: the extension lives in `apps/extension`, the shared logic in `packages/core`, and the geld.sh website in `apps/site`.

## What it does

Anywhere GitHub shows a list of changed files (pull request _Files changed_ tab, commit pages, compare pages), Geld:

- **Hides diffs for test files** and moves them to the bottom of the list, behind a borderless _"17 test files hidden"_ row with a _Show test files_ toggle that matches GitHub's own collapse/expand affordances. Expanding reveals the tests in place, below the real changes.
- **Adjusts the header counts** (`+400 −120`, _Files changed 17_, _"18 files changed"_, compare-page summary) so they exclude tests, and prefixes them with a gray `N tests` label (always shown, even `0 tests`, so you know the numbers were checked). When tests are present, hovering shows a tooltip with three rows: excluding tests, including tests, and tests only.
- **Turns the file tree into a full-height accordion.** GitHub's own tree becomes a **Changes** panel, and each hidden category gets its own panel (Tests, Generated, Docs, ...) with a descriptive icon. One panel is open at a time and fills the sidebar with its own scrollbar, so every heading stays visible without scrolling to the bottom. Category panels mirror GitHub's tree (same row geometry, collapsible folders, merged single-child directories, status icons) but browsing them never changes the diff; clicking a file auto-expands the hidden diffs and jumps to it (even on large PRs where GitHub has not rendered it yet).
- **Works on the PR conversation tab too**: with no diffs on the page, Geld fetches the PR's raw `.diff` in the background to compute accurate counts.
- **Adds line counts to pull request lists** (`/pulls`, the global PR dashboard, search results): each PR row gets `+N −M` excluding tests, with the same hover breakdown. Diffs are fetched in the background, a few at a time, and cached for ten minutes. This can be turned off in the options.
- **Adapts to both GitHub UIs**: the long-standing server-rendered diff view and the newer React-based view (used on commit pages and the new _Files changed_ experience), in light and dark themes.

Geld can be toggled from the toolbar popup, which is contextual: it shows the current repository, how many files are hidden on the tab (with the list of paths), and one-click "turn off for this repo / org" actions. The toolbar icon carries the hidden-file count as a badge, and **Alt+Shift+T** shows or hides the hidden files on the current page for the rest of the visit without touching your settings (rebind it in your browser's extension-shortcut settings). All settings sync via `browser.storage.sync` and apply instantly to open tabs.

### What gets hidden

Files are grouped into **categories**, each with its own switch. **Tests** is on by default; the others are opt-in in the popup or options:

| Category | Examples |
| --- | --- |
| Tests | `*.test.*`, `*.spec.ts`, `*_test.go`, `test_*.py`, `*Test.java`, `e2e/`, `cypress/`, `__tests__/`, `*.snap`, `jest.config.*`, `conftest.py` — split into unit/integration, end-to-end, directories, snapshots and tooling sub-groups you can toggle individually |
| Generated | lockfiles (`pnpm-lock.yaml`, `Cargo.lock`, `go.sum`, ...), `*.generated.*`, `*.pb.go`, `*.min.js`, `*.map`, `__generated__/`, `dist/` |
| Vendored | `vendor/`, `node_modules/`, `third_party/`, `Pods/` |
| Agent config | `.cursor/`, `.cursorrules`, `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, `.windsurfrules`, `.github/copilot-instructions.md` |
| Docs | `*.md`, `docs/`, `CHANGELOG*`, `.changeset/`, `LICENSE*` |
| Tooling & CI | `.github/workflows/`, `Dockerfile*`, `.eslintrc*`, `prettier.config.*`, `tsconfig*.json`, `renovate.json`, `.editorconfig` |
| Stories, fixtures & i18n | `*.stories.*`, `__fixtures__/`, `locales/`, `*.po` |

With one category on, labels read `6 tests`; with several, `9 hidden` with the per-category split in the tooltip, chips in the bottom section (`6 tests · 2 generated · 1 doc`), and one collapsible section per category in the file tree. When every file on a page is hidden there is nothing left to review, so the hidden files start expanded.

Patterns use gitignore-style semantics: a pattern without a slash matches a filename at any depth, a trailing slash matches a directory at any depth, `**` spans directories, `{a,b}` expands alternatives, and `!pattern` rescues a path. Only paths are inspected, never contents. `*.spec.*` is restricted to code extensions because OpenAPI documents are commonly named `api.spec.yaml`.

Every category can be tuned beyond its switch: untick any of its **built-in pattern groups**, and add **extra patterns** of your own with the same syntax — `!pattern` there rescues a path from that category only, and `[owner/repo]` section headers scope the lines below them to matching repositories (`[*]` returns to global). You can also define **your own categories** (a name, an Octicon, patterns, optional count labels); they get a switch, their own panel and count, and are matched before the built-in ones. A **path tester** shows how any path would be treated and which pattern decided.

**Repository rules** decide where Geld runs, again like a `.gitignore`: `acme/widgets` turns Geld off in that repository, `acme` (or `acme/*`) in the whole org, `!acme/widgets` turns it back on, the last matching line wins, and `*` followed by `!acme/*` gives you an allowlist. The popup's quick actions append these rules for you.

### Other options

- **Hide whitespace changes** uses GitHub's own diff setting, never a Geld re-implementation. Geld first reads GitHub's persisted preference (`ignoreWhitespace` in the page payload, or the classic diff-settings form) and does nothing if it is already on. If it is off, it flips GitHub's setting the way you would — through the diff-settings menu on the React view or the "Apply and reload" form on the classic view — which GitHub remembers for signed-in users, so this happens once. Signed-out users get the `?w=1` URL instead.
- **Mark as viewed** in the bottom section ticks GitHub's "Viewed" checkbox on every hidden file, so review progress can reach 100% without opening them.
- **Line counts in PR lists**, **badge**, **shortcut** and **expanded by default** can each be switched off.
- **Export/import** your settings as JSON from the options page.
- **GitHub account sync (optional):** "Sign in with GitHub" (top right of the popup or options) uses GitHub's OAuth *device flow* — you confirm a short code on github.com; the only scope is `gist`. Settings are kept in a **secret gist on your own account** (`geld-settings.json`), so there is no Geld server or database and nobody else can read or change them; the token stays on the device that signed in. Changes push within a couple of seconds and pull when the popup/options open or the browser starts. Signing in on a second browser that already has different settings asks whether to keep that device's or use the account's. Requires a GitHub OAuth App client id with Device Flow enabled (set `WXT_GITHUB_CLIENT_ID` in `apps/extension/.env` at build time, or paste one in the options page).
- **GitHub Enterprise Server:** add your server's hostname in the options; the browser asks you to allow Geld on that host and the content script is registered there (Chrome/Edge/Safari via `scripting`, Firefox via `contentScripts`). GHES runs GitHub's UI a few versions behind, so if something looks off there please open an issue with a screenshot.

### Data & caching

Geld never calls the GitHub API. Counts come from the page when it renders per-file diffs; otherwise (PR conversation tab, PR lists, partially loaded large PRs) the background script fetches the same `.diff` you get by appending `.diff` to a PR URL. Parsed diffs are cached in extension storage keyed by the PR's head commit, so a PR you have already seen costs no request until it gets a new commit. List rows are only fetched when scrolled near the viewport, at most four at a time, and fetching pauses for a minute if GitHub ever answers 429.

## Install for testing

1. Run `pnpm install` and `pnpm zip:all` (see below), or download the zip you need from `apps/extension/.output/` (CI also attaches them to every run as the `geld-extension-zips` artifact).
2. Install it:
   - **Chrome / Edge / other Chromium**: unzip `geld-<version>-chrome.zip` (or `-edge.zip`), open `chrome://extensions` (`edge://extensions`), enable _Developer mode_ and choose _Load unpacked_ pointing at the unzipped folder.
   - **Firefox**: open `about:debugging#/runtime/this-firefox`, choose _Load Temporary Add-on…_ and pick `geld-<version>-firefox.zip` (or the `manifest.json` inside the unzipped folder). For a permanent install the zip must be signed by AMO; `geld-<version>-sources.zip` is the source archive AMO asks for.
   - **Safari** (16.4+): unzip `geld-<version>-safari.zip`, then on macOS run `xcrun safari-web-extension-converter <unzipped-folder>` and build/run the generated Xcode project. Enable _Allow unsigned extensions_ from Safari's _Develop_ menu while testing.
3. Open any pull request, for example <https://github.com/wxt-dev/wxt/pull/2544/files>.

## Development

```sh
pnpm install          # installs every workspace and generates WXT types
pnpm dev              # extension in Chrome with hot reload
pnpm check            # typecheck + unit tests for core and the extension, lint + build for the site
pnpm test             # unit tests only (Vitest)
pnpm dev:site         # geld.sh website (Next.js) on http://localhost:3000
pnpm build            # production build for Chrome into apps/extension/.output/chrome-mv3
pnpm build:all        # production builds for Chrome, Firefox, Edge and Safari
pnpm zip:all          # zips for all four browsers into apps/extension/.output/
```

Output archives:

```
apps/extension/.output/geld-<version>-chrome.zip
apps/extension/.output/geld-<version>-edge.zip
apps/extension/.output/geld-<version>-firefox.zip     (+ geld-<version>-sources.zip for AMO)
apps/extension/.output/geld-<version>-safari.zip      (convert with xcrun safari-web-extension-converter)
```

### Project layout

```
packages/core/             @geld/core: framework-free logic shared by the extension and the site —
                           glob matcher, categories & patterns, repo rules, settings, diff parser
                           (unit tested; consumed as TypeScript source)
apps/extension/            @geld/extension (WXT)
  entrypoints/
    background.ts          fetches raw .diff files, swaps the toolbar icon for dark mode,
                           registers Enterprise hosts, handles the keyboard shortcut and badge
    offscreen/             Chrome/Edge only: watches prefers-color-scheme for the background
    github.content/        content script + stylesheet injected on GitHub
    popup/                 contextual toolbar popup
    options/               categories (groups, extra patterns), custom categories, repo rules, Enterprise hosts, tester, backup
  src/github/
    controller.ts          observes the page and applies/removes all changes
    views/legacy.ts        adapter for GitHub's classic diff UI
    views/react.ts         adapter for GitHub's React diff UI
    header-stats.ts        rewrites header counts and attaches the tooltip
    pr-list.ts             "+N −M" chips on pull request list rows
    diff-cache.ts          commit-keyed on-disk cache of parsed diffs
    whitespace-viewed.ts   GitHub's hide-whitespace setting and "Viewed" controls
    ui/                    hidden-files row, sidebar accordion sections, tooltip
apps/site/                 geld.sh (Next.js on Vercel): home with a live path tester, how it works,
                           patterns rendered from @geld/core, FAQ, privacy policy
assets/brand/              logo + logomark SVGs (black and white variants)
```

See `AGENTS.md` for conventions and the reasoning behind the architecture.

### Toolbar icon and dark mode

The toolbar mark is pure black on light toolbars and pure white on dark ones. Chrome and Edge (MV3) cannot call `matchMedia` from the service worker, so a tiny offscreen document (`reasons: ["MATCH_MEDIA"]`) reports the colour scheme and the background calls `action.setIcon`. Firefox switches natively via `theme_icons`, and Safari tints toolbar icons as template images on its own.

### How the hiding works

Geld never moves GitHub's DOM nodes around (that would break the React view). Instead it turns the diff container into a flex column, gives hidden entries a higher `order`, and toggles their visibility with a data attribute. Header numbers are rewritten in place while the originals are remembered so everything can be restored when the extension is turned off. All work is idempotent and re-run from a debounced `MutationObserver`, which is what keeps it working through GitHub's client-side navigation and progressive loading of large diffs.

## Roadmap ideas

- A repo-committed config (e.g. `.github/geld.yml`) so teams can share patterns.

## License

MIT
