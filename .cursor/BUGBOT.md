# Review guidance for Geld

Geld is a browser extension (WXT, TypeScript strict, Chrome/Firefox/Edge/Safari) that hides test and
other noise files from GitHub pull request diffs, and a Next.js site at geld.sh. `AGENTS.md` at the
root is the authoritative description; this file lists what a reviewer must check.

## Blocking issues

- Any `any` (explicit or implicit), `ZodTypeAny`, or an `as X` cast outside the few commented interop
  shims. Prefer type guards and `unknown`.
- The content script moving, removing or re-parenting GitHub's own DOM nodes in the diff view. Hiding
  is done with CSS `order`, attributes and `hidden`; GitHub's React view breaks otherwise. The review
  digest is the one exception: it opens a conversation's timeline nodes (and pieces of them — a
  comment's picker, its ⋯ menu, the tooltip the picker names) inside its panel as *loans* through
  `review/teleport.ts`, each with a placeholder at home and `restoreAll()` before any rebuild. A new
  loan goes through `teleportInto`/`onRestore`; an ad-hoc `append` of a GitHub node is the problem.
- The content script fetching `.diff` files or `api.github.com` itself. Those go through the
  background worker (`entrypoints/background.ts`), which paces them under the diff host's burst limit
  (~45 requests, then 429 to everything for a minute); bypassing it gets users rate-limited. The
  page's *own* same-origin JSON is a different matter and is fetched from the content script on
  purpose, once per page or head, as the page itself does on navigation: the files-tab summaries
  (`/pull/N/changes?_json=1`), the Commits tab (`/pull/N/commits` with `Accept: application/json`),
  directory listings and raw files for `.github/geld.yml`.
- New or widened manifest permissions / host permissions. These disable the extension on update
  until every user re-approves.
- A pattern or category change anywhere other than `packages/core/src/categories.ts` and
  `packages/core/src/test-patterns.ts`. `catalog/patterns.json` and `patterns.sig` are generated and
  signed by CI; hand edits are wrong. Category and group ids are permanent: user settings refer to
  them. Removing or renaming one breaks settings; deprecate by emptying its patterns.
- Settings fields added without going through `packages/core/src/settings-schema.ts` (the popup,
  options page and website render from it) or without validation in `settings-validate.ts`.
- Anything that caches a failed or empty diff response as a result (sign-in pages parse as empty
  diffs; see `fetchDiff` and `diff-source.ts`).
- Secrets, tokens, or user identifiers in logs or diagnostics. The diagnostics log may name
  `owner/repo#N` and nothing more.

## Worth a comment

- A new GitHub markup dependency hard-coded in TypeScript when it belongs in the declarative catalog
  surfaces (`packages/core/src/list-surfaces.ts`), which ship without a store release.
- Hashed Primer class names (`Foo-module__bar__x1y2z`) used as selectors; prefer `data-*`,
  `aria-*`, `[class*="Foo-module__bar"]` or structural selectors.
- Work done on the `apply()` path that forces layout (`getBoundingClientRect`, `offsetHeight`) — it
  runs on every DOM mutation while large diffs stream in. Measurements belong in observers.
- Styles that do not follow GitHub's theme tokens (`--fgColor-*`, `--bgColor-*`, `--borderColor-*`)
  or ignore dark/high-contrast/colorblind themes.
- UI copy that is vague; it should be short and specific.
- Site changes using Radix, `clsx`/`tailwind-merge` or anything but shadcn on base-ui with the `cn`
  package; or introducing any database or server-side user data (there is none, by design).

## Testing expectations

- `pnpm check` (typecheck, tests, site build, catalog check) must pass.
- Pattern changes add cases to `packages/core/src/matcher.test.ts` (or the test file beside the module they touch).
- Changes to GitHub-facing behaviour say which GitHub surfaces were verified (PR files tab, PR list,
  commit page, stack popover, hovercard) and how.
