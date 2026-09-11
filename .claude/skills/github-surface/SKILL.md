---
name: github-surface
description: Fix or add Geld's support for a GitHub UI when its markup changed or a new place shows PR rows or diffstats (PR lists, stack popover, commit hovercards). Use when someone pastes GitHub HTML and says chips, counts or author hiding stopped showing somewhere, or asks to cover a new spot.
---

# Adapting Geld to a GitHub UI surface

Geld rewrites diff numbers in three kinds of place:

1. **The page's own header and diff** (PR files/conversation, commit, compare): code in `apps/extension/src/github/header-stats.ts` and the view adapters `views/legacy.ts`, `views/react.ts`.
2. **PR lists** (`/pulls`, dashboard, search, the stacked-PR popover): **catalog data**, `listSurfaces` in `packages/core/src/list-surfaces.ts` (`BUNDLED_LIST_SURFACES`), applied by `apps/extension/src/github/list-surfaces.ts`, `pr-list.ts`, `pr-authors.ts`.
3. **Diffstats for another commit/PR** (commit hovercard): **catalog data**, `diffstatSurfaces` in the same core file (`BUNDLED_DIFFSTAT_SURFACES`), applied by `apps/extension/src/github/diffstat-surfaces.ts`.

Kinds 2 and 3 are headless: a change to the spec ships as a signed catalog publish that installed extensions pick up within six hours, no store release. Kind 1 and any new *behaviour* need code and a release.

## 1. Rule out a stale install first

Most "the selector changed again" reports are a browser still on an older build. Compare the pasted HTML with the current spec hooks before editing anything, and check what the stores serve (Chrome: `curl -sL https://chromewebstore.google.com/detail/geld/nfbkhldmnfgeeldfafojajnfanikbhia | grep -oE 'Version</div><div class="[^"]+">[^<]+'`; the publish run logs say what was submitted). If the hooks are unchanged and the store is behind the fix, say so: nothing to change.

## 2. Diff the pasted HTML against the spec

For each hook the relevant spec uses, find it in the paste:

- List row: `row` (`closest()` from the title link), `notInside`.
- Chip: `chipAnchors[].selector` + `placement` (`after` a metadata line / `append` into a block description).
- Author: `authors[]` (`label` = "opened by X" / "Filter by author X" in title or aria-label; `href` = `author:X` / `author:app/X`; `text`).
- Diffstat: `root`, `subject` (root attribute or a link's href containing `/owner/repo/commit/<sha>` or `/pull/<n>`), `host`, `additions`, `deletions`, `srOnly`.
- Title links must match `PULL_PATH` in `apps/extension/src/github/pr-list.ts` (`/owner/repo/pull/N` with an optional tab suffix such as `/changes`, `/files`). A link shape that regex rejects is a **code** fix.

Only use stable hooks: `data-testid`, `data-component`, `role`, id fragments (`li[id*="-list-view-node-"]`), and CSS-module *prefixes* via `[class*="Description-module__container"]`. Never the hashed suffix (`…-2BhU2`); Primer rotates those between deploys.

## 3. Decide: catalog or code

| Change | Where | Ships as |
|---|---|---|
| Selector moved, new hook, chip belongs elsewhere, author written elsewhere, chip CSS | the spec in `packages/core/src/list-surfaces.ts` | catalog publish (headless) |
| A brand-new list UI or hovercard of the same shape | a new spec entry (new `id`) | catalog publish |
| New placement kind, new author source kind, link path shape, page-header/diff adapters | code | release |

When a surface is similar to an existing one (same row shape, only the container differs) extend the existing entry (`row` may hold a selector list; `notInside` excludes) rather than adding a new id.

## 4. Verify with a fixture

Build a minimal HTML fixture from the paste (rows, title links, description line, author link; strip SVG paths), serve it *as* a github.com URL through Puppeteer request interception so the content script runs, load the built extension (`pnpm --filter @geld/extension build`, `.output/chrome-mv3`, `browser.installExtension`), wait ~5 s for diffs to arrive, then assert: rows and chips carry `data-geld-surface="<id>"`, chip text is `• N tests +A −D`, author hiding folds the expected rows (seed `hiddenAuthors: ['*[bot]']` in `chrome.storage.sync`). For a catalog-only change also prove the headless path: seed `chrome.storage.local.catalog = { version: current+1, fetchedAt, json }` with the edited spec and check the *unmodified* build picks it up. For hovercards, insert the popover markup pointed at a real commit SHA.

## 5. Land

- Branch `cursor/<name>-<suffix>` off `main`, one commit, then fast-forward `main` (`git merge --ff-only`, push). No PR unless asked.
- Catalog changes: run `pnpm catalog:build --auto-version`; CI signs and commits `catalog/patterns.{json,sig}` (`catalog: publish patterns <version> [skip ci]`). The local signature test fails until then; that is expected.
- Code changes ride the twice-daily store publish (05:17 / 17:17 UTC). Put `[publish]` in the commit message only for an urgent release.
- Record a new surface id or a new kind in `AGENTS.md`; the per-surface CSS lives in the spec's `css`, not in `github.content/style.css`.
