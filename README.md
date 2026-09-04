# Geld

Geld is a browser extension that hides test files from GitHub diffs so you can review the code that matters first. Tests are not deleted from the page; they are collected into a tidy, collapsible section at the bottom of the diff, removed from the file tree, and excluded from the line and file counts in the header. Hover the counts to see the full breakdown.

Built with [WXT](https://wxt.dev) and shipped for **Chrome, Edge, Firefox and Safari** from a single codebase.

## What it does

Anywhere GitHub shows a list of changed files (pull request _Files changed_ tab, commit pages, compare pages), Geld:

- **Hides diffs for test files** and moves them to the bottom of the list, behind a borderless _"17 test files hidden"_ row with a _Show test files_ toggle that matches GitHub's own collapse/expand affordances. Expanding reveals the tests in place, below the real changes.
- **Adjusts the header counts** (`+400 −120`, _Files changed 17_, _"18 files changed"_, compare-page summary) so they exclude tests. Hovering the counts shows a tooltip with three rows: excluding tests, including tests, and tests only.
- **Removes tests from the file tree** on the left, including directories that only contained tests, and adds a separate collapsed **Tests** section beneath it. It mirrors GitHub's own tree (same row geometry, collapsible folders, merged single-child directories, status icons) but sits outside the real tree so it cannot be mistaken for part of the change set. Clicking a file auto-expands the hidden diffs and jumps to it (even on large PRs where GitHub has not rendered it yet).
- **Works on the PR conversation tab too**: with no diffs on the page, Geld fetches the PR's raw `.diff` in the background to compute accurate counts.
- **Adds line counts to pull request lists** (`/pulls`, the global PR dashboard, search results): each PR row gets `+N −M` excluding tests, with the same hover breakdown. Diffs are fetched in the background, a few at a time, and cached for ten minutes. This can be turned off in the options.
- **Adapts to both GitHub UIs**: the long-standing server-rendered diff view and the newer React-based view (used on commit pages and the new _Files changed_ experience), in light and dark themes.

Geld can be toggled from the toolbar popup. The options page lets you add custom glob patterns (or `!negations` to rescue files), turn the built-in test detection off, and choose whether hidden files start expanded. Settings sync via `browser.storage.sync` and apply instantly to open tabs.

### What counts as a test?

Built-in patterns are grouped by kind so they can become individually switchable later: unit/integration tests (`*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`, `*Test.java`, `*_spec.rb`, ...), end-to-end tests (`*.e2e.*`, `*.cy.*`, `e2e/`, `cypress/`, `playwright/`, ...), test directories (`test/`, `tests/`, `__tests__/`, `spec/`, `__mocks__/`, `testdata/`, `*.Tests/`, ...), snapshots and recordings (`*.snap`, `__snapshots__/`, `*-snapshots/`, `cassettes/`, ...), and tooling (`jest.config.*`, `vitest.config.*`, `playwright.config.*`, `conftest.py`, `pytest.ini`, `phpunit.xml`, ...). See [`src/lib/test-patterns.ts`](src/lib/test-patterns.ts) for the full list.

Patterns use gitignore-style semantics: a pattern without a slash matches a filename at any depth, a trailing slash matches a directory at any depth, `**` spans directories and `{a,b}` expands alternatives. Only the paths are inspected, never file contents.

## Install for testing

1. Run `pnpm install` and `pnpm zip:all` (see below), or download the zip you need from the `.output/` directory of a build.
2. Install it:
   - **Chrome / Edge / other Chromium**: unzip `geld-<version>-chrome.zip` (or `-edge.zip`), open `chrome://extensions` (`edge://extensions`), enable _Developer mode_ and choose _Load unpacked_ pointing at the unzipped folder.
   - **Firefox**: open `about:debugging#/runtime/this-firefox`, choose _Load Temporary Add-on…_ and pick `geld-<version>-firefox.zip` (or the `manifest.json` inside the unzipped folder). For a permanent install the zip must be signed by AMO; `geld-<version>-sources.zip` is the source archive AMO asks for.
   - **Safari**: unzip `geld-<version>-safari.zip`, then on macOS run `xcrun safari-web-extension-converter <unzipped-folder>` and build/run the generated Xcode project. Enable _Allow unsigned extensions_ from Safari's _Develop_ menu while testing.
3. Open any pull request, for example <https://github.com/wxt-dev/wxt/pull/2544/files>.

## Development

```sh
pnpm install          # installs dependencies and generates WXT types
pnpm dev              # Chrome with hot reload (pnpm dev:firefox for Firefox)
pnpm check            # typecheck + unit tests
pnpm test             # unit tests only (Vitest)
pnpm build            # production build for Chrome into .output/chrome-mv3
pnpm build:all        # production builds for Chrome, Firefox, Edge and Safari
pnpm zip:all          # zips for all four browsers into .output/
```

Output archives:

```
.output/geld-<version>-chrome.zip
.output/geld-<version>-edge.zip
.output/geld-<version>-firefox.zip     (+ geld-<version>-sources.zip for AMO)
.output/geld-<version>-safari.zip      (convert with xcrun safari-web-extension-converter)
```

### Project layout

```
entrypoints/
  background.ts            fetches raw .diff files (needed for CORS) on request
  github.content/          content script + stylesheet injected on github.com
  popup/                   toolbar popup (enable, expand-by-default)
  options/                 custom patterns, built-in pattern reference
src/
  lib/                     framework-free logic: glob matcher, test patterns,
                           settings, unified-diff parser, formatting (unit tested)
  github/
    controller.ts          observes the page and applies/removes all changes
    views/legacy.ts        adapter for GitHub's server-rendered diff UI
    views/react.ts         adapter for GitHub's React diff UI
    header-stats.ts        rewrites header counts and attaches the tooltip
    pr-list.ts             "+N −M" chips on pull request list rows
    ui/                    hidden-files section, tree section, tooltip
```

### How the hiding works

Geld never moves GitHub's DOM nodes around (that would break the React view). Instead it turns the diff container into a flex column, gives hidden entries a higher `order`, and toggles their visibility with a data attribute. Header numbers are rewritten in place while the originals are remembered so everything can be restored when the extension is turned off. All work is idempotent and re-run from a debounced `MutationObserver`, which is what keeps it working through GitHub's client-side navigation and progressive loading of large diffs.

## Roadmap ideas

- Per-group toggles (hide only unit tests, only end-to-end tests, only snapshots).
- Additional categories beyond tests: generated files, lockfiles, vendored code, agent/tooling config.
- Per-repository overrides.

## License

MIT
