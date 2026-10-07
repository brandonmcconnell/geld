# Idea: a map of what a pull request, or its stack, touches

Status: parked (Oct 2026). No code change yet. Written to be carried out without further input: every open question has a default. Companion idea: `review-tab.md` (the same inputs read as steps). Working name **Scope** (the surface shows the pull request's footprint on the repository). "Diagram" was considered and set aside: it names the drawing, not what the reader learns from it.

## What

A view that shows *where in the repository* a pull request lands: the repository's tree with the touched files lit, coloured by Geld's category (essential, tests, fixtures, generated, docs, the user's own), with everything untouched drawn faint for bearings. Hover or tap a node and it says what happened there (counts, status, which commits, which review threads, which step of the review plan when one exists). Switch from **this pull request** to **the stack** and the lit area becomes the union of every pull request in the stack, each in its own tint, or a slider that walks the stack in order and shows the footprint grow. Toggle categories on and off to see only the essential work, only the tests, only what a given category touched.

No AI. The map is deterministic, built from data Geld already fetches, and the explanation layer, when wanted, is the review plan's steps drawn over it.

## Why

- A pull request's size is not its reach. Fifty files in one directory and five files across five packages are different reviews, and the file list shows them the same way.
- Stacks are read one PR at a time, and nothing on GitHub shows the stack's combined footprint.
- Geld already classifies every file. Seeing the categories *spatially* (the tests live over here, the generated output over there, the essential change is these three leaves) is the picture the categories were always implying.
- Geld's hovercards and commit tooltips already explain other commits' diffs. The map is the same breakdown, drawn once for the whole change.

## Why not yet

- A graph library is a real dependency in an extension that is hand-built DOM and CSS today, and it has to be small, React-free and render inside GitHub's page without fighting its styles.
- The stack's membership is read from GitHub's DOM (the stack popover and merge-box list that the list surfaces already target), not from an API, so the stack view depends on markup Geld does not own.
- It is unclear whether it earns a tab or a drawer. The default below is the drawer, with the tab as a promotion once the filters and stack views prove used.

## The shape of it

```
┌ Scope: mintlify/mint#12402 ─────────────────────────── [This PR ▾ | Stack 3/4]  ✕ ┐
│                                                                                     │
│  Essential ■  Tests ■  Fixtures □  Generated ■  Docs □      Imports ─  Owners ⌂     │
│                                                                                     │
│  ┌ apps/ ──────────────────────────┐ ┌ packages/ ───────────────┐ ┌ .github/ ─┐    │
│  │ ┌ dashboard/ ────────────────┐  │ │ ┌ core/ ─────┐ ┌ ui/ ──┐ │ │ workflows │    │
│  │ │ ┌ src/ ──────────────────┐ │  │ │ │ ■ parse.ts │ │ ░░░░░ │ │ │   ■ ci.yml│    │
│  │ │ │ ■ search.ts  ■ Search  │ │  │ │ │ ■ parse.t… │ │ ░░░░░ │ │ └───────────┘    │
│  │ │ │ ■ search.css ░ list.ts │ │  │ │ └────────────┘ └───────┘ │                  │
│  │ │ │ ░░░░░░░░░░░░░░░░░░░░░░ │ │  │ └──────────────────────────┘                  │
│  │ │ └────────────────────────┘ │  │                                                │
│  │ │  ■ __tests__/search.test  │  │  ┌ Hover: apps/dashboard/src/search.ts ──────┐ │
│  │ └────────────────────────────┘  │  │ Essential · +84 −12 · 2 commits          │ │
│  └─────────────────────────────────┘  │ Step 2 of the review: Debounce the search │ │
│                                       │ 1 open thread · owned by @web-team        │ │
│   ■ touched   ░ untouched (12 files)  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

The layout is a **zoomable icicle / treemap of the directory tree**, not a node-and-edge graph: directories nest visually, size is the number of changed lines (or files, a toggle), and no edge routing is needed for the main picture. Import edges between touched files are an overlay (`Imports`), drawn as curves over the treemap only when toggled, so the common case stays legible.

## How it works, in order

### 1. Where it opens

Default: a **drawer** over the page, opened from two places that already exist: a "Scope" control in the Geld row of the review panel on the conversation tab (next to the sparkle), and a "Scope" entry in the hidden-files row on Files changed. The drawer takes the viewport's width, keeps the page beneath (`position: fixed`, `inert` on the page while open, Escape closes, focus returns). State in the URL as `#geld-scope` so it can be linked and survives a reload.

Promotion to a **tab** (`/pull/N/files?geld=scope`, the same hosting trick as the Review tab) is a later decision, taken if readers keep the drawer open while scrolling the diff, which a drawer cannot do. The code is written so the drawer's body is a component that mounts in either host.

### 2. Inputs, all already fetched or one request away

- **The PR's files and counts**: `DiffSource` (`FileStats` per path with `status`, `additions`, `deletions`, `kinds`), cached per head SHA.
- **Categories**: `matcherFor(repo).categorizeFile(stats)` for every file, honouring the user's settings and the repository's config, so the map agrees with the header and the hidden-files row.
- **The repository tree around the touched files**: GitHub's directory listing, `/{owner}/{repo}/tree/{ref}/{dir}?noancestors=1` with `Accept: application/json` (already used by `RepoConfigSource.readFile` to avoid 404s, memoised per directory). The map lists each touched file's ancestors and their immediate children, so the faint untouched siblings are real and counted, without walking the whole repository. Ref is the head SHA. Deeper untouched directories show as a single faint cell with a child count and expand on click (one more listing).
- **Commits per file**: for the per-node "2 commits" line, `/pull/N/commits` parsed once, and each commit's `.diff` through `DiffSource` on hover only (the commit hovercard's cache).
- **Review threads per file**: the digest's `ReviewItem`s with `path`.
- **The review plan**, when `local:reviewPlans` holds one for this head: step id per hunk gives each file its step title(s).
- **CODEOWNERS** (`Owners` overlay): `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` through the same listing-then-raw path as `geld.yml`, parsed with the gitignore-style matcher Geld already has for repo rules, so each cell can name its owners and the overlay can shade by owner.
- **Import edges** (`Imports` overlay): from `parseUnifiedDiffHunks` (added for the Review tab) over the `+` lines of touched files, a per-language regex for `import … from`, `require(`, `from … import`, `#include`, Go `import` blocks, resolved against the set of touched paths only (relative paths and the obvious alias roots `@/`, `~/`, `src/`). Edges between touched files only. Unresolved imports are not drawn. No bundler, no AI.

### 3. The stack

- **Membership**: the stack popover (`[class*="StackState"]`) and the merge box's stack list (`[class*="StackList"]`) are already catalog list surfaces, and their rows carry the PR numbers and the order. Read the order from whichever is in the page (the popover has to be opened by the reader once, the list is in the merge box when present). When neither is in the page the Stack switch is disabled with "Open the Stack popover once to read the stack" as its title. The App API (`base`/`head` chain) is a later, cleaner source, gated on the account being connected, and must not be required.
- **Diffs**: each stack member's `.diff` through `DiffSource`, keyed `latest` for the others since their head SHAs are not in the page (the same stale-while-revalidate the list chips use), paced by the worker's budget. A stack of ten is ten fetches, within budget, with rows filling in as they land.
- **Views**: *Union* (every member's files, each cell split into tints when more than one member touched it, with a legend of PR numbers), *Walk* (a slider over the stack order, the footprint accumulating, the current member's files bright and earlier ones dim), *This PR* (the default).
- Categories apply across the stack, computed per member's repository (a stack is one repository).

### 4. Rendering

- **Layout**: `d3-hierarchy` (treemap and partition layouts, ~10 kB, no DOM, no React) over the tree built in 2, rendered as plain DOM cells (`div`s absolutely positioned inside a container) so the extension's CSS tokens, hover cards and keyboard handling apply unchanged. Cells are keyed by path so a re-layout after a toggle animates with a CSS transition on `transform`, nothing more.
- **Zoom**: click a directory cell to make it the root (breadcrumb at the top), click the breadcrumb to go up. No free pan and zoom in the first cut.
- **Edges**: a single `<svg>` overlay above the cells, one `<path>` per import edge between visible cells, recomputed on layout. Hidden when the overlay is off.
- **Why not React Flow**: it is React, and the extension has none. Pulling React in for one surface doubles the content script and brings a second rendering model into a codebase that is deliberately one. If a node-and-edge view is wanted later (a dependency graph of touched modules as the main picture rather than an overlay), the React-free options are `elkjs` or `dagre` for layout with the same DOM-cell rendering, and that is the path, not React Flow.
- **Hover card**: the review panel's hover card machinery (`hovercard.ts`, provider pattern) with a new provider for map cells: path, category, counts, status, commits, step, threads, owners, and "Open in Files changed" (`reveal`) and "Open in Review" (when a plan exists) as actions.
- **Accessibility**: cells are buttons in a `tree` role with `aria-level`, arrow-key navigation along the tree, the hover card's content available as the cell's description, and a text alternative: a "List" toggle that renders the same data as a nested list.

### 5. Settings, gating

- `scopeMap` (toggle, section Files or a new section Review shared with the Review tab, default off while new): shows the Scope controls.
- No AI involved, so no model setting. The step layer appears only when a plan exists.
- Enterprise hosts work the same; the tree listing and raw paths are same-origin there.

### 6. Phasing

1. Drawer from the hidden-files row and the Geld row, this PR only, treemap of touched files plus their ancestors and siblings, category colours and toggles, hover card with counts and status, "Open in Files changed". `d3-hierarchy` added.
2. Zoom with breadcrumb, size-by toggle (lines / files), the List alternative, keyboard.
3. Stack: membership from the DOM surfaces, Union and Walk views, legend.
4. Overlays: Owners (CODEOWNERS), Imports (regex edges, SVG overlay).
5. Commits and threads per cell on hover, the review plan's step layer.
6. Tab promotion if warranted, AGENTS.md.

Verification in the headed harness against `vitest-dev/vitest#10554` (many directories), a small single-directory PR, and a public stacked PR (find one through the Stack popover on a repository that uses stacks, or build a two-PR stack in a scratch repository).

## Decisions taken here (change them if you know better)

- **Treemap first, graph later.** Containment is the picture people want for "where does this land"; edges are the overlay.
- **Drawer first, tab later**, measured by whether readers want the map beside the diff rather than over it.
- **No AI in the map.** Explanations come from the Review tab's plan when one exists. The map stays free and instant.
- **No GitHub API.** Tree listings, raw files and `.diff` from the page origin, the stack from the page's own markup. The App can improve the stack source later, never gate it.
- **Agrees with the header.** Every number and category on the map comes from the same `FileStats` and matcher the header counts use.

## Open questions (defaults in parentheses)

- Does the map belong on commit and compare pages too? (Yes for commits, later: same inputs, no stack. Compare: later.)
- Should the Walk view also show *time* (commits across the stack) or only stack order? (Stack order only.)
- Should untouched siblings be fetched eagerly for every touched directory, or on hover? (Eagerly for the touched files' own directories, lazily below that.)
- Colour by category (default) or by stack member when in the stack view? (Category by default, member tint as the Union view's split, a "Colour by PR" toggle in the stack view.)
- Size by changed lines or by files? (Lines, with the toggle.)
- Where does the step layer draw: as a cell border colour or as a grouping? (A small step number badge on the cell, and hovering a step in the legend highlights its cells.)

## Where the pieces live today

`apps/extension/src/github/diff-source.ts` and `diff-cache.ts` (per-SHA and `latest` diffs), `controller.ts` (`matcherFor`, `classify`, `reveal`), `repo-config-source.ts` (directory listing and raw-file path, the no-404 rule), `review/hovercard.ts` (providers), `review/panel.ts` (the Geld row), `ui/hidden-section.ts` (the hidden-files row), `review/commit-hover.ts` and `diffstat-surfaces.ts` (commit diffs on demand); `packages/core/src/list-surfaces.ts` (`stack-popover`, `stack-list`), `diff-parse.ts` (`FileStats`), `repo-rules.ts` (gitignore-style matching to reuse for CODEOWNERS), `categories.ts`; `packages/review/src/model.ts` (`ReviewItem.path`).
