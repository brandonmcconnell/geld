# Geld's signals in the hub

What the hub shows of a pull request beyond what its provider says, and where each number comes from.

## Lines left to review, on a list row

A pull request row first shows GitHub's totals. Once the row nears the viewport (`useInView`), `getPullSignals` reads the pull request's changed files, paths and line counts only, and classifies each with the matcher from `@geld/core`, the same one the extension uses. The row then shows the lines left to review and what was set aside, "+40 −12 2 tests", and the breakdown on hover: Essential, each category, Total.

- The categories are the reader's own (see "The reader's settings" below). A repository's `.github/geld.yml` is not read yet.
- A row whose pull request has nothing set aside keeps GitHub's totals.
- Only the first 2,000 files are read. Past that the breakdown says it counted the files it read.
- A deleted file and a rename with no edits are passed to the matcher as change kinds. The other kinds (binary, whitespace only, mode change) need the diff and are not known here.
- Rows from GitLab and Bitbucket keep their provider's totals.
- The stat is not shown on narrow screens, as GitHub's totals are not.

Nothing is stored on the server. The answer is kept in the browser's query cache for ten minutes, keyed by the pull request and when it last changed.

## The Digest, on a pull request

The pull request page shows a Digest between the description and the activity (`PullDigestSection`, `src/lib/geld/digest.ts`): how many review threads are resolved, one pill per review bot with what it said, one line per open thread, and the resolved ones behind a toggle. A line leads to the files view.

It is built in the browser by `buildMeta` from `@geld/review`, the code the extension and the Action build theirs with, from what the page already loaded: comments, review comments, each thread's resolved state, reviews and check runs. `digestInputFrom` turns those into the shape the Action reads from GitHub's API. Nothing is requested for it beyond the page's own reads, and nothing is stored.

- The section is absent when the pull request has no review threads and no review bot has spoken.
- The page loads comments a page at a time, so on a long conversation the Digest covers the comments loaded so far.
- A review's own words and the commit it reviewed are not loaded by the page, so a bot that reports only in a review body is read from its threads and its check alone.
- Whether a thread is outdated is not known here, so an outdated thread counts as open until it is resolved.
- There is no AI summary, previews row or reports row yet.

## Categories, in the files view

In the files view a file that falls in one of Geld's categories starts collapsed, as a deleted file does, and its header names the category in a dashed pill ("Tests"). Opening it is one click, and it is never removed from the list or the tree. The sidebar's foot says what is left: "2 to review +44 −17" and "1 test set aside" (`LeftToReview`, the same split a list row shows).

`fileCategory` (`src/lib/geld/file-category.ts`) decides by path with `@geld/core`'s matcher under the reader's settings, in the browser.

- Files set aside are not grouped at the end of the diff or the tree: the diff arrives as a stream and is shown in its order.
- Marking them viewed for the reader, which the extension can do, is not here.

## The reader's settings

The hub reads the reader's Geld settings from their account: `users.settings`, the document the dashboard saves and validates (`readGeldSettings`, `src/lib/geld/settings.server.ts`). Categories switched on or off there, pattern groups, extra patterns and custom categories all apply in the hub.

- On the server, `getPullSignals` builds its matcher from them, scoped to the repository, so `[owner/repo]` pattern sections apply to list rows.
- In the browser, the signed-in layout loads them once (`useLoadReaderSettings`, kept five minutes) and `setReaderSettings` puts them behind `fileCategory`. Until they arrive the defaults stand in.
- An account that never saved any gets the defaults. A saved value that is not valid Geld settings also gets the defaults (`ReaderSettings.invalid`), as on the dashboard. The hub does not say so on screen yet.
- The browser's matcher is not scoped to a repository, so `[owner/repo]` pattern sections do not apply in the files view yet.
- The hub only reads the settings. Changing them stays on the dashboard, the extension and geld.sh.
- Settings kept only in the extension or in the reader's gist are not seen here: only what the account holds.
