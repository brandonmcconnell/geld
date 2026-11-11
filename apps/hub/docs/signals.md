# Geld's signals in the hub

What the hub shows of a pull request beyond what its provider says, and where each number comes from.

## Lines left to review, on a list row

A pull request row first shows GitHub's totals. Once the row nears the viewport (`useInView`), `getPullSignals` reads the pull request's changed files, paths and line counts only, and classifies each with the matcher from `@geld/core`, the same one the extension uses. The row then shows the lines left to review and what was set aside, "+40 −12 2 tests", and the breakdown on hover: Essential, each category, Total.

- The categories are Geld's defaults, so tests today (`DEFAULT_SETTINGS`). The reader's own settings and a repository's `.github/geld.yml` are not read yet.
- A row whose pull request has nothing set aside keeps GitHub's totals.
- Only the first 2,000 files are read. Past that the breakdown says it counted the files it read.
- A deleted file and a rename with no edits are passed to the matcher as change kinds. The other kinds (binary, whitespace only, mode change) need the diff and are not known here.
- Rows from GitLab and Bitbucket keep their provider's totals.
- The stat is not shown on narrow screens, as GitHub's totals are not.

Nothing is stored on the server. The answer is kept in the browser's query cache for ten minutes, keyed by the pull request and when it last changed.
