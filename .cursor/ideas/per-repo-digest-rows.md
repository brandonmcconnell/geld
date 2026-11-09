# Idea: choose per repository which deployments, previews and reports the digest shows

Status: parked (Nov 2026). The Deployments row shipped showing every environment; nothing here is built.

## What

Asked for in geld#398: on a pull request that deploys to a dozen environments ("storybook-app-charts", "storybook-app-cs-butler", …), name the few the reader cares about and keep the rest behind an "N more" pill.
The same choice fits the Previews and Reports rows, so it would be one per-repository rule set rather than a Deployments setting: for each row, an allow list or a block list of names (environments, preview projects, reporters).

## Why it might be worth it

- Monorepos deploy one environment per package, and the row then wraps over several lines with the one the reader opens every time somewhere in the middle.
- The names are stable per repository, so a list written once keeps working on every pull request.

## Why not yet

- Settings today have no per-repository list of this shape.
  The closest are `repoRules` (on or off per repository), the `[owner/repo]` scope headers in file pattern lists (`resolveCustomPatterns`), and `hiddenAuthors`, which is global.
  A new kind of setting means schema, validation, both settings surfaces and gist sync.
- The dashboard (`apps/dashboard`) is where per-repository and per-team preferences are likely to live, and a shape chosen now in the extension's settings may not survive it.
- A repository's `.github/geld.yml` could carry a team default instead, which is a different decision (who chooses: the reader or the repository).

## If we do it

- One rule set per repository, keyed by row: `deployments`, `previews`, `reports`, each `{ show: string[] }` or `{ hide: string[] }` with `*` wildcards, matched case-insensitively like `hiddenAuthors`.
- Rows show the matched pills first and fold the rest into one "N more" pill that opens the row.
- Decide whether `.github/geld.yml` may set the default and the reader's rules layer over it, as categories do.

## Where the rows live today

`apps/extension/src/github/review/deployments.ts` (reading GitHub's deployment events), `deploymentsRow`, `previewsRow` and `reportsRow` in `apps/extension/src/github/review/panel.ts`.
