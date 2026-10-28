# Geld — guide for agents and contributors

Geld is a browser extension that hides test files (and, optionally, other review noise) from GitHub diffs.
This repository is a pnpm monorepo that also hosts the marketing site for geld.sh.
Read this file before changing anything;
it captures decisions that are not obvious from the code.

## Layout

```
packages/core/       @geld/core — pure TypeScript, no browser APIs. Glob matcher, hidden-file
                     categories & patterns, repository rules, settings model, unified-diff parser,
                     number formatting. Unit tested with Vitest. Consumed as TS source via
                     package.json "exports" (no build step).
packages/review/     @geld/review — pure TypeScript, no browser/Node APIs. PR summary payload
                     (GeldPrMeta), clustering, bot registry, comment render/parse, optional
                     OpenAI-compatible client. Shared by the Action and the extension.
packages/github/     @geld/github — pure TypeScript, no browser APIs. Geld GitHub App user
                     authorization (device flow, web flow, token-refresh coordinator, revoke) and,
                     to come, the API clients behind the dashboard. Packaged like core.
apps/extension/      @geld/extension — the WXT extension (Chrome, Edge, Firefox, Safari).
apps/action/         @geld/action — GitHub Action that upserts one review-summary comment per PR
                     (`pull_request_target`, GraphQL, never checks out PR code). `dist/` is a
                     committed esbuild bundle; Actions require built JS.
apps/site/           @geld/site — Next.js site for geld.sh (see "Website" below).
assets/brand/        Logo + logomark SVGs (black and white variants). Both apps reference these.
.github/workflows/   CI: `pnpm check` (typecheck + tests everywhere), `pnpm catalog:check` (generated
                     catalog and its signature are current) and `pnpm zip:all` artifacts.
catalog/             patterns.json + patterns.sig: the signed pattern catalog installed extensions
                     fetch. Generated from core — never edit by hand (see "pattern catalog" below).
scripts/             catalog-build.ts (generate/check), catalog-sign.mjs, catalog-keygen.mjs.
.cursor/plans/       Plan documents for larger pieces of work.
.cursor/ideas/       Parked ideas, one file each (status, why, why not yet, how), so a thought not acted
                     on now is easy to find later. Current: a Security row beside Reports; a person's
                     top-level comment that is waiting on the reader (needs-reply items for comments);
                     a Review tab that walks a PR in AI-planned steps with an assistant beside it;
                     a Scope map of what a PR or its stack touches in the repository.
```

Store publishing (`.github/workflows/publish.yml`) runs after every CI release on `main`, every six hours and on demand: it submits the latest release to Chrome, Edge, Firefox and Safari, skipping a store that already has that version or has a submission under review (Chrome/Edge cannot cancel reviews via API;
Apple can and the Safari job withdraws a waiting submission).
The pattern catalog is signed and committed by CI on push (`GELD_CATALOG_PRIVATE_KEY` to sign, `CATALOG_DEPLOY_KEY` — a write deploy key — to push, with "Deploy keys" on the ruleset bypass list).
Zips built by CI carry a four-part version (`package.json` version + run number, via `GELD_BUILD_NUMBER` in `wxt.config.ts`), so no bump commit is needed between store releases.
Credentials and listing assets: `apps/extension/store/PUBLISHING.md`.
\n\n
Releases: every push to `main` that touches the extension (apps/extension, apps/action, packages/core, packages/review, assets/brand, the lockfile, or the workflow) publishes a GitHub Release from CI, tagged `v{version}-build.{run}` with one zip per browser plus `-sources.zip` for Firefox review, auto-generated notes (editable afterwards) and marked latest;
the site's install buttons read `/releases/latest`.
Bump `apps/extension/package.json` `version` for a new version number;
the build number keeps tags unique.
`workflow_dispatch` forces a release.
\n\n
Commands (root): `pnpm check` (typecheck + tests for core and the extension, lint + production build of the site, and `catalog:check`), `pnpm test`, `pnpm build`, `pnpm zip:all` (zips for all four browsers into `apps/extension/.output/`), `pnpm dev` (extension;
it does **not** launch a browser — load `apps/extension/.output/chrome-mv3-dev` once with "Load unpacked" in your own Chrome, or `firefox-mv2-dev` via about:debugging, and WXT rebuilds and reloads it on change;
a git-ignored `apps/extension/web-ext.config.ts` with `disabled: false` brings the launcher back per developer), `pnpm dev:site`.

## Conventions

- **License: AGPL-3.0-only** (`LICENSE`, every `package.json`, the site's footer/FAQ/install copy): works built on Geld's code stay under the AGPL, with the corresponding source owed in the cases the license names — to recipients of a distributed copy, and (§13) to users who interact with a *modified* version over a network.
  That is the goal;
  the license text, not this line, defines the triggers.
  Known wart: Apple's App Store terms and the GPL family sit uneasily (Safari ships through the App Store);
  as sole copyright holder the owner can distribute that build regardless, and an explicit App Store exception is a possible follow-up.
  Do not add a non-OSI license or a Commons-Clause-style rider.
- TypeScript strict everywhere.
  **Never use `any`**, explicitly or implicitly, and never `ZodTypeAny`.
  Prefer type guards and `unknown` over casts;
  the codebase has no `as X` casts outside a couple of well-commented interop shims.
  Keep it that way.
- Extension imports shared logic only from `@geld/core` (never `../../packages/core/...`).
  Anything that could be reused by the site belongs in core;
  anything touching `browser.*`, the DOM or WXT stays in the extension.
- UI copy is short and specific, with no em or en dashes and no semicolons (a plain sentence break, a comma or a middle dot instead);
  commit messages explain *why*.
- **Code comments are the exception, not the habit.**
  Most code should carry none: a comment that only restates what the line plainly does (`// centre on the line`, `// pull in from the gap`) is noise and is not wanted.
  A comment earns its place only when the code cannot speak for itself — genuinely subtle or ambiguous logic, something load-bearing or sensitive where a wrong change would break non-obvious behaviour, a *why* the reader could not infer (a GitHub quirk worked around, an ordering that matters), or a note tying code that must stay in step with code elsewhere (mirrored constants, a shape shared across packages).
  Keep it to a single line;
  reserve a longer, several-line comment for those same situations when one line truly cannot carry it.
  When in doubt, leave it out and let the names and structure explain. (The existing long design notes in this file and the occasional dense block comment in the content script are the load-bearing kind and stay.)
- **This file (and `.cursor/BUGBOT.md`) is written one sentence per line**, a clause after a `;` on a line of its own too, each new line indented to its bullet's content.
  Git merges by line: written as one line per bullet, bullets ran to tens of kilobytes and two pull requests touching different sentences of one bullet always conflicted.
  A line break inside a paragraph renders as a space, so the page reads the same.
  Add a sentence as a new line rather than onto the end of an existing one, and change a sentence in place.
  `pnpm docs:lines` splits whatever shares a line (`scripts/doc-lines.ts`, run as `docs:lines:check` in `pnpm check`).
  A pull request still written the old way meets this layout in one conflict: take its own side of the file, run `pnpm docs:lines`, and re-add anything `main` changed meanwhile.
  Write literal triple backticks in prose as a code span (`` ```geld ``): two bare runs pair up as one code span across everything between them.
- Website stack (fixed by the owner): latest stable Next.js (App Router, static generation;
  Cache Components/PPR for any dynamic bits), Tailwind, **shadcn on base-ui (not Radix)**, the **`cn` package** for class merging (not `clsx`, `tailwind-merge` or `cnfast`).
  Deployed on Vercel under the **dreamthinkbuild** account to **geld.sh** (canonical `www.geld.sh`, apex redirects).

## How the extension works (short)

- `apps/extension/entrypoints/github.content/` runs on github.com (and user-added GitHub Enterprise hosts).
  `src/github/controller.ts` is the brain: a debounced `MutationObserver` re-runs an idempotent `apply()` that classifies each diff entry with `@geld/core`'s matcher, hides matches with **CSS flex `order` + attributes** (GitHub's DOM is never moved — the React view breaks otherwise), rewrites header counts, renders the bottom "N files hidden" row, and turns the file-tree sidebar into a full-height accordion ("Essential" — GitHub's own tree, what is left to review — + one panel per hidden category).
- **Category panels lead each file with the icon GitHub's tree shows for it**, never the plain `file` octicon: `file-added` (success), `file-removed` (danger), `file-moved` (attention), `file-diff` (muted) for an edit.
  The React tree's leading visual is cloned per item (`TreeFileNode.statusIcon`);
  where the view shows none (classic tree, files GitHub has not rendered) `tree-section.ts` `fileVisual` draws it from `FileStats.status` (`added`/`deleted`/`renamed`/`modified`, parsed from `new file mode` / `deleted file mode` / `rename from` in `diff-parse.ts`;
  absent in older cache entries → modified).
  Colours come from Primer's `fgColor-*` utilities on the svg.
  The row's trailing marks come with the file (`TreeFileNode.trailingVisual`, cloned): the comment count and the one check-annotation icon GitHub draws there, warning (`octicon-alert`, `fgColor-attention`), notice (`octicon-info`) or failure (`octicon-x-circle-fill`, `fgColor-danger`), so a file that leaves GitHub's tree for a category panel keeps the same icon, colour and size.
  Folders are `file-directory-open-fill` when expanded and `file-directory-fill` when collapsed (`setDirVisual` swaps them on toggle), as GitHub's are.
  GitHub's PR tree keys its icons on the change alone — it has no per-file-type icons there (those belong to the repository code tree), so neither do we.
- **PR conversation digest** (`src/github/review/`, `@geld/review`).
  On the conversation tab the extension looks for one comment by `github-actions[bot]` (or `geld[bot]`) carrying the machine payload in **an empty `<span title='geld:…'>` inside the footer line** (`PAYLOAD_ATTR_PREFIX`, `encodePayloadAttribute`/`PAYLOAD_CARRIER_SELECTOR` in `summary-parse.ts`).
  GitHub strips HTML comments from the rendered page, so `<!-- -->` cannot carry it;
  a fenced `` ```geld `` block (what older summaries used — still read, never written) showed everyone without the extension a collapsed "Geld data" dump.
  GitHub's sanitizer keeps `title` on a `span`, an empty inline has no size and so no tooltip, and the footer's own paragraph takes it with no new line: invisible to every reader, in the DOM for the extension (`getAttribute('title')` hands back the decoded JSON).
  Written single-quoted so JSON's double quotes cost nothing (`&`, `'`, `<`, `>` become entities;
  double-quoted, a 40 KB payload grew past the 65,536-character comment cap) and `truncateMeta` budgets the encoded size;
  verified against GitHub's `/markdown` API — the attribute round-trips byte for byte, including quotes, angle brackets, backticks, `@`/`#` sequences.
  Author + schema + "anchors must exist in the DOM" is the trust boundary;
  a forged payload is ignored.
  The Action applies the same author gate when it looks for the comment to update (`findSummaryComment(comments, [tokenLogin])`: `github-actions[bot]`, the Geld Apps, or whatever login the token answers `GET /user` with — the workflow token answers 403 there and writes as `github-actions[bot]`): a participant posting the marker or heading cannot make the Action PATCH a comment it does not own and fail instead of publishing.
  Fresh `headSha` → render the panel from the payload (zero crawl).
  Stale/partial/missing → crawler fallback with the same layout, "Updating…" when a summary exists but is behind.
  **The panel (`review/panel.ts`, `.geld-review`) grows out of the bottom of the description card**: inserted right after the card (`[data-geld-attached]` squares its bottom corners, the panel's top ones are square too, `margin-top: -1px` shares the border), so the two read as one box.
  Inside it borrows the merge box's checks list: a summary strip (progress meter, needs-reply chip, copy), then **the status rows** (`statusRows`, in triage order: *Reviews*, *Review bots*, *Reports*, *CI checks*, *Previews*;
  each only when it has something to say — *Review bots*: one outlined pill per bot with the page's icon, name, detail and a traffic-light glyph via `botHealth` (5/5 or clean → green check, 3–4/5 or findings → yellow dot, 1–2/5, high severity or failed → red X); **the row opens** (`BOTS_KEY`, `renderBotsList`) to one line per bot (`botLine`, `PanelModel.botLines` from `buildBotLines`): the verdict's light, the bot's mark, name and `botDetail`, its **latest run summary's** first line (`botSummaryFor(bot, NaN)`: the comment or review body its chip opens), a "N threads" pill, time, the comment's ⋯ and a chevron;
  open (`openSubKey` = the summary's anchor) the summary stands under it as a one-bubble chat with Rerun / View on the byline and **the run's threads as chips at its foot** (the threads whose source, read as a thread's pinned strip reads it — the review holding the thread, else `botSummaryFor` at the thread's time — is that summary), each leading to its row in its round (`onOpenAnchor`).
  A bot with threads but no summary points at its first thread;
  one with neither is a plain line.
  **A bot's latest summary is seated here, not in its round** (`botLineAnchors`, set before `buildBatches`;
  `seatFor` answers `{ BOTS_KEY, sub }` for it, so the chip, a permalink, "See latest" and a reaction all open this line;
  `openRow` takes the sub for list keys): earlier summaries stay in their rounds as that push's history, and the latest still *bounds* its round (`Round.seatedElsewhere`: content for `hasContent`, a round's start and its identity, shown nowhere in it — a push, a clean summary, a push are two rounds as before;
  a round left with neither push nor anything to show is dropped).
  The chips under a summary are read per thread source, not per item (an item can merge several of one bot's threads, from one run or several).
  **The line is remembered** (`botLineMemo`): a summary on loan to the panel (its line open, or pinned in a thread) is crawled bodiless at home, `summary` reads false and the bot's latest fell back to the run before, which changed the line's anchor and dropped the open key;
  a bot's latest word only gets newer while the comment stands, so the last line read whole is kept (anchor, words, threads — their state refreshed) while its comment is in the document and nothing newer has been read.
  Clicking a chip opens the bot's line **where the reader is** (`onOpenAnchor`);
  the row's Request a review menu (`requestMenu`) re-runs one bot or all, with an in-menu confirm, posting one comment per bot in sequence — its control wears the **send glyph** (`ICON_PAPER_AIRPLANE`) while idle, since it is an action that posts, not a ⋯ of choices, and the spinning sync while a review runs. *CI checks*: the merge box's checks section is located **by its own headings** ("1 in progress check", "8 successful checks" — the nearest ancestor holding all of them), not by container markup, which differs between the Rails and React merge boxes;
  its counts (`checkCountsFrom`) sit behind a GitHub-style status ring, and **in compact mode the section is folded out of the merge box** (it joins the fold targets under the key `checks`, not shown as a fold row) and shown in the CI row's slot when opened.
  The section and its original parent are remembered (`checksSectionEl`, `mergeHomeEl`) so counts and the review-requirement text keep reading correctly while the section is away — otherwise the row vanished and flip-flopped.
  Re-running failing checks needs the checks page or an App, so there is no action for it. *Reviews*: `requiredReviewsFrom` ("At least 2 approving reviews are required", "1 approval") as `1/2 approvals`.
  Only registered review bots, or logins in `reviewBots`, get a verdict (`reviewBotIdFor`);
  other `[bot]` accounts — deploy previews, CI — fold but never appear as reviewers), the TL;DR, then a collapsible heading per group ("2 open items ⌄", "1 done item" — collapsed by default — "5 hidden activities") and one line per row: status icon, poster avatar read from the page (round for people, 4px-radius for bots), bold ellipsized title, muted `path · authors · N comments`, a badge pill, and on the right eye (view here) / reply / ⋯ (Resolve or Mark done, Show in timeline, Copy link).
  **Items are review threads only** (`isReviewItemComment`): top-level comments and review bodies cannot be resolved on GitHub, so a "done" there would come straight back on reload;
  they stay in the timeline, or fold when they are a bot's run summary or a **review request** (`isTriggerComment`: "@greptileai", "bugbot run", "/devin review" — every registered trigger plus the generic "@handle verb" shape, one per line or several in a row with only whitespace/punctuation between;
  folded silently — no row, not counted — since the bots' answers are in their rounds and the re-run control posts new ones).
  **"Request a review" (the ⋯ menu on the Review bots row — the glyph turns into the spinning ⟳ while a bot runs — `requestMenu` in panel.ts) is a checklist of every registry bot** (`requestableBots` in panel-model.ts): each line has a checkbox, the bot's mark (the page's picture when it has one, else GitHub's for the App: `avatars.githubusercontent.com/in/<appId>` from the registry's `appId`, read from `GET /users/<login>`;
  `/<login>` serves an identicon for App logins) and what its last run on this PR said (`botRunState`: Failed, Findings, Passed, Running, Earlier commit, Not run, in the chip's colours;
  failed and stale runs start ticked so the usual case is open, glance, Run).
  **How a run asked for ends** (`verdictsFrom`, `@geld/review/bots.ts`): a trigger comment ("@greptileai", "bugbot run" — a person's, or another bot's: Cursor's agents post as `cursor[bot]`, Bugbot's login, and still ask Greptile;
  a bot never asks itself) or the bot's own "Starting…" line puts the bot at `running` until it speaks — a new summary comment, review threads, or its check run's conclusion — and after `STATUS_LINE_STALE_MS` (45 min) of silence with no check to go by the run reads `failed`.
  **A run nobody asked for in the thread** (the repository's CI, the bot's own site) posts nothing until it is done: its check run is the only sign, so a bot whose check is `in_progress`/`queued` on the head is `running` whatever its earlier comments say (they are the run before;
  the chip keeps the latest summary to open).
  The merge box draws a running check with Primer's spinner, not an octicon — `crawlCheckRuns` reads the state from the row's leading visual (spinner = in progress), never from the first `svg.octicon` in the row, which for a running check is its ⋯ menu.
  **The merge box is not the only reading of the checks** (`check-source.ts`): GitHub's React merge box renders the check rows only once the reader expands the section, and a merged or closed pull request has no merge box, so a bot that ran from CI and posted nothing read "Not run" over its green check (mintlify/server#9377, Bugbot).
  `headChecks` fetches the commit's status partial — `/{owner}/{repo}/commit/{head}/status-details?popover=true`, what the commit list's status popover loads, same origin with the session cookie (private repositories work;
  Enterprise is the page's host) — parses it with the same `crawlCheckRuns` (classic `.merge-status-item` rows;
  the description is loose text beside the name there, and the Details link is preferred over the App's avatar link, which comes first in the row), and `mergeCheckRuns` lets the page's live rows win by name (they alone show a running check's start, which `run-starts.ts` records).
  The partial is read per head, again when the merge box's words change (GitHub's status poll re-renders the box, the observer makes a pass), on a 20 s clock while a bot's check is running (`reapplyAt`) and a 5 min one otherwise, and at once when the tab comes back after 15 s or more away (`expireHeadChecks`: timers in a hidden tab ran late or not at all while bots may have finished, and the chip kept reading running);
  a failed read keeps the last reading.
  The same list feeds `reportsFromChecks`.
  **A check's conclusion is read in the bot's words** (`ReviewBot.neutralConclusion`, `notCheckNames`): Bugbot documents `success` = nothing found, `neutral` = findings (its default;
  `failure` only when configured to fail on unresolved findings), and a separate `Cursor Bugbot Autofix` check that is not the review — so Bugbot's neutral is `findings` with no count until its threads say one, the Autofix row matches no bot, `skipped` is a refused run (`failed` with reason "Check skipped"), and `action_required`/`stale` fail like `timed_out`.
  **Bugbot's neutral is findings only from a Bugbot that has posted them**: it posts every finding as a review thread, and it also concludes neutral when it skips a commit whose patch matches its last review ("Bugbot skipped this commit because its changes match the last review", completed in a second, mint#13635), which read "findings" with nothing to open;
  with no Bugbot thread on the whole timeline the neutral is that last review standing, `clean`, and only once every thread has been read (`VerdictOptions.complete`: the Action always, the extension with no "Load more" left and every deferred fragment read, its fetched markup standing in the page (`fragmentRead`: a failed fetch is unread, and a thread keeps its fragment after its replies load, so "none left" would never hold);
  `postedThreads` in `verdictsFrom`), the check's own verdict corrected whatever comment the record came from.
  CodeRabbit's check is neutral on completion and says nothing about the code.
  A run a person started on the bot's own site may post no check at all;
  its review is then read from the comments when it lands, as always.
  Claude Code Review's check never concludes failure and reports through the same path.
  **How a run from CI ends** is told by the run's *start*: the merge box shows a running check's `Started <relative-time>` and nothing of the kind once it has finished, so `run-starts.ts` records each bot check's start while it runs (in memory and `local:reviewRunStarts`, per PR, head and check, dropped on the next head and after a day) and gives it back, with the first-seen finish, once the row has completed — but only to the *same run*: the row's details link names the run (`check_run_id=…`, `actions/runs/…/job/…`) and a check re-run on the same head while the tab was hidden (passes are deferred) must not inherit the run before's times;
  an unnamed row is trusted for ten minutes after its finish (`RawCheckRun.startedAt` / `completedAt`;
  the Action fills both from the API's `startedAt`/`completedAt`, and passes `lastEditedAt` as `editedAt`).
  `verdictsFrom` then judges a finished check against its start: the bot's report is a word newer than the start that *votes* (a review-shaped summary posted or rewritten, a thread, a refusal — not a "Starting" line, not a coding agent's conversational reply);
  with none yet the chip keeps *running* for `REPORT_GRACE_MS` (90 s;
  `reapplyAt` schedules the pass when the grace ends) and after that the check's conclusion alone is the verdict, with no count or score — the whole verdict for a bot that reports through CI and never posts.
  Such a verdict carries `runJudged`;
  a check whose start nobody saw (page opened after the finish, Action not yet re-run) cannot be judged and the comments decide as before, unmarked.
  **A commit status has one moment, and it counts like a start** (`checkIsThisRun` in `verdictsFrom`): the Action passes a `StatusContext`'s `createdAt` as `completedAt` (as `startedAt` while pending), and a check with no start known is placed by its finish, so a status set before the run the thread announced is the earlier run's and one set after it is that run's answer.
  A check with no times at all is still taken as the run's: Devin's status on the page carries none, flips to pending as its run starts and back to green with no comment when it finds nothing (mint#12256, re-reviewed on request: "Starting Devin Review.", a green status reading "Completed analysis in 1m 2s" a minute later, no review posted), so an undated green check after a "Starting" line is that clean run, not the run before's.
  So the chip never shows the summary of the run before as this run's result.
  The Action's summary is written at one moment, so even a `fresh` payload takes what runs *now* from the page (`withLiveRuns`, meta-source.ts): a bot the page sees running replaces or joins the payload's;
  a run the payload saw running is ended by the page only with a `runJudged` verdict;
  what became of a run's findings is the page's too once the whole timeline is read (`complete`: nothing ingesting, no "Load more") — a payload `findings` takes the page's count when the page counts fewer open (none: "resolved", the green check), never more, the score and severity staying;
  every other verdict stays the Action's.
  The Action reads review threads into `verdictsFrom` as well (`build.ts`, `resolved` per thread, a review's body before its threads), so its own verdicts weigh open threads like the page does.
  **A request never answered on a merged or closed pull request is no verdict** (`VerdictOptions.closed`, from the header's state label — `pullRequestClosed`): GitHub shows none of a closed pull request's checks, so the run may well have passed as a check the reader can no longer see;
  the bot reads `unknown` ("no word": grey dot, a dashed chip with nothing to open, "No word" in the request menu) rather than `failed`.
  **The bot's own status line that aged with no report reads `unknown` too** (`statusOnly` keeps `own`): CodeRabbit leaves "Currently processing new changes…" standing when it then decides not to review, and nothing on the page says the run failed (geld#57 showed it red);
  a *person's* request the bot never answered is no word either (mint#12998: six `bugbot run` on a *draft*, which Bugbot skips by default, no comment, no check among 62, read red), **unless the bot acknowledged the request** (`statusOnly.acknowledged`: Greptile's 👀 on it) and then never reported — it said it had taken the run, so that silence is the run's `failed`;
  a bare `failed` otherwise comes only from a check that concluded badly, and `skipped` from a refusal.
  The hovercard's "no word" line adds why when the page's state label reads Draft (`pullRequestDraft`).
  The Action never needs it — it reads checks from the API;
  a bot the payload does not list joins from the page with `unknown` as it does with `running` (`withLiveRuns`), since a request posted after the Action wrote is on the page alone.
  **A request the bot never answered leaves the earlier run standing whole**: on a stale status line with no check, the thread run the request set aside (`runsBeforeAsk`) is weighed again, so one resolved thread reads "resolved", not the summary's count from before it was (mint#12803, a "bugbot run" Bugbot ignored).
  **Greptile's summary says what it found by its "Findings" section** (`parseBotBody`): the comment headed "Confidence Score: N/5" lists its findings under a "Findings" heading, one bold title per item ("1. **…** ▶" raw, a bold line per list item as the page reads it), so a summary with no such section found nothing and is `clean` with its score, whatever its risk sentence says ("appears safe to merge", "no blocking issue remains" — the wording varies run to run;
  mint#12992 read as findings and pre-ticked Greptile in the request menu over a 5/5 with nothing to rerun for);
  the section's items are the count, and a section whose items cannot be read leaves the count unknown rather than claiming a clean run.
  Open threads still outrank a clean summary (`threadRuns`).
  The other bots' clean and refused words were surveyed on public pull requests at the same time (Oct 2026) and `parseBotBody` / `refusalReason` read them: HTML comments go before any words are weighed (Cursor's automation markers lead its reviews);
  up to two qualifiers stand between a count and its noun ("1 new potential issue", Devin), and a number that is a reference (`#9377`, `GH-123`) is never a count — "I checked both #9377 findings" read as 9,377 issues on server#9385 until the threads settled;
  "Didn't find any major issues" (Codex), "Verdict: approve" and a leading "Approved" (Cursor's automations under the Bugbot login) are clean, and "Verdict: request changes" is a stated verdict (`changes-requested`); **Bugbot is `conversational` too**, since the same `cursor[bot]` login is Cursor's cloud agents', which reply in other bots' threads and address them ("@greptileai Both P1 findings are addressed… Please re-review" read as Bugbot's findings over its own clean review, mint#13111) — its own summaries are always review-shaped, so nothing of Bugbot's is lost;
  a notice headed by its reason over a long explanation — "Bugbot couldn't run - usage limit reached", "Bugbot needs on-demand usage enabled" (an `<h3>`, read with its tags off) — and "usage limits have been reached" (Codex) are refusals;
  and **Devin is `conversational`** like Replicas, since under the same login it narrates the pull requests it opens ("I'll fix CI failures…", "Tested commit … in a browser…") — only a review-shaped comment votes, and Devin Review's always are.
  **Nine more bots joined the registry in Oct 2026** (`REVIEW_BOTS`;
  surveyed from recent public pull requests by login with `/tmp`-style scripts, their docs read the same day): **Claude Code Review** (`claude[bot]`, `@claude review`/`always`/`once`, check "Claude Code Review", `REVIEW.md` — `CLAUDE.md` is every Claude Code user's file and says nothing about Code Review;
  conversational, since the login is also Claude Code's Action and "PR Steward", which narrate;
  reacts 👀), **cubic** (`cubic-dev-ai[bot]`, `@cubic-dev-ai review this PR`, `cubic.yaml`, reacts 👀), **Sourcery** (`sourcery-ai[bot]`, `@sourcery-ai review`, check "Sourcery review" — skipped on a rate limit or its five-re-review cap), **Qodo** (`qodo-code-review[bot]` and its Qodo Merge / PR-Agent logins, `/agentic_review`, `.pr_agent.toml`), **Amazon Q Developer** (`/q review`), **Ellipsis** (`.ellipsis/code-review.yaml`, push-driven), **Macroscope** (`@macroscope-app review`), **Korbit** (`/korbit-review`) and **Entelligence** (`@entelligence review`). cubic, Sourcery, Qodo, Macroscope and Entelligence are `conversational`: each posts comments that are not verdicts (cubic's "Auto-fix isn't included in your plan", Sourcery's "Reviewer's Guide", Qodo's "PR Summary"/"PR Code Suggestions"/"Qodo Fixer", Macroscope's empty review bodies, Entelligence's "Walkthrough" and "Findings outside the diff"), so only a review-shaped one votes.
  **Their words** (`parseBotBody`, `countShapedBy`, `isStatusLineComment`, `refusalReason`): a count of findings is findings whatever else the summary says ("1 existing issue remains and no new issues found", cubic — the generic clean words no longer win over a count);
  clean is also "Nothing blocking." (Claude), "No blocking defects were found" / "The PR is ready to merge" (Amazon Q), "they look great" (Sourcery), "All reported issues were addressed" (cubic), "Looks good to me!" (Ellipsis), and a verdict word after its label through the bold marks — "**Verdict:** Approved at `sha`" / "Would Approve" (Macroscope), "Sourcery assessment **Approved.**", "Review complete — approved (0 P1, 0 P2, 2 P3)" (Claude) — while "Needs a human reviewer" / "Needs Human Approval" is never clean and is a stated verdict (`ParsedBotBody.verdict`, `isReviewShaped` — the one conversational gate, in `verdictsFrom` and the overview), so a conversational bot's "needs a human" counts as its review though it has no count or score;
  "ready to merge" is clean only when no "not"/"isn't"/"until"/"before" stands within three words before it;
  counts in a bot's own shape are Claude's P1 + P2 (P3 are nits), cubic's existing + new, Qodo's pills ("🐞 Bugs (0) 📘 Rule violations (0)…", summed;
  its summaries carry no N/5 score), Korbit's issue table minus "✅ Fix detected" rows (a row is a line ending its title in "▹ view", raw or as the page reads a `tr`), and Entelligence's "**Issues found:**" list plus "…plus N more" under its scorecard (one bold-led item per line, bullets or not, blank lines between as the page reads `li`s), whose "Merge Confidence" N/5 is the score (a scorecard with "nothing to flag" is clean);
  status lines are Qodo's `<h3>Qodo is busy working</h3>` (tags off first) and Claude's "Reviewing PR #N" checklist;
  refusals are Claude's fork notice and "Code review skipped: … usage limit", "Claude encountered an error" and "Macroscope skipped reviewing this pull request" (a bot naming itself in a heading over a long explanation, read before the length cap, the job link after the dash dropped), Sourcery's "you've used your own review budget" and "larger than the review limit", Qodo's "reviews are paused because…", Korbit's "I don't review pull requests opened by bots", Entelligence's "Automatic Review Skipped …".
  Trigger matching keeps underscores inside a word (`/agentic_review`;
  `plainTrigger`).
  A title that is a plain lowercase word ("cubic") never names the bot in a refusal — only its login stem does (`botNamedIn`, the subject regex) — "budget" is not a money word (Sourcery's notice addresses the reader: "you've used your own review budget"), a sentence that reports a count or what was found is never a status line ("Reviewing PR #396 revealed 2 bugs"), "ready to merge" takes no condition after it either ("after the failing check is fixed"), and a negated "does not need human approval" is no verdict.
  Not added: Graphite's app posts only size checks on public PRs, Jules is a coding agent, not a reviewer.
  **CodeRabbit speaks the other way round** (`parseBotBody`, `isStatusLineComment`): its clean word is "No actionable comments were generated in the recent review", each review body counts "Actionable comments posted: N" (0 is clean), and the summary comment it posts first — "Currently processing new changes in this PR…" as a note over its run configuration, later edited in place into the verdict — is a status line although the comment is long: when a comment is too long to be one, its first sentence is still tested, and must be that line whole ("Currently processing (new) changes in this PR"), not merely begin with it.
  **A run the bot gave up on ends there, whatever its check still says** (`refusalReason`, `refusedAt` in `verdictsFrom`): merged mid-run, CodeRabbit rewrites that summary into "Review failed · The pull request is closed" (a caution alert over the last walkthrough, which still holds "No actionable comments…" and read as clean) and leaves its commit status "pending · Review in progress" for good, so the chip said running long after the merge (geld#103).
  The notice is a refusal with the sentence under the heading as its reason, and a running check gives way to a refusal that is the bot's latest word and newer than the check's start;
  a commit status carries no start, and then only a merged or closed pull request (`VerdictOptions.closed`), where no new run can begin, lets the refusal end it, since on an open one an old refusal must not end a run that may be new.
  As with any refusal, the last real review stands (#103: "resolved", its one finding resolved), and a bot that never reviewed reads skipped with the reason.
  The verdict a refusal ends a run with carries `runJudged`, so a summary the Action wrote while the check still ran (saying running) gives way to it in `withLiveRuns`, which replaces a saved running verdict only with a judged one.
  An earlier review standing in such a run is not of the refused check's commit, whose record it inherited, and the comments do not say which it is, so its `reviewedSha` is `UNKNOWN_SHA` (all zeros, which no head matches): it reads as behind rather than as a review of the head.
  **CodeRabbit's answer to a command is not a review** (`commandReply`): `@coderabbitai review` gets "✅ Action performed" in a disclosure, edited in place from "Review triggered." (a status line, the run under way) to "Review finished." (with "does not re-review already reviewed commits" when there was nothing new).
  **CodeRabbit is `conversational`**: "@coderabbitai" anywhere starts a chat, and its replies ("The current code addresses the finding… No further change is needed") vote nothing, where they used to read as a summary inheriting the last review's count (geld#94);
  its reviews always carry a count in its own shape or its clean word ("No actionable comments were generated"), and only those count or read clean for it: a chat reply's "No issues found", "0 issues remain", "5/5" or "Verdict: …" does not, since CodeRabbit scores nothing and states no verdict in words (`parseBotBody`).
  **Its count is its inline comments plus the ones outside the diff** (`countShapedBy`): "Actionable comments posted: N" counts only what it could post as threads, "Outside diff range comments (N)" come on top, and a review can hold nothing else.
  They have no thread to resolve, so they stand when the review's inline threads are resolved (`ParsedBotBody.unthreaded`, carried by the run its threads build): the chip reads findings, opening the review, until CodeRabbit reviews again.
  **An undated skipped check does not end a run the bot says it began**: after CodeRabbit's own "Review triggered" (that command reply only, kept through the run's later status lines, `statusOnly.triggered`: another bot's "Starting…" over a skip may be the skip itself), the skip still on its check row is the run before's (a skip is a run not made, and whose it is does not change when the run goes stale;
  an earlier review or run of threads standing over a skip is not of the skipped commit, so it carries `UNKNOWN_SHA` and reads as behind, and a skip never turns resolved threads or a clean review into failed, dated by the Action or not), so the chip reads running until the check or a comment says how this run went, where it read failed (geld#94);
  a person's request answered only by a skipped check is still the skip.
  A request on a commit it has already reviewed gets "⚠️ Action not completed · Already reviewed the last commit" instead, which is the same answer with no review (`done`), so it no longer reads as a summary inheriting a resolved finding's count (geld#114 said "CodeRabbit 1 issue").
  The finished reply answers the request and votes nothing, so the run the request set aside stands whole, its threads included, and it is never the bot's summary in the panel (`sourceFacts`);
  read as an uncounted summary it inherited the count of a finding long resolved and the chip said "1 issue" (geld#68).
  The check that request started (dated by the Action) closes green with nothing new, so the answer is kept apart from votes (`answeredBy`: when asked, when last written) and a finished check begun after the request and before the answer's rewrite (the run's finish;
  with the rewrite not yet known, within `REPORT_GRACE_MS` of its first posting, since the bot posts the answer moments before it starts the check), with no vote from the bot since, leaves the restored run standing rather than turning it "clean" once the grace ends, open findings and all;
  a check begun later is a newer run, judged as any other.
  The same test (`ranForAnswer`) holds for a check still under way, with a known start: it is set aside before anything reads it, so the restored run stands while it closes rather than the chip reading running until it does.
  A bot with no run to restore (no summary, review or threads: a first request) is left with no word (`afterAnswer`, `unknown`, opening the reply), not the check's "clean" or "running", which would claim a review the reply says did not happen.
  Answered requests are settled last, after every pass that could rebuild a bot's record, and marked judged so an Action summary saved while the check ran gives way in `withLiveRuns`: the check is the answered run when its known start falls in the answer's window, or, with no start (the Action dates a commit status by its finish alone), when it finished between the request and `REPORT_GRACE_MS` after the answer, and with no time at all only when it is green (the false "clean" is what this undoes;
  a failure is never hidden behind an old reply).
  **The request menu says "Findings" for a bot whose last run had findings, resolved or not, and pre-ticks it only when that run came before the latest push** (`botRunState`, `PanelModel.ranSincePush`): the chip wears the green check once the threads are resolved, but a bot that has not reported since the push has not seen the fixes, while one whose verdict comes from something posted or rewritten after it (its seated summary, a thread, CodeRabbit marking a thread addressed) has reviewed this commit and would say the same again;
  a comment posted is placed by where it stands, never by its time (a round's start can be a commit's date, earlier than the push): in the push's round, or after its commit row in the timeline, since a thread merged into an item seated at an older thread is still after the push;
  only a rewrite in place is read by when it was made, and the bot's latest summary (its Review bots line) counts as well as its verdict's source.
  The latest push is the last round a push opened (`buildBatches` records its anchors and `startOf` time in `latestPush`), since a verdict read from the page carries the head as its `reviewedSha` whatever commit it reviewed;
  with no push on the page the head check decides alone, and a failed run and one on an earlier commit stay ticked.
  Greptile reports a re-run by *editing its existing summary in place* ("Reviews (2)", a new confidence score) and posts nothing new, so `BotComment.editedAt` counts too: a bot summary edited after the ask is the report, with the verdict its words now say.
  The extension reads that time from GitHub's edit-history log (`edit-times.ts`: the header's `details-menu[src*="show_edit_history_log"]`, first `relative-time` = most recent edit), asked for only on a bot's summary posted before a run that is still waiting on that bot (`runsAskedFor`), once a minute while that is so, never otherwise.
  Seen on mint#12546: `@greptileai` at 21:46 and 21:54, the summary edited 21:57 from 4/5 to 5/5, no new comment — without the edit the chip would have said running until 22:31.
  **The rewrite is also the bot's latest word over an older thread run** (`RERUN_EDIT_GAP_MS`, 5 min): with every thread resolved and the summary edited more than that after the run's last thread, the chip shows the summary's verdict and opens the summary, not "resolved" at the last thread — a bot posts threads and its summary's touch-up within seconds, so a rewrite minutes later is a later run with nothing new (geld#31: threads at 17:22, "5/5" edited in at 17:29).
  An open thread still outranks it, and so do resolved threads over a rewrite whose words gave no count (`rewriteSpeaks`): a summary the parser cannot count says less than the threads do, so every one resolved reads "resolved", not amber "findings" (mint#13111);
  counted means by that summary's own words (`countedSummaries`), since a later uncounted summary inherits the earlier one's number through `withOptionalCount` but not its reading.
  **Copilot's overview** (`ccr-overview-v2`, Oct 2026) heads with a verdict ("Approval recommended", "Changes recommended", "Needs a closer look") and counts "**N open finding(s)**", edited as they are resolved down to "**0 open findings**" or "**No open issues** 🎉" — `open` is one of the words allowed between "no" and the noun, which is what made that last one read as findings with no count;
  its quota notice ("Copilot was unable to review this pull request because … quota limit") is a refusal.
  The extension therefore asks the edit log for every review bot's summary the page marks as edited (the rounds ask for the same comments to seat an edited summary in the round of its edit).
  **A bot that acknowledges a trigger says so with a reaction** (`ReviewBot.acknowledges: 'reaction'`, Greptile's 👍 on the trigger comment, verified Oct 2026): the crawl reads each comment's reactors from GitHub's reaction tooltips ("greptile-apps[bot] reacted with thumbs up emoji", `reactorsOf` → `RawComment.reactedBy` → `BotComment.reactedBy`), and a trigger for such a bot that it has not reacted to after `ACK_GRACE_MS` (3 min) was never picked up — it does not start a run, the earlier verdict stands and the reader can ask again (mint#12546's first `@greptileai` got no reaction and no review for half an hour;
  the second was reacted to within seconds).
  Bots that start silently keep the 45-minute rule.
  **A bot that refuses to run is a `failed` verdict with its reason** (`refusalReason` in `bots.ts`: "Skipping Bugbot: Bugbot is disabled for this repository", "not enabled for this repo", "no credits remaining", "could not access the repository", "permission denied" — a sentence or two, shaped like a refusal;
  "Skipping the test suite…" in a review is not one): the run that was asked for did not happen, so the request stops reading as *running*;
  but **the chip shows the bot's last real run**: a review the bot made earlier (a summary comment, or the threads a request had set aside — `runsBeforeAsk`) stands, with `reviewedSha` saying whether it is behind the head, and only a bot that never reviewed here gets `{ verdict: 'failed', reason, sourceId: <the refusal comment> }` (`BotVerdictRecord.reason`, optional in the schema).
  A refusal is read in three shapes only — an explicit `Skipping <Bot>:`, a refusal phrase in a sentence that names the bot / review / `this`-`the`-`your` + repository, account, installation / the reader (a money word — credits, quota, billing — counts only inside the phrase itself, or as the word it is said of with nothing but refusal vocabulary after it (`BARE_REFUSAL_WORDS` — the finite list of what a refusal talks about, and the place to teach a new wording: "for this integration", "until the next billing cycle"), "no credits remaining", "Billing is not configured": "the billing worker retries after the customer has reached their usage limit" is a finding), or a *bare* refusal (first sentence ≤ 8 words opening on the phrase, only refusal vocabulary after it, optionally ≤ 200 chars of advice with nothing code-like — no code span, path, identifier, or a link into the repository's files — and every sentence of it reading as advice: an instruction, a link, a sentence about the reader, the bot or their installation, or a statement about the bot, the review or the setup it needs — a credential, the installation, repository or account, billing, or a person with a say over them — as its subject (`SETUP_SUBJECT` — determiner, up to two modifiers, the noun, an optional adverb, then the predicate's verb, which is what makes it the subject: "An administrator must grant access", "The newly generated token must have the required scopes";
  "the guard drops permissions on every request" has it as the object, and "the guard rejects members because it checks the wrong permissions" is about the guard) **and nothing after the verb but refusal vocabulary** — the same `BARE_REFUSAL_WORDS` test as a bare refusal's own tail, so "The new permissions now require an administrator for every read, breaking existing member access" is a finding however it opens;
  the vocabulary is the one place a new notice wording is taught — since a statement about the code opening on a determiner, "The new guard rejects every request…", is a finding's explanation under a "Permission denied:" heading) — everything else is a review.
  **`loading`** is the extension-only verdict for a bot whose only word so far is an old request while the timeline is still being read (`verdictsFrom(…, { partial })` from `timelineIngesting`);
  whole, the same request reads `failed`.
  The chip reads "Bugbot skipped" and wears the **warning triangle** (`ICON_ALERT`, amber: health `warn`, not `bad`, since nothing is wrong with the pull request, only the bot's setup, so the Review bots row does not go red for it;
  a run that broke with no reason, and a low score, stay `bad` with the red X) instead of a verdict's light — nothing was reviewed — and opens the bot's own words (its `sourceId`);
  its aria-label and hover card say the reason ("Did not review this pull request: Bugbot is disabled for this repository");
  the request menu lists it as "Skipped", unticked, since asking again changes nothing until the bot's setup does.
  A run that broke with no words stays "failed" with the same triangle.
  **Rerun on a bot's run summary** (`ChatByline.rerun`, `rerunControl` in chat.ts, `withRerun` in overview.ts): the one-bubble chat of a review bot's comment carries Geld's "Rerun" (sync glyph + word) on the byline's right, 8px from the slot's right edge as the words are from its top (the chat column is inset 16px, so the control hangs 8px past it), for bots with a trigger phrase;
  it posts the trigger like the request menu does and hides the bot's own re-trigger badge inside the comment (`AGENT_RERUN_CONTROLS`: Greptile's `app.greptile.com/api/retrigger` link;
  the mark `data-geld-agent-rerun` is read only by the chat's CSS, so the node is itself at home).
  **A bot's "view this run on our site" badge becomes "View"** (external-link glyph) before Rerun / See latest, on the byline and on a thread's pinned strip alike (`AGENT_VIEW_LINKS`, `takeAgentViewLink`, `viewControl`): Greptile's "View in Greptile" (`app.greptile.com/…/pull/N`), Devin's "Devin Review" (`app.devin.ai/review/…`), CodeRabbit's "Review in Change Stack" (`app.coderabbit.ai/change-stack/…`), a Cursor cloud agent's "Open in Web" (`cursor.com/agents/…`, its automation reviews by `cursor[bot]`) — linked images on the run's own path (a text link to the same site, or a logo linking home, is not the badge and stays put) that the bot shows only when it chooses to, so View appears only when the comment carries one (surveyed on public PRs Oct 2026;
  Bugbot's "Fix All in Cursor" is an action, not a view, and the other bots post none).
  The tooltip keeps the badge's words.
  The badge is hidden in the bubble (`data-geld-agent-view`), and the block holding it goes too once nothing else in it shows (`hideAgentBadge`: Greptile's two badges share one paragraph with a `<br clear="all">`, a blank line once both are gone).
  Running — the bot's verdict, or a click within `RERUN_PENDING_MS` (`visit.rerunPending`), taken on in place at the click before the pass sees the comment — turns the border transparent (never removed: the box keeps its size), fades the control, spins the glyph, keeps the word (so nothing shifts), uses the default pointer and GitHub's own `tool-tip` element ("Greptile is running";
  the page's custom element upgrades ours);
  a click then opens a Primer `Overlay` dialog ("Greptile is already running" · Cancel focused · "Rerun anyway") before posting a second trigger.
  **The same control stands on the pinned strip** over a thread's chat while the strip is open (`ChatSource.rerun`/`latestAnchor`, `sourceControl`, `.geld-review__chat-pin-row`), and the badge is hidden there too.
  **An older word of the bot's gets "See latest" instead** (`latestControl`, `ChatByline.latest`;
  the history glyph mirrored with `scaleX(-1)` — Octicons have no forward one — in Rerun's box, so the line never shifts): the strip showing how the summary read when the thread was opened (`revision`) leads to the comment's own row, and a comment from an earlier run where the bot has since posted a newer *summary* — `newerSummaryAnchor` in panel-model.ts, the bot's newest report-shaped comment in the crawl's `sourceFacts` (`botSummaryFor` with no cutoff;
  a status line, a trigger, a *refusal* — `refusalReason` — or a thread the verdict hangs on is not a summary, so a bot that refuses a re-run after an earlier review still leads to that review, not the refusal, and a bot that rewrites one comment in place has one anchor throughout) — leads to that one, through `onOpenAnchor`.
  Discovery (Oct 2026, six Mintlify PRs): Bugbot posts no root comment and no review body, edits only its thread comments and never links one comment to another, so nothing yet needs a two-comment view.
  Lines are ordered by how the bot is known (`BotPresence`): `seen` on the page (`/apps/<slug>` links in comments, the checks list and the reviewers box, payload verdicts and item sources, check runs by name, trigger comments), `declared` by the repository's `reviewBots`, `configured` by one of its own files in the repository (both from the controller's `repoBotsHint`, declared only once the config applies under the reader's `repoConfigs` choice), then `other`, the rest of the registry behind an "Other bots (N)" disclosure, since a trigger for a bot that is not installed is a public comment with a handle in it;
  with nothing pointing at any bot the registry is the list.
  Under a separator, Run ("Run Bugbot", "Run 2 bots", disabled with nothing ticked) posts one trigger comment per ticked bot in sequence and Cancel, Escape or a click outside closes.
  `postTopLevelComments` posts each trigger straight to `page_data/create_timeline_comment` (what GitHub's composer sends, `timeline-comment.ts`), never through the comment box at the foot of the conversation, which scrolled the reader to it and focused it, then catches the timeline up (`catchUpTimeline`) so the triggers show, and their bots read as running, without a reload.
  `mountPanel` does not rebuild while the menu is open (the picks would be lost);
  closing it calls `onRequestMenuClosed` → `reapplySoon`, so whatever changed meanwhile renders then.
  The Review bots row therefore shows on every PR conversation, with "No reviews yet" until a verdict exists.
  An open item's notes link to each source bot's run summary (`bots[].sourceId`).
  Quick view takes the **outermost** node per comment id — GitHub puts `issuecomment-N` on the comment group and on the comment inside it, which used to yield two cards — and moved nodes drop `hidden="until-found"` while away (a folded event row otherwise rendered as nothing in the slot).
  "Copy digest" (`digestMarkdown`) carries the TL;DR, CI/review status, one line per bot with its traffic light, a link to its run summary and an excerpt of what it said, then every item — so it is useful on a PR with no review threads.
  The "add the Geld Action" pointer is a persistent, undismissable line *under* the box (`.geld-review-nudge`), shown only while the page has no summary comment.
  **The panel is rebuilt on every change, so focus is restored by key** (`data-geld-focus`, `preventScroll`): besides keyboard users, the focused element is Chrome's preferred scroll anchor, which is what kept the row under the pointer from drifting when late content (avatars, bot images) settled in the slot;
  the slot also sets `overflow-anchor: none`.
  Rows are an accordion: at most one is open (`visit.openKey`, `item:<id>` / `fold:<key>` / `checks`), and the open row's slot shows the **quick view** (`review/quick-view.ts`): the row's *whole timeline nodes* — a review thread's row with every comment, its reactions, each comment's own ⋯ menu, the collapsible "Reply…" box and Resolve — **moved** from the timeline (`review/teleport.ts`: a comment node holds each one's place, `data-geld-teleported`, `hidden="until-found"` lifted while away, `restoreAll()` before the panel is rebuilt or torn down) and compacted by CSS (rail, avatar gutter and file header hidden;
  headings capped).
  GitHub sees its own DOM, so replying, resolving, reacting, editing and quoting behave exactly as in the timeline.
  **React-owned nodes (the merge box, and the conversation timeline for accounts on the React PR page) move too, live, never cloned** — a clone has none of React's handlers, which is what made the CI list's gear and ⋯ menus dead.
  Two things a loaned React node needs can only be done in the page's own JavaScript world (the content script's isolated world shares the DOM but not JS objects, so own properties it sets on nodes are invisible to React), so `entrypoints/portal.content.ts` runs with `world: 'MAIN'` (manifest for github.com;
  `inject.ts`/`enterprise.ts` add it best-effort where `scripting` accepts `world`): (1) while a child is on loan its parent gets instance `insertBefore`/`removeChild`/`replaceChild` that treat the placeholder as the node, so React's next commit does not throw and blank an error boundary;
  (2) React listens on its root container and finds the handler from the event's target, and a node under our panel is outside that container, so the portal re-dispatches a copy with the same `target` on the node's home root (skipped when the root already contains the panel).
  The protocol is DOM-only: `data-geld-teleported="<token>"` on the node, `<!--geld:quick-view:<token>-->` in its place, `geld:portal-lend`/`geld:portal-return` events on the parent;
  nested loans (a header worn by a row, out of a comment that is itself on loan) inherit the root through the loan.
  Without the portal (no MAIN-world support) everything still works except React's own controls inside a quick view.
  Tokens also let a *second* Geld instance (a re-injected content script) send another instance's nodes home (`reclaimOrphans`) instead of removing GitHub's comments with the old panel, and `restoreAll` never removes a node whose placeholder is gone — someone else owns it now.
  **An open row wears its first comment's header** (`wearHeader`: everything before the body in the comment container — author, time, labels, reactions trigger, ⋯ — into the row's `head-slot`) and shows the body alone below;
  the crawler reads worn pieces through `wornPiecesOf` (transitive) so a comment keeps its author, time, avatar and — for a review — its comment while on loan. *Reviews* row: review verdicts (`crawlReviews`, `pullrequestreview-N`, state from the row's own sentence, never the comment's words) fold out of the timeline in compact mode and list under the row as an index of people's reviews and remarks (`renderCommentsList`: state glyph, avatar, name, one-line preview, thread count, time, a right chevron;
  each line goes to the round where it opens);
  the heading names every reviewer once by their latest verdict (`reviewerGroups`: ✓ approved, ✕ changes requested, comment, ● awaiting — glyph, avatars, "2 approved";
  a later comment-only review does not withdraw a verdict;
  a re-request does not either — the reviewer stands in their verdict's group *and* in awaiting, as GitHub's merge box has it ("Changes approved · 1 approval, 1 pending review") while its sidebar names only the request, and the awaiting title says "asked again;
  approved";
  only GitHub's own dismissal (sidebar `dismissed`) withdraws a verdict;
  people's top-level comments are not reviews and stay off it).
  **The Reviews row's own ⋯ is "Request a review" for people** (`reviewersMenu`, panel.ts;
  shown when GitHub's sidebar form `form.js-issue-sidebar-form[action$="/review-requests"]` is on the page): everyone with a standing (`reviewerStatuses` — one record per person: verdict, awaited, the verdict's anchor) is listed first with a checkbox and their standing as glyph(s) and words ("approved · awaiting";
  the words drop below a 340px menu, the title keeps them), then "Other reviewers" opens a search box of Geld's own — Geld owns this UI, nothing of GitHub's is portaled — over the same list GitHub's menu loads (`reviewers.ts` `fetchReviewerCandidates`: the form's `data-filterable-src`, the PR's `/review-requests` with `Accept: application/json` → `suggestions`, `users`, `teams`, each with GitHub's id and `selected` for a pending request), filtered as you type on login and name, arrow keys moving an `aria-activedescendant` option, Enter ticking it, Escape clearing then closing.
  Request posts GitHub's own form once (`requestReviewers`: its hidden token fields plus `reviewer_user_ids[]`/`reviewer_team_ids[]` for everyone ticked **and everyone already pending**, because the form is the whole set and an id left out is a request withdrawn;
  asking someone who reviewed is how GitHub itself re-requests), then refreshes the sidebar block from its `data-url` partial as GitHub's socket would.
  In the opened Reviews list every person's verdict wears a ⋯ (`reviewActions`): **Dismiss review** and **Re-request review** press GitHub's own "More review options" on that verdict's row in the merge box's Reviews section (`pressReviewAction`, expanding the approvals/changes-requested groups first;
  the dismiss reason is typed into GitHub's own dialog, which is why nothing of Geld's asks for it;
  shown only while that section exists — an open PR the reader can act on), re-request falling back to the form with the person's id, plus Show in timeline and Copy link.
  **The heading reads the sidebar first** (`crawlSidebarReviewers`: the Reviewers block's `[data-assignee-name]` rows, each with the picture and a status control whose tooltip says the sentence — "X approved these changes", "X requested changes", "X left review comments", "Awaiting requested review from X", a dismissed review — the octicon's name as fallback;
  Apps are skipped, they are the Review bots row's): it is GitHub's own latest-per-reviewer and complete from the first paint, while the timeline's review rows sit at the end of a long conversation behind "Load more" and minimized groups and take seconds of fetching, during which the row used to say "No reviews yet" on an approved PR.
  `reviewerGroups(entries, sidebar)` takes the sidebar's word on a reviewer's verdict as final and the timeline's only for reviewers it does not list (a sidebar `awaiting` is a request, not a verdict, so the timeline still supplies that reviewer's);
  the approvals count and warning use the same standing verdicts (`standingReviewers`, panel-model.ts: sidebar, then timeline, then the payload for reviewers the page has no review from — and for one it has reviews from only while the timeline is incomplete (a "Load more" left, or still ingesting), the payload is for this head (a push is when GitHub dismisses stale approvals, so an older payload may hold an approval from before one) and it was written after every review loaded from them: a long conversation's middle can hide a later approval while an older dismissed review is on the page;
  a complete timeline with reviews from them and no verdict is a dismissal confirmed, and no payload brings the approval back;
  and only a payload verdict supersedes a loaded one — the Action records a person's last review, comment-only or not, so a payload `commented` leaves a loaded approval or request for changes standing);
  the approvals count (`requiredReviewsFrom`) is seeded the same way;
  the open list shows a provisional line per sidebar verdict the timeline has not shown yet (`sidebar:<login>`, `isProvisional`: glyph, picture, name, nothing to open or go to) which the review's own line replaces as it lands.
  While the timeline is still being read — `timelineIngesting`: fragments in flight or still wanted (`deferredFragments`/`fragmentWanted`, shared with `loadMinimizedReviews`), or a "Load more" this visit will press;
  only with the compact timeline, which is what fetches everything — `PanelModel.ingesting` puts GitHub's in-progress ring (`ingestingMark`, `.geld-review__ingesting`) after the row's content (the Review bots row too while it has no chips), the empty states say "Reading reviews…", and the open list ends in "Reading the rest of the timeline…";
  **The digest's top edge carries a thin accent bar while Geld reads the timeline** (`PanelModel.progress`, `ingestProgress`, `syncProgress`, `.geld-review__reading`: not `__progress`, which is the rounds' resolution meter), only when the digest is Geld's own reading (an Action summary fresh for this head is whole already, unless it was truncated): the items "Load more" has brought in out of the most it said it hides ("169 hidden items" beside the button, `hiddenTimelineItems`;
  the last count stands while Geld's pressed form still stands showing "Loading…", `loadMorePending`), with the deferred fragments fetched out of those fetched or still wanted;
  a rough share that never goes back, kept in place across passes rather than in the signature, carried into a rebuilt panel (the reading ending is itself a rebuild) so it fills and fades rather than vanishing, a new bar never starting ahead of this visit's reading, and the width forgotten when the panel is torn down.
  not a skeleton, since the verdicts shown are real.
  Preceded by `approvals/required approvals` only when the page states a requirement — the merge box says "At least N approving reviews" while unmet and "N approving reviews by…" (a count) once met, the sidebar's Reviewers block keeps saying "At least N approving review is required to merge" while the PR is open (`reviewersSidebarText`), and a merged or closed PR states it nowhere, so there the groups alone carry it (no "N approved" beside "✓ N approved");
  the requirement seen is remembered per visit.
  Narrow (`@container` ≤ 640px): the fraction alone and the glyph-plus-avatars groups, no words.
  **Each conversation has one home**: the round (by type) or the push and its Needs attention row (by push).
  The Reviews row's list is an index (`renderCommentsList`, `entryRow(…, 'pointer')`, `[data-pointer]`, chevron right): one line per verdict, remark or pending request with a "N threads" count, and a click goes to the round through `onOpenAnchor` (`seatFor`, `revealRow`);
  threads are not listed there (`ReviewEntry.parent` still records a person's review for the crawl).
  **Times line up down a list**: every right-hand control is a 28px square (`.geld-review__chevron`, `.geld-review__ctl-slot--held`, `.geld-review__spacer`), and `entryRow`'s `reserveChevron` says a sibling line has the most squares a line in that list can have — in a round two (⋯ and chevron) when any line opens, in the Reviews index one (the pointer chevron) — so a line with fewer (a bare verdict: none;
  a verdict with threads: only its pointer chevron) leaves the missing squares blank.
  Per list, not per panel: a list where no line has a ⋯ lets every time sit against the edge.
  By push, an open thread listed inside its push is a pointer row to its Needs attention row (`itemRow(…, pointer)`, focus key `main:ptr:`);
  resolved threads open in the push.
  A verdict opens only when it wrote a comment (`entryOpens` = `hasBody`), as a one-bubble chat;
  a bare verdict is a static line with its thread count, since its threads are rows of their own in the same round, so no list of threads and no "No comments" callout is rendered anywhere.
  Wording follows GitHub: "requested changes", never "rejected".
  **Single-comment rows (bot run summaries, review entries) wear their comment's own ⋯ menu, open or closed** (`wearControls`, `[data-geld-ctl]`): GitHub's menu is moved live into the row so it is GitHub's (Copy link, Quote reply, Edit, Hide, Delete);
  a classic `details-menu` takes "Show in timeline" (`.geld-review__gh-item`, removed on restore) and Geld's small menu steps aside (`data-gh-controls="menu merged"`);
  a React menu renders elsewhere on open, so Geld's stays beside it.
  **Items that find their comment from themselves are relayed** (`relayCommentItems`): GitHub's Edit, Hide and Quote reply look up `closest('.js-comment')` from the clicked item, which on the row has no comment above it, so they threw and did nothing (mint#13760);
  a click on one is stopped, the menu closed, and replayed from a hidden copy of the item inside the comment's `.js-comment` (kept two seconds, since the edit form loads lazily), and Edit on a closed row opens the row first so the form is in view (with the full timeline that only scrolls to the comment, so after a moment Edit replays from the comment where it stands).
  Rows carry no reaction control (reacting without reading was judged not worth the space) and item rows no quick-reply: replies happen per thread.
  **An opened conversation is a chat** (`review/chat.ts`, stylesheet section "chats").
  An item's row opens to `renderChatView`: one `.geld-review__chat` per thread container with a head (the fitted path, a copy button, GitHub's link to the diff), a pinned strip for the comment the thread came from (`threadSourceOf`: the review body holding it, else the bot's run summary, described from the crawl: avatar, "CodeRabbit's review", first line;
  it unfolds the real comment under the strip on request, moved there like the thread so it is in one place at a time, `visit.sourcesShown`), then GitHub's thread node moved whole into the body.
  The chat is attributes on GitHub's nodes plus CSS, never a rewrite.
  A review's own body card (`pullrequestreview-N`, "X left a comment") is the `timeline-comment-group` itself — header, body and reactions are its direct children, and it carries `minimized-comment` along with `timeline-comment` and `js-comment` whether or not it is minimized — so `messagesIn` reads a `.minimized-comment` as the wrapper of a minimized comment only when it holds a `<details>`;
  read as a wrapper the card had no message and showed raw in its chat, its own header inside the bubble (server#7851).
  `annotateMessages` marks each comment (`data-geld-message`) with its parts (`data-geld-part` = `meta` author line, `bubble` body, `edit` GitHub's edit form, `reactions`), `data-geld-mine` when its author is `meta[name=user-login]` (right side, accent tint), and `data-geld-run` (`only`/`first`/`mid`/`last`) so one author's consecutive messages share a run (name and picture once, tightened corners);
  every attribute goes with `onRestore`.
  GitHub's hunk and line range render under the head in the diff's type;
  every bubble is the whole comment as rendered (tables scroll inside it);
  the reaction pills sit under the bubble in flow (compact, from the bubble's outer edge inward, wrapping, so a run's next bubble follows below them and nothing is covered — they used to be lifted onto the bubble's top edge, which overran a narrow bubble's byline and the bubble above);
  the comment's own reaction picker and ⋯ menu are moved (`placeControls`, loans) into a `geld-review__msg-side` slot that spans the empty side of the row, where they stand level with the bubble's first line, shown on hover, focus or while open, and stack when the side is only the gutter (the slot is a stacking context at `z-index: 2`, so a menu or picker open inside it painted under the rail and target-ring overlays — `::after`, `z-index: 5` — and the ring's line crossed the menu;
  while one of its popups is open the slot stands at `z-index: 6`, as a row with an open ⋯ does (`.geld-review__row:has(details[open])`, above every other row and above those overlays on the rows and slots below it — at 4 the ring round a permalinked line inside a round still crossed the round's menu) — two rules, `:has(details[open])` and `:has(:popover-open)`, since `:has()` is unforgiving and a Safari without `:popover-open` would drop a combined one whole) — GitHub's reaction handler finds the comment by `closest('.js-comment')` from the picker's form, which the message is, so moving the picker is safe (it then replaces the row and the picker's `details` where they stand).
  **A chat GitHub rewrote in place is read again, not left raw** (`chatNeedsRedress` in chat.ts, `slotNeedsRender` + `readySlotForRender` in overview.ts): a reaction swaps the reactions row where it stands (inside the message, or inside the box `placeControls` moved it to), and ~2 s later GitHub's socket update `replaceWith`es the whole `.js-comment-container` — the loan itself, which the loan watcher adopts (`adoptReplacements`).
  The newcomers carry none of the marks the stylesheet lays the chat out from, so the comment showed as GitHub's raw card inside the chat (own header, own ⋯, pills astray) until something else happened to rebuild the panel;
  removing the reaction "fixed" it only because that rebuild came with it.
  A pass now re-renders the open slot when any message in a chat view is unmarked or a message's reactions row stands outside every marked part (a row still inside the bubble needs nothing), after sending the slot's loans home — a node on loan is never lent twice, so rendering over the old chat would have stranded the comment and said "Not loaded on this page yet" — and the rows' worn controls and the CI gear are worn again in the same pass's dress phase;
  while the reader types in a field inside the slot the render waits for its blur, as a panel rebuild does. the message is kept exactly as wide as its bubble (its author line and the pills' box are `width: 0; min-width: 100%` and overflow instead — on the reader's own messages the author line is `justify-content: flex-end`, so it hangs from the bubble's right edge and overflows leftward, picture then name then time read inward as on the left;
  GitHub's `.flex-row` is `!important`, so a `row-reverse` on that line never applied and it ran right under the picture), so the slot's `calc(100cqw - 100%)` is the empty side;
  GitHub's `.js-reactions-container` is `display: contents` because its script hides pills once that row is two lines tall;
  menus open into the empty side when it has room and over the bubble otherwise (`@container` on the slot: palette 294px, ⋯ menu 185px);
  the palette opens north by GitHub's own class, the ⋯ menu drops down 12px under its button (caret tip 4px off it) unless down would cut it off and up would not, when `installMenuFlip` (a capturing `toggle` listener, the menu's height watched while open since its items load lazily) marks the `details` `data-geld-menu-up` and the stylesheet anchors it above with the caret turned;
  the picker's tooltip is turned north (`data-direction`, so it never covers the ⋯ stacked under it) and hidden while the palette is open;
  a lone message (the pinned source) has no empty side and keeps its controls straddling its top-right edge;
  the thread's collapsed "Reply…" is the composer at the bottom with GitHub's Resolve beside it, always visible, and no "Show N more" bar exists (every message shows).
  A top-level comment (a bot's run summary, a review body, a person's remark) opens through `renderCommentChat` as a one-bubble chat marked `data-geld-lone`: the row above is its author line, so the bubble has none and spans the width.
  **A byline keeps the comment's created time and marks an edit separately** (`ChatByline.edited`, `editedMark`, the `ICON_HISTORY` clock after the time): the bubble is the comment as it reads now, so **the byline's time is the edit's** (`relativeTimeElement`, GitHub's live element, no `data-geld-time-for`) and the clock says when the comment was first posted — "Originally posted Oct 8, 2026, 5:08 PM" — the absolute moment only: a relative age needed re-wording while a chat stayed open, and with the date beside it the tooltip wrapped to two lines (`ChatByline.postedAt`, the anchor's datetime) — in GitHub's own `tool-tip` (instant, styled like the page's;
  `title` only on a page that has rendered no `tool-tip`, since the content script's world has no `customElements` to ask).
  A thread's pinned strip wears the reading's time the same way (`ChatSource.at`: the rewrite's for a live summary rewritten since it was posted, the summary's own for one from an earlier run;
  a past revision wears `revision.at`).
  `dressByline` reads it with `editedAt` on the comment element (not the timeline row, whose id is not the anchor `logUrlOf` matches), which asks the edit-history log only for a comment the page marks as edited and bumps `editsVersion` (in the panel signature) when the time lands.
  **Panel times carry the exact moment on hover** (`absoluteTimeText`): the cells are plain text, so `refreshReviewTimes` sets each `[data-geld-time-for]` cell's `title` from the anchor's `relative-time` `datetime` (cached in `datetimeByAnchor`) and runs once at mount so the title is there from the first paint;
  Geld's own `relative-time` elements get the same title.
  `data-geld-pinned` is the sidebar accordion's and is cleared each pass, which is why the chat's mark is `lone`.
  Clicking anywhere non-interactive in a row (avatars, blank) toggles it (`rowClickToggles`).
  **The CI row's gear is always present** beside the chevron: GitHub's checks list is expanded once per visit (folded away, so invisible) so the gear exists, and after a regroup React re-creates the group header, so the worn gear is swapped for the fresh one (`forgetLoan`).
  The Reviews reading is kept per visit (`lastReviews`) because a React re-render of the merge box can blank a pass.
  **Review rounds** (`Batch`, `buildBatches` in overview.ts): the panel's main sections group by *push*, not by author — the timeline is walked in home order, a run of commit rows with nothing between them opens a round (they are its `commits`, merged) — except that **a rewritten commit stands where it was authored, not where GitHub lists it** (`seatRewrittenCommits`): GitHub renders a PR's commit rows from the commits *as they are now*, so after a rebase (an amend, a cherry-pick) the whole list stands at the rewrite and the earlier pushes the reviews answered have no row left;
  mint#11561 read a week of push-and-review cycles as one round.
  The Commits tab JSON (`commit-dates.ts`, `commitTimes`: `committedDate` and `authoredDate` per oid, one request per visit) tells a rewritten commit apart (`isRewritten`: committed ≥ 60 s after authored — a commit pushed as made carries the same second in both), and such a row is seated before the first dated entry (comment, thread, review, force-push row) later than its authored date;
  others keep GitHub's position, which is the push — and everything until the next commit — threads (`items`), bot run summaries (`comments`), people's verdicts and top-level comments (`reviews`), preview deployments (`previews`) — is what landed for that push;
  content before any commit is round 1 with no commits (labelled "Earlier" by push — force-pushes leave GitHub's commit list after the threads it answered;
  one round when no commits are on the page).
  **A bot that rewrites one comment every run (Greptile) leaves it at its creation point, so `buildBatches` moves such a comment to the round whose window holds its latest edit** (`editedAt`, forward only, a round emptied of content and commits by the move is dropped) — its current words then read against the run they describe, while past rounds' threads keep pinning their own revision (`revisionAsOf`);
  a human editing a bot comment is not told apart, GitHub's edit log not exposing the editor here.
  A round's start (`startOf`) is the push that opened it, and the timeline gives the pushes' order but not their times (a commit row carries no timestamp), so the nearest numbers stand in: a force-push event's own timeline time, and for a commit row the date `seatRewrittenCommits` seated it by (authored for a rewritten commit, committed otherwise, from the Commits tab), so both readings agree after a rebase;
  a round with no known time yet is not a move target.
  A commit's date can precede its push, so an edit in that gap would seat early — accepted, since a bot edits its summary in answer to a push and never in that gap;
  exact push times are the API's and belong in the Action's payload.
  `ciGlyph` is what GitHub draws beside the round's last commit (`commitCiGlyph`: the `.commit-build-statuses` summary first).
  **Two groupings** (`reviewGrouping`, Experiments;
  also a quiet "▤ type ▾" menu in the Geld row beside the copy button (Octicon `rows`;
  radios drawn with the panel's circle / check-circle glyphs in grey) — `groupingMenu`, `onGrouping` writes the setting through `settingsItem.patch` and the controller's settings watch re-applies in place): `type` (default) lists rounds under "N rounds to review" / "N resolved threads" plus the bot-comment and activity folds — **the latest round with no threads at all is the current round, never a settled one** (`current` in `mountPanel`: nothing in it was ever to settle, and what it holds is the state of the conversation), so it stands in the open group, headed "Current round" when it is alone there;
  `batch` (`model.grouping`) replaces those with "Needs attention · N open threads" (every open item as a top-level row, opened directly — `openRow` routes item keys there instead of into their round) and "N pushes" newest first (`GroupId` `pushes`, open by default), each `batchRow` led by one `repo-push` glyph and reading left to right "Push 07 · 3 commits" (numbers zero-padded to the widest, tabular figures), the committers' avatars (`committers`, shaped as GitHub shapes them: `avatar-user` is a circle — @claude committing as a user is one — anything else a square), the push's CI as a circle glyph (the last commit's `.commit-build-statuses`), the threads' meter or a check once all are resolved, the comments chip and one "N previews" pill;
  a push whose CI failed is `bad` (red) whatever its threads say, a settled one `good`;
  an open push (`renderBatchView`) shows previews, threads, reviews (`entryRow`), other bot comments, then "N commits" under a commit-glyph heading (`visit.openCommits`, `commitsSlot` filled by `renderQuickView` with the commit rows starting at the row edge so their glyphs stand in the header glyphs' column;
  they keep the commit-hover breakdown).
  **A commit row's message keeps to one line** (the cell is a nowrap flex row, the `code` ellipsizes, GitHub's "…" expander stays whole) **until the reader opens it**: with `Details--on` on the row's container the cell is back in flow, the subject wraps whole and the expander follows its last word.
  **GitHub's own split of a long subject is undone there** (`joinCommitSubjects`): past 72 characters GitHub ends the link in "…" and begins the body with the tail ("…gories"), so even opened the subject was in two places;
  the link is given the whole subject (the link's `title` is the full message, subject first — the halves must add up to it) and the body loses the tail and the blank line after it (a body left empty is hidden, `data-geld-empty`), text only and put back when the node goes home.
  The row then reads whole: one ellipsized line closed, the full message open.
  The status block is the same in both.
  **Tones** (`data-tone`, `good`/`warn`/`bad`, from GitHub's muted success/attention/danger surfaces): a gradient from 45% of the tone at the left to a 10% wash at the right colours the surface, the row's glyph and the meter — never the words (labels, titles, counts keep their default colour);
  hovered or open, the row is the plain muted surface.
  Settled rounds and items are `good`;
  status rows tint only for `bad` (`alarmTone`) — three adjacent rows in three hues read as a traffic light.
  Below 640px of panel width (`@container geld-review`) rows drop what only repeats their glyphs: round names, timestamps, "resolved", check labels;
  labels read "Bots"/"CI".
  **The bots' and reports' pills are not on that breakpoint: each row gives way to its own room in two steps** (`review/fit-chips.ts`, rows marked `data-geld-fit` — `ATTR_FIT` — on their `.geld-review__status-content`): the row's pills are measured (widths plus gaps against the row's width) with the row at each step in turn, and the first that fits on one line stays — everything · `names` (every pill's `__bot-name` hidden: the mark says who, "clean", "5/5", "patch 62.50%" still say how) · `details` (`__bot-detail` hidden too: mark and light alone).
  Decided per row, so a bots row with one pill keeps its words at 400px while a reports row with two Codecov pills is at `names`;
  made again on every pass (`fitChips` in the dress phase) and whenever the panel changes width (one `ResizeObserver` on the panel root, width changes only;
  `stopFittingChips` on teardown).
  The previews row is not fitted: its names are the deployments' and say what the mark cannot.
  A round's row shows a progress glyph (circle → filled check when every thread is resolved), the avatars of everyone who posted (one per login — no names, the avatars say it;
  bots get Geld's identity hover card via `data-geld-who`, people GitHub's), "Round N", the Geld row's meter with `d/N resolved`, a count chip with every comment in the round (run summaries plus thread comments) and the time;
  "N rounds to review" (rounds with an open thread, expanded by default) comes before "N settled rounds" (collapsed).
  An open round (`renderBatchView`) shows its threads under "N unresolved threads" / "N resolved threads" as nested item rows that open one at a time (`visit.openSubKey = item:<id>`, `itemRow(…, nested)`; **the open row follows its conversation** — an item's id hashes every comment anchor in it, so the reply the reader has just posted gives the item a new id, and `reseatOpenItem` moves the open key to the item sharing one of the anchors remembered under that very key (`visit.openItemAnchors`, read each pass the item is found and seeded when a row is selected;
  anchors read under another key are the previous thread's and never used) rather than letting the row close under them when the missing-line grace ends, notra#1148), each opening to its chat — one chat per thread container (`threadNodes`), since GitHub groups a review's threads on one file under one timeline row.
  **A comment GitHub appends to a loaned thread is dressed where it stands, before paint** (`dressArrivals`, from the loan watcher's MutationObserver callback — a microtask;
  it uses `loanWatched`, the live root, since the observer is made once and its callback's own `root` is the first mount's;
  not in a hidden tab, where the deferred pass redresses the chat when the tab shows): the reader's reply, or one over the socket, arrives as GitHub's raw card, and the pass that read it (`chatNeedsRedress` → the whole slot re-rendered, every loan home and back) ran after a 150 ms debounce, so the card showed raw and then the chat redrew (notra#1148).
  The newcomers are marked and every message's place in its author's run re-read (the one before a reply is `first`, not `only`), and the pass finds nothing to redress;
  when the reply changed the item's id the row and slot are still rebuilt in that pass, in one task, with no paint between.
  **Where a thread came from is pinned at the top of its chat** (`threadSourceOf`: the body of the review holding the thread — resolved from the DOM via `reviewCommentOf` on the outermost `pullrequestreview-N` copy, because GitHub repeats that id and a map keyed by it flips as nodes move — else, for a bot's thread, **the bot's run summary in effect when the thread was opened** (`botSummaryFor`: the bot's latest report-shaped top-level comment or review body — not a status line, not a trigger — created by the thread's time plus `SUMMARY_LAG_MS`, since bots post summary and threads seconds apart in either order;
  the bot's `sourceId` is the last resort, and a bot whose "summary" is itself a thread comment has none).
  **A bot's pinned summary is shown as it read then, not as it reads now**: bots rewrite that one comment run after run (Greptile's "Confidence Score: 4/5 … Reviews (1)" became "5/5 … Reviews (3)" on mintlify/server#8382 while the Sep 25 thread stayed), so `ChatSource.revision` (`edit-times.ts` `revisionAsOf`) reads the comment's edit-history log (`/user_content_edits/show_edit_history_log/<id>`, every revision as a `button[data-edit-history-url]` with its `relative-time`), picks the latest revision written by the thread's time plus `RUN_SETTLE_MS` (5 min: a bot fills its summary in moments after posting the threads — `revisions.ts` `revisionIndexAt`, tested), and fetches that revision's view (`/user_content_edits/UCE_…`): GitHub's rich diff against the revision before, whose `<del>`s dropped and `<ins>`s and `.expandable` wrappers unwrapped are the comment as GitHub rendered it then (`contentOf`;
  the view also carries the exact markdown in a `clipboard-copy[value]`, unused).
  The strip then previews that reading's first line and, open, shows the copy in `.geld-review__chat-then` (the live node stays home) over a note "As it read when this thread was opened · edited N times since, last <relative-time>";
  `current` (no later edit) teleports the live node as before, `loading` says so, a revision that cannot be read falls back to the live node.
  A summary from an earlier run than the thread (the bot posted none with this run: Bugbot's body-less second review on server#8382) wears the summary's time on the strip (`ChatSource.earlier`, "· yesterday").
  Both lookups are cached per URL for the page and bump `editsVersion()` (in the panel signature) only when something changed, so the open chat is rebuilt once when the answer lands and never for the minute refresh of an unchanged log.
  People's comments are never read this way.
  `visit.sourcesShown`, in the panel signature as `openSources`).
  The round's other bot comments (deploy notes, "Starting review", a review bot's *earlier* summaries — its latest is the Review bots row's line) follow the threads directly under an "N bot comments" heading — no further toggle, a round is already two clicks in — as `entryRow` lines opening one at a time to the review's *comment*, never its "X reviewed · View reviewed changes" row.
  Item rows put the file path right after the title (`__title`/`__detail` are `flex: 0 1 auto`), so it takes what it needs and truncates at the wall.
  **Paths are whole and fitted, never GitHub's trimmed text**: the conversation tab trims long paths server-side ("...ard/components/…", no attribute holds the rest) — `whole-path.ts` recovers them, since every file link anchors to `#diff-<sha256 of the path>`: a guess (a known whole path's prefix + the trimmed tail, known = the PR's diff via `applyReviewOverview(settings, paths)` plus untrimmed paths on the page) is verified by hash, asynchronously, then the panel reapplies.
  A frame's path line is fitted to its width by `path-fit.ts` with `@chenglou/pretext` (canvas measurement, no layout): file name always, the file's directory next, then as much of the start as fits, one "…" for the gap, refitted on resize;
  no line number.
  **Mentions** (`refs.ts`) fetch the issue/PR hovercard (`/owner/repo/pull/N/hovercard`, once per reference per visit, only when the fold is open) for the real title and `State--…` badge, and render on the commits list's grid (glyph at 17, avatar column at 43, text at 79, 29px rows) under "Where this PR is mentioned" / "What this PR mentions".
  **Every fragment Geld fetches itself (minimized reviews, deferred threads, Load more) sends GitHub's fetch nonce** (`fragmentHeaders()`: `X-Fetch-Nonce` / `X-Fetch-Nonce-To-Validate` from `meta[name=fetch-nonce]`);
  without it the markup comes back with foreign nonces and every later load from it (a comment's ⋯ menu) answers 403.
  `mountPanel` replaces the old panel with the new one in a single mutation after measuring the description card — removing first and inserting later, with a layout in between, made the browser's scroll anchoring throw the page up by the panel's height on every rebuild while GitHub was still loading.
  Nothing under a row is ever found with a plain `closest()`: `closestAtHome` (teleport.ts) crosses a loan at its placeholder, because the panel sits inside the description's own timeline row and a `closest('.TimelineItem')` from a loaned comment would claim (and fold) that row.
  Item keys still exist for routing: `openRow` turns `item:<id>` into its round plus the item, so permalinks, hover-card "See full thread", reply and quote-reply all land inside the right round;
  bot run summaries claimed by a round make their `bot:` fold group silent.
  Cross-references open as `renderMentionsView`: one line per mention — title (the only part that truncates) and `owner/repo#N` as one link carrying GitHub's hovercard attributes, the state badge, when, and the mentioner's avatar at the right.
  **In compact mode the whole timeline folds** — after items, checks, reviews and people's comments, `crawlLeftovers` takes every remaining row: commits and cross-references become rows in the panel's "Activity" section (`FoldGroup.section`), bots' bare "reviewed" lines and the summary comment fold silently (`FoldGroup.silent`, no row, not counted).
  The comments section reads "N other items".
  A review row's body must be its own (`bodyElementOf` skips bodies inside a nested thread), otherwise a bot's "reviewed" row counted as a comment and vanished from the count whenever its thread moved.
  Times read `relative-time`'s shadow text ("yesterday"), as GitHub shows them.
  In compact mode the timeline's "Load more" is pressed automatically (up to `MAX_AUTO_LOADS`) so everything is on the page to fold — **never before `document.readyState === 'complete'`**, and with a guard on the form's `submit`: GitHub's classic control is a submit button whose native action is `…/timeline_more_items`, and pressed before GitHub's JS has claimed the form the browser navigates there (a page that does not exist);
  a submit nobody prevented is stopped and fetched ourselves, the form replaced with the rows.
  **GitHub minimizes reviews it "marked as resolved" and defers their contents** — the review behind `.minimized-comment include-fragment[loading=lazy]`, and each resolved thread's comments behind `review-thread-collapsible[data-deferred-content-url]` — both loading only when scrolled into view, which a folded row never is;
  `loadMinimizedReviews` fetches them the way the elements would (threads first, four at a time, `MAX_EAGER_FRAGMENTS` per visit;
  asking `include-fragment` itself to go eager made it error) and puts the markup in place, so a PR whose findings were all resolved still shows its threads.
  **A URL is fetched again once the nodes it produced have left the document**, not once per visit: every timeline item is a `js-updatable-content` container that GitHub replaces from its partial on the next socket message about the PR, and the partial carries a resolved thread as its header with the comments deferred behind the same URL, so on a busy PR the thread the crawl had just read vanished (and the bot's chip fell back from "resolved" to its summary's "findings") until a reload (`fetchedFragments`;
  a fragment that carries a fragment of its own cannot loop, since what it put in the page is connected).
  A response whose fragment GitHub replaced meanwhile fills the fresh fragment standing for the same URL (`liveFragmentFor`);
  a failed fetch is retried after `FRAGMENT_RETRY_MS`;
  a fragment GitHub's element gave a `src` on hover (preload) is still fetched, since lazy loading never reaches a folded thread;
  and the edit-form and saved-replies fragments inside a loaded comment are left alone.
  A thread frame lifts the collapsible's hidden body (restored on return).
  **In compact mode the review threads themselves fold out of the timeline** (each item's rows join the fold targets under `item:<id>`), so nothing is left below to reveal or scroll to;
  a **permalink** (`#discussion_r…`, or a find-in-page `beforematch` inside a folded node) sets `visit.pendingAnchor`, opens the row that holds it and — the one scroll Geld makes — lands on that row once, instantly, because the browser's own fragment jump went to the original's now-empty place.
  "Show in timeline" switches to the full timeline first and then sets the hash.
  The panel is **not rebuilt while focus is in a GitHub form inside the slot** (a rebuild would move the textarea and drop focus mid-typing), **nor while deferred fragments are landing in a burst** (`mountPanel`'s `holdRebuild`, from `fragmentLanded`: a landed fragment starts the next fetches itself and asks for one render after 400 ms of quiet, at least one per 1.5 s;
  a rebuild per landing sent the open chat home and back every few hundred milliseconds, visible as flicker for the first seconds of a long conversation;
  a click that changes the open row still rebuilds at once).
  **Chrome's fragment anchor is cooperated with, not fought**: until the document's load ends Chrome re-scrolls the URL's `#anchor` element to the top edge on every layout, and that element is the id's carrier Chrome found at navigation, before the panel existed (for a review GitHub repeats the id on a `js-updatable-content` shell that stays home while the comment group is on loan);
  `alignAnchorCarriers` gives every carrier a `scroll-margin-top` of exactly its distance from the landing (negative allowed), re-measured each pass while `document.readyState !== 'complete'`, so Chrome's scrolls land where the landing did, and `alignRevealWithLanding` does the same for a folded home row Chrome is about to reveal (`beforematch`, measured with `hidden` lifted).
  The hold (`hold.ts`) ends after the same correction three times in a row rather than fight a scroller it cannot see.
  The row's Reply opens the thread's own "Reply…" (never a comment's "Quote reply" menu item, which sits earlier in the DOM), the ⋯ menu adds Quote reply / Copy as Markdown / Copy suggested fix / Show in timeline / Copy link, and the status circle is GitHub's Resolve;
  per-comment options are GitHub's own menus in the moved thread.
  Compaction (`compactTimeline`: `off | compact | minimal`) hides bot comments and low-signal events with `data-geld-folded` only;
  nothing is inserted into the timeline.
  **Geld scrolls the page for exactly two reasons**: landing on a permalink's row once (`visit.landedAnchor`: a `beforematch` for the same anchor opens its row but moves nothing;
  a new hash lands again), and `keepInPlace` — toggling a row compensates whatever opened or closed above it with an instant `scrollBy` so the row under the pointer does not move, then nudges a row that would sit under GitHub's sticky header below it.
  Otherwise deeplinks (`#discussion_r…`) rely on the browser's fragment navigation — the target's fold is revealed in place, its row is marked `data-viewing`, "Show in timeline" is a plain `href="#anchor"`, reply boxes are focused with `preventScroll`, and "Load more" is clicked (up to 8 rounds) when the target is not on the page yet.
  The Action (`apps/action`, `pull_request_target`, never checks out PR code) edits that one comment on review events;
  "Request a review" posts a bot's comment trigger after an inline confirm.
  **Optional AI is bring-your-own-key and incremental** (`@geld/review/consolidate.ts`, `prompts.ts`;
  Action `main.ts`, extension `review/ai.ts`).
  The key is a repo secret for the Action or the user's gateway key in `storage.local` for the extension — never the gist, never a Geld server;
  `aiBaseUrl` defaults to the Vercel AI Gateway (`joinUrl` folds a trailing `/v1`) and `aiModel` comes from `/v1/models`.
  No request without key + URL + model.
  Only **bot-only** items are rewritten (people's words stay theirs);
  `planConsolidation(previous, items)` matches items to the previous summary by their source-anchor set — unchanged items **carry** the previous title/context/fix, an item that gained a source (a second bot reporting the same thing) is re-asked with `previousTitle`/`previousContext` so the wording moves as little as possible, and the TL;DR (`GeldPrMeta.summary`, `forItems` = sorted open ids) is rewritten only when the open set changed.
  Items may carry `context` (merged detail from every source) and `fix` (`{ text, source: 'bot' | 'human' | 'ai' }`: a source's `` ```suggestion `` block, or one the model proposed when `suggestedFixes` asks for it);
  the `suggestedFixes` setting (`all | bots | ai | off`, a `choice` field) decides which fixes are kept in the payload (Action input `suggested-fixes`) and shown (`fixVisible`).
  In the browser, results live in a per-visit cache layered onto every pass (`withAi`) so a title never flickers back;
  rows and the TL;DR being worked on shimmer (`[data-pending]`, `.geld-review__skeleton`, static under reduced motion), rewritten rows carry an `AI` tag, and an open item shows Geld's notes (context + fix with copy) above the moved comments.
  "Copy digest" and the ⋯ menu's "Copy as Markdown" / "Copy suggested fix" produce Markdown with absolute source links (`panel-model.ts`), meant to be handed to an agent.
  **A loan must keep GitHub's live refresh at bay while the reader uses it** (`teleport.ts`, `syncInteractionMarks`): every timeline item is a `.js-updatable-content` container that GitHub `replaceWith`es from its partial on each socket message about the pull request, unless its guard finds an interaction *inside the container* (focus, an open `details`, a dirty field, or an `.is-dirty` class).
  A comment on loan in the chat takes those with it, so on a busy PR the next message (seconds later) replaced the home, and the ⋯ menu the reader had just opened vanished with the node.
  While a loan has such an interaction a hidden `span.is-dirty[data-geld-interaction]` stands beside its placeholder at home, the one guard signal settable from outside, kept in step on `toggle`/`focusin`/`focusout`/`input`/`change` (captured) and removed when the loan goes home, so the item refreshes again once the reader is done.
  The `details` a chat opens itself (minimized comments, `openMinimized`, `data-geld-opened`) do not count: they stay open as long as the chat does, and counting them kept the refresh away for the whole time a thread with an outdated comment was open.
  **When that refresh does land while a node is on loan, the loan is GitHub's discarded copy** (`dropOrphanedLoans`, teleport.ts, first thing in every pass): the `replaceWith` took the placeholder with the old container, the fresh container at home holds the item as it is now (a thread with the reply just posted, its comments deferred again), and the orphan — first in document order — shadowed it: the crawl read it, `getElementById` found it, and the fragment fetch that had filled it still counted as that URL being in the page, so the fresh thread was never fetched.
  With the tab visible the hydration of the fresh markup soon ran another pass that rebuilt the panel and dropped it;
  with the tab hidden the one catch-up pass was all there was, and the chat stayed stale or went blank until a reload (mint#12803).
  Dropped before the crawl, the pass sees the fresh item, the open chat re-renders when its thread's fragment lands, and the reply is there.
- **People are named by their login everywhere in the digest, and every name opens their hover card.**
  Where the reader's GitHub shows full names (an account setting, some organisations' default), its links read "Connor Peet (connor4312)", and the crawl took that text as the login: rows read from the timeline showed full names while rows read from the sidebar showed logins, and one reviewer counted as two people ("3 approved" where GitHub counted one, microsoft/vscode#343264).
  `loginOfLink` (`review/login.ts`) reads a person from where the link leads (the profile path, the `/users/<login>/hovercard` URL, else the parenthesis after the name), for `authorOf` and the events headline's actor;
  An App is read from its `/apps/<slug>` path as `<slug>[bot]` (`appLoginOf`), whatever name it shows ("Copilot"), as the API and the Action's payload spell it.
  The panel's name spans carry `whoAttributes` as its avatars do (GitHub's user hovercard, Geld's identity card for an App), and GitHub's own links on loan to the panel (an events list, a comment's author line) show the login too (`showLogins` in the dress phase: a text node "Name (login)" inside a link to that person becomes "login", put back by `onRestore`), so a loaned node still reads the same to the crawl.
- **Comment text keeps its inline formatting, everywhere it is shortened to a line.**
  The crawler's `blockText` writes GitHub's rendered `<code>`, `<strong>`/`<b>`, `<em>`/`<i>` and `<del>` back as Markdown marks (never inside `<pre>`), `firstSentence` (`@geld/review/cluster.ts`) keeps them and ends a sentence only outside a code span, and `@geld/review/inline-markdown.ts` (`parseInlineMarkdown`, `stripInlineMarkdown`) is the one reader of that inline subset — code, bold, italic, strikethrough;
  nothing block-level.
  Every title, preview and pinned first line in the panel is rendered through `review/inline-text.ts` (`inlineText` → `code`/`strong`/`em`/`del` elements;
  `.geld-review__title code` is 0.875em on a chip), the summary comment through `summary-render.ts` `inlineMd` (marks kept, the rest escaped), and plain-text places (tooltips, `aria-label`s) through `stripInlineMarkdown`.
  A new line of comment text goes through one of these, not `textContent`.
  Row words are centred (`.geld-review__main { align-items: center }`), not baseline-aligned: an ellipsised span is a scroll container, which WebKit gives no text baseline.- **Sidebar accordion** (`src/github/ui/tree-section.ts`, CSS section "Full-height accordion").
  GitHub's sticky pane is marked `[data-geld-sidebar]` and becomes a flex column (or keeps its row direction, `data-geld-sidebar-layout` — Primer's pane wrapper is a row of pane + 1px vertical divider, and forcing a column there stacks the divider *under* a content-height pane).
  That direction is measured with our override lifted (`settleSidebarDirection`) and only on a rendered pane: a collapsed file tree is a `display: none` wrapper (Primer's `data-is-hidden`) in which the tree is still found, and the direction is decided by `SidebarSizer` when the wrapper appears or the viewport width changes (never on scroll).
  The observer watches `data-is-hidden` so the pass after expanding re-measures pinned offsets too;
  the wrappers down to the tree are `[data-geld-sidebar-path]`;
  GitHub's `ul` (`[data-geld-tree-list]`) and the open Geld panel's list are the only scroll containers.
  Nothing about its size is written per scroll frame: the pane's height is the scroll-independent `100vh − sticky top` (stylesheet rule keyed on `--geld-sticky-top`, `!important` because GitHub's legacy `diff-layout` element rewrites the pane's inline height on every scroll), so once the pane is stuck its bottom is the viewport bottom, and before that it overhangs the fold.
  The headers below the open panel (`pinSidebarHeaders`, `[data-geld-pinned]`) are `position: sticky; bottom: <height of the headers beneath>` with an opaque background — written inline as well as by the stylesheet rule, after a branch-wide rename once rewrote that rule's attribute and left every pinned header in normal flow below the fold, so during the overhang the compositor keeps them on the viewport edge — no JS, no lag.
  That needs `overflow: visible` on the pane and every wrapper (sticky measures against the nearest scroll container), zero bottom padding and zero flex `row-gap` on them (a gap would be a see-through slit in the stack).
  The one scroll-dependent value is the overhang (`SidebarSizer`, rAF on scroll): it becomes an `::after` spacer (`--geld-overhang`) inside the open list so its last rows can still be scrolled above the headers;
  a frame of lag there is invisible because that area is covered.
  Padding would not do: it is part of the flex item's box and would push the list's end down, feeding back into the measurement.
  Narrow, non-sticky layouts (`stickyTopOf` returns null) keep GitHub's sizing and nothing is pinned.
  **Nothing in the sidebar is measured on the apply path.**
  `apply()` runs after every mutation batch, and while a large diff streams in that is many times a second with a layout GitHub has just dirtied;
  one `getBoundingClientRect`/`getClientRects`/`getComputedStyle` there forces a full layout (20–30 ms on a 124-file diff) on every pass — that was the extension's single biggest cost.
  So the apply path only writes attributes;
  every read (section boxes matched to GitHub's tree, the filter gap, pinned offsets, the overhang) happens in `SidebarGeometry`, a ResizeObserver callback (layout is clean there), reads-then-writes, and `refresh()` is called directly only for structural changes no size reflects (pinned set changed, a section removed).
  `SidebarSizer` takes the pane's rendered state and the viewport width from its observer entries instead of reading them, re-reads the sticky offset/direction only on real resizes, ignores scroll events that do not move the pane, and measures the overhang just after paint (`rAF` → `setTimeout 0`), because a streaming page scrolls itself via scroll anchoring with its layout dirty.
  The same rule holds elsewhere: the header label reads its neighbour's computed font once;
  `headerNodesAdded` only fires for a real "Lines changed:" span outside a diff entry (a streamed file is full of `sr-only` spans), the page-wide header scan is cached until a host leaves the document or such a span arrives, and the head SHA (a regex over GitHub's embedded JSON payload) is read once per page state.
  Profile with a CPU profile attributed to extension frames on `vitest/pull/10554/files` started right after `domcontentloaded` before touching any of this.
- **Hover cards for rows sit beside the pointer, not under the row** (`hovercard.ts` `place`): the rows are a column, and a card hanging below covered the next rows so the pointer could not travel down the list.
  Right of the pointer (left of it near the right edge), top on the row's top, inside the viewport;
  avatar/chip cards still hang from their host.
  Leaving a row toward its card crosses other rows, so a **safe triangle** (leave point → the card's near edge, 6px margin) keeps the card while the pointer heads for it: a row crossed inside the triangle becomes `pendingHost` and is shown only if the pointer settles on it or leaves the triangle;
  `TRIANGLE_GRACE_MS` (600) is the fallback when the pointer stops off the path.
  Straight down the column is outside the triangle, so the next row's card takes over as before.
- **The timeline events row reads its state change at a glance** (`fold.ts` `eventHeadline`, `headlineText`): the last merge, close or reopen among the folded events gives the row its glyph in GitHub's state colour (merged purple, closed red, reopened green), the actor's picture, "merged into main" / "closed this", then "· N timeline events";
  a branch deletion or restore never outranks these.
  A state change posted with a comment is a `closure:<event>` row of its own (`groupClosures`, `ClosureKind` includes `merged`): glyph, picture, login, the comment's first line — no "closed this" in sight, the glyph (`role="img"`, labelled "Closed"/"Merged"/"Reopened") says it, and the row's button keeps the words in a `geld-sr-only` span so its accessible name still reads "X closed this …".
  It is treated as a single comment: the row wears the comment's own ⋯ (`controlSlot`), its slot is `data-solo`, and the chat is rendered headless (`renderCommentChat(slot, comment, null)` → `data-geld-headless`, no byline;
  the words start under the row's name at 72px, as a comment's do under its byline's) since the row above is the header.
  State glyphs use GitHub's own tokens (`--fgColor-closed` / `--fgColor-open` / `--fgColor-done`, so an accessible theme's colours come through) and never change colour under the pointer: the resolved-colour hover belongs to `button.geld-review__status` (the resolve control) alone.
  Fold rows' time cells carry `data-geld-time-for` (`FoldRow.timeAnchor`, the headline event's id or the first node's) so `refreshReviewTimes` ticks them with the page's clocks.
  Opened, the events are set like the commit rows (`quick-view.ts` `compactEvents`): picture, the fewest words ("merged into `main`", the merge commit named only when a commit row follows the merge in the timeline, "deleted the `x` branch", "closed this"), a merge's checks as glyph and counts ("✓ 18 / 18") instead of GitHub's sentence, GitHub's own buttons moved inline after the words with "View details" read as "Details", and the time in the right-hand column;
  the sentence GitHub wrote is hidden whole, its bare words included ("closed this" is loose text between the actor's links, which no attribute hides in place, so it is wrapped in a hidden span and unwrapped on return;
  left alone it showed under the line a second time), and the column rules that lay GitHub's own actor picture out (`a:has(> .avatar)`, `display: flex !important`) skip a link Geld hid, since their `!important` beat the hiding and drew the hidden picture beside the line's own (mint#12609, vscode#343264 showed two);
  rows that keep GitHub's words (labels, assignees, deployments, title changes) only lose their time link to that column, with GitHub's floated button ("View deployment") set inline after the words, whole.
  Every row's first line is 20px and every button on it (Compare, Details, Revert, View deployment) is GitHub's own `btn btn-sm`, 22px tall and overhanging that line by a pixel above and below (negative vertical margins keep its margin box at 20) from one shared rule, so the badge, the picture and the time all sit on the first line (`align-items: flex-start`) however far the words wrap, and the words wrap to their own start, never under the picture — GitHub's two layouts (avatar column, or the avatar inline before a title change) are both given a 28px column.
  Everything is undone when a node goes home.
- **The digest's three levels are told apart by surface and type, never by indent** (every level keeps the same glyph column): a section heading ("2 rounds to review", "Other activity", `.geld-review__group`) is a muted band with 12.5px semibold text - a divider that folds, not a row;
  a row is white at 14px;
  what opens under a row is held to it by a 2px accent rail (`box-shadow: inset 2px 0 0`) along the left edge of the open row *and* its slot, and the headings inside ("1 unresolved thread", "3 bot comments", the commits toggle) are 11px small-caps labels.
  Adding a level means picking one of these treatments, not a new indent.
- **A loaned node must read the same as it does at home, or the panel loops.**
  The panel is swapped whenever its signature changes;
  a swap returns every loan and re-makes it;
  the next crawl reads the nodes where they now are.
  So anything the crawl reads from a node that quick view has moved - its body (`bodyElementOf` searches `wornPiecesOf`), its time (`timeTextOf` remembers each datetime's rendered words *and* each anchor's last read, since a loaned node's `relative-time` can be out of reach of any lookup from its home), its avatar (`normalizeAvatarSrc` pins GitHub's `s=` size, which differs between a header and its row), its order (`compareHome` compares nodes *inside* one loaned subtree by their own position, never 0) - has to resolve identically in both places, and the open comment line additionally wears the words it opened with (`pinOpenEntry`).
  When a row blinks, diff `data-geld-review-sig` between the two states: the field that differs is the reader to fix.
- **What a pass costs is bounded by what changed, and nothing runs in a hidden tab.**
  The controller's observer callback decides in this order: Geld's own elements → nothing;
  `document.hidden` → note it (`hiddenDirty`, the crawl cache is dropped) and return before any DOM read, with the first `visibilitychange` back running one full pass synchronously in the handler, before the tab's first paint, and after 15 s or more away (`CATCH_UP_AFTER_MS`) bringing the page up to date first: the head's checks are read again and the timeline caught up (`catchUpTimeline`, `review/timeline-catchup.ts`: the classic conversation's live marker `#partial-timeline.js-timeline-marker` is replaced from its `data-url`, `partials/unread_timeline?since=…`, which answers the items since then and a fresh marker, exactly as GitHub's socket handler does on `timeline_updated`;
  GitHub's socket goes quiet for a hidden tab, and a bot that finished meanwhile read as running until a reload;
  the timeline catch-up brings new items only, and a reply in an existing thread is not one: it arrives by GitHub refetching the review's own region (`partials/reviews/<id>`, a `.js-socket-channel.js-updatable-content`), and GitHub stops listening once a tab has been hidden 30 s (its visibility handler's timer) and only listens again on return, so the reply never came until a reload, in plain GitHub too (verified with the extension off);
  so back after 30 s or more away (`liveCatchUpDue`, `review/live-regions.ts`) the controller fires `geld:live-catch-up` on the document and the page-world script (`portal.content.ts`) sends every live region the `socket:message` GitHub's socket would have sent (`liveRegionMessages`: `event_updates` naming every region's `data-channel-event-name`, `wait` 100 ms apart so a page of reviews is not one burst), and GitHub's own handler refetches each, with its own check for a region the reader is using;
  the description (`body_updated`, whose region holds Geld's panel and the comments on loan to it) and the timeline marker (`timeline_updated`, which `catchUpTimeline` reads) are left out, as is the batched checks rollup (`expireHeadChecks`);
  the messages are sent from the page's world because a message's `detail` reaches GitHub's handler whole only from there, and asked for by the content script because only it knows whether Geld is active on the page: the whole catch-up on return, checks and timeline included, waits on `mayDressPage` (Geld on, this repository not excluded, not a sign-in page);
  a copy of the content script that starts on a page already open a while (an update or reload of the extension retired the one before and injected this one, which never saw the tab hidden, so the reviews that landed meanwhile stayed missing until a reload) counts the page's age (`performance.now()`) as time away (`catchUp` in `start`): at once when the tab is in view, on the first return when it is not;
  the React conversation has no marker and is left to GitHub) (`schedule`, `apply`, the pre-paint header path and a settings change defer the same way;
  the review panel's own re-apply paths set a flag the catch-up takes, `takeReviewDeferred`;
  the tooltip and hovercard close on hide;
  the sidebar sizer leaves its frame to the browser, which holds rAF until the tab shows);
  a batch that is only clocks (`isClockTick`: text under `relative-time, time-ago, time`) → `refreshReviewTimes()` and nothing else;
  then **regions** (`src/github/regions.ts`): a batch entirely in the document head, the global navigation, the footer or a Primer tooltip (`chrome`, a third of all batches measured on github.com in Oct 2026) schedules nothing, and the rest is classified by the containers the adapters, crawler and list surfaces already know into `lists`, `conversation`, `files`, `header`, with `unknown`, a batch over 300 records, or a change of page state meaning the full pass.
  The debounced pass (`applyScoped` → `runPass(scope)`) skips the files adapters on a conversation-only batch, the review pass and the chips on a files-only batch, and runs the header every time;
  every caller other than the observer gets the whole page (`schedule()` without arguments, `apply()`).
  **Clocks**: current github.com ticks `relative-time` inside its shadow root, which no observer of the page sees, so the panel's time cells (`data-geld-time-for="<anchor>"`, `timeCell` in panel.ts, `timeAnchor` on chat bylines, `FoldRow.timeAnchor` on fold rows) are refreshed every 10 s while the tab is shown (`scheduleTimeRefresh`;
  the page's clocks each tick at their own second, and a fixed minute between reads left a cell a whole minute behind) and by a light-DOM tick;
  the loan watcher ignores clocks and the panel's own cell writes.
  **The crawl re-reads only what a batch touched**: `crawler.ts` keeps each comment's, thread container's and event row's reading in a `WeakMap`, `markCrawlDirty(records)` (called by the controller with every classified batch) marks the comment, thread and event above each record's target through loans (`closestAtHome`) and through GitHub's repeated ids (`markUp` walks every carrier), and `resetCrawlCache()` drops it all.
  **Resolving through GitHub's button in an opened chat**: the classic Resolve answers with the whole thread's resolved partial in a fresh `<turbo-frame>` — header, `data-resolved`, `data-hidden-comment-ids`, and the comments behind a lazy fragment again — swapped in for the loaned node inside the panel.
  The loan watcher (`watchLoans`) adopts the frame as the loan (`adoptReplacements` → `adoptReplacement`, the token moves) and that adoption *is* the state change: judged afterwards, `touchesThreadState` reads the token-bearing newcomer as the panel's own move and the detached old node has no `closest()`, so the record said nothing and the resolved thread sat open in its row until a rebuild for another reason sent the loan home (mint#12367).
  And since the swapped-in container holds no comment until its fragment is fetched once more, `readThread` answers for such a container from `rememberedThreads` — the last full reading, keyed by the deferred URL and by every `discussion_r<id>` it held or names — with the new container's `data-resolved`, re-reading it every pass (`dirty.add`) until the comments land;
  without that the thread left the digest for a second and came back resolved.
  **Idle work** (`lib/idle.ts`, `whenIdle(key, fn)`, keyed so a newer pass replaces a request still waiting, 500 ms ceiling): Jev's batch submission, the diffstat surfaces and re-arming the commit-link tooltip.
  **Storage**: `DiffCache` gathers entries for 250 ms and stores them in one read-merge-write, the worker writes its throttle state once per burst, and a tab hidden when another tab's cache write arrives keeps the latest version and rebuilds its map on the first read after it shows.
  **Measure before guessing**: `lib/perf.ts` times named phases (`phase`, `phaseSince`, `count`) as `performance.measure`s (DevTools Timings track) and a per-tab table;
  the options page's Copy diagnostics asks every GitHub tab for its snapshot (`geld:perf-report`, `lib/perf-report.ts`) and appends one block per tab, nothing written or sent.
  **Each block ends with the script's lifecycle trail** (`mark()` in `lib/perf.ts`, `PerfSnapshot.trail`: `script-start → settings → catalog → controller-start → published`, plus `redirect-early`, `sign-in-page`, `retired:takeover` / `retired:invalidated`), so a tab where Geld showed nothing says where its script stopped;
  a *retired* copy still answers the perf report, late (`RETIRED_ANSWER_MS`), so its trail is what gets reported when no live copy is there, and a copy that retires before its controller ran says so in the trail only (`retired:takeover` / `retired:invalidated`), never the console: a newer copy or a reloading extension is always behind it, and Chrome's Errors page lists every console warning as an error;
  a tab that answers nothing at all is listed as such.
  The background's injection decisions (`ensureContentScript`, `lib/inject.ts`) land in the same session log as `inject <tab> injected|present|failed on=install|activated|popup`, since a second copy taking a page over is how the two-copies flicker began.
  **"Report with diagnostics"** (`report-diagnostics`, extension-only, beside Copy diagnostics) opens a new GitHub issue from the `diagnostics.yml` form with the same report, version and browser filled in and an optional "What was happening?" field;
  it links **straight to GitHub's `issues/new?template=diagnostics.yml`**, not through the site like Feedback does: the report names pull requests (private ones included) and rides in the query, so the only host that sees it is the one the issue goes to, and only when the form is opened — the privacy page's "nothing about your browsing is sent anywhere" holds.
  A URL carries only so much, so `trimReportForUrl` (`lib/diagnostics-report.ts`) keeps the header and the newest lines under `REPORT_URL_BUDGET` (6 KB encoded) with a note, and the whole report is copied to the clipboard first so it can be pasted over the trimmed text.
  Nothing is posted until the issue is submitted, and no sign-in with Geld is needed: GitHub asks for its own if the reader is signed out there.
  Templates are read from the default branch, so the form is live once this is on `main`.
  `local:debugScopes` (set from the harness, never the UI) runs the full pass after every scoped one and logs `[geld] scope disagreement`.
  Numbers at the end of this work (vitest#10554): the review pass 149 ms → 36 ms mean (`checksSection()` used to scan the whole page's text on every call on a merged PR), the crawl 7.4 → 2.9 ms, main-thread time in the first 30 s of the conversation page 4.5 s → 2.85 s, a 14-row `/pulls` page 14 + 12 storage writes → 3 + 4;
  the largest item left is the files adapters' DOM read (`read`, ~13 ms a pass on a 124-file diff).
- **Two layouts** (`settings.groupHidden`).
  Grouped (default): hidden entries are reordered to the bottom with CSS `order` behind the "N files hidden" row, and the sidebar becomes the accordion.
  Inline (`groupHidden: false`): nothing moves;
  hidden diffs are collapsed with GitHub's own control on every pass until the user clicks one (`inlineTouched`), the sidebar keeps GitHub's tree with hidden rows faded (`data-geld-tree-mode="inline"`) and their file icon swapped for the category icon.
  Adapters expose `expandEntry`/`collapseEntry`, which return `false` when the header has not rendered its control yet (rich diffs render in two steps).
- Two adapters read GitHub's DOM: `views/legacy.ts` (classic Turbo/web-components diff view) and `views/react.ts` (commit pages and the newer PR files experience).
  Selectors were verified live against github.com in Sep 2026;
  the signed-in React PR files view was verified only indirectly (same components as commit pages).
  GitHub Enterprise Server was not tested against a real instance.
- **The React files view's experimental mode for large PRs (`/changes?mode=virtualization`, offered by a banner in "single file mode") is a virtualised list** (`DiffView.virtualized`, detected by the container's parent `[data-testid="virtualized-diffs-list"]`): the container is a spacer as tall as the sum of GitHub's height estimates, only the rows near the viewport are mounted (`[data-index][data-path-digest]`, `position: absolute; top`), and their `top`s are recomputed from measured heights, so `entries` is never the whole diff and flex `order` cannot gather anything.
  Grouped layout there (`applyVirtualView`): hidden files vanish *in place* — a `display: none` row measures 0 and the virtualiser closes the rows below over it (its own 16px gap per row remains) — and, since rows mount between passes, the hiding is declared once in a stylesheet keyed on each hidden file's anchor (`ui/virtual-hidden.ts`, one `:has(> [id="diff-…"])` rule per file, from the tree, which lists every file and links each to its `#diff-…`) so a hidden row is never painted at its estimated height first.
  What is hidden is decided from the tree, not the mounted rows;
  the "N files hidden · Show" row *leads* the list (`placement: 'lead'`, prepended to the list, `order: -1`;
  nothing is gathered below it) and is rendered after the header totals so it counts the whole diff;
  "Mark as viewed" is not offered (only mounted rows have the control);
  the sidebar accordion works unchanged (no tree row is "pending").
  Revealing a file (`seekEntry`): GitHub's own tree item is clicked (`activateTreeItem`) — it scrolls the list to the file and mounts the row, precisely — but selecting the already-selected file does nothing, so a neighbour is selected first (`detoured`), and because rows Geld or GitHub measure on the way (a large diff loading, comment rows folding) shift everything below without the list re-anchoring, the row can slip away before a pass sees it: after `VIRTUAL_NAVIGATION_PASSES` without it the item is asked again, each landing nearer.
  `finishReveal` marks and aligns the *live* row (`liveEntryRoot`: the virtualiser remounts a row it re-measures, so `entry.root` may be detached by the next frame).
  Verified on `OpenCut-app/OpenCut#479` (221 files) in Sep 2026.
  Inline layout (`groupHidden: false`) needs nothing special: collapsing with GitHub's control re-measures the row.
- Line counts come from the page when it renders per-file diffs;
  otherwise (PR conversation tab, PR lists, partially loaded large PRs) the background fetches the same `.diff` GitHub serves, via `entrypoints/background.ts` (needed because github.com redirects to `patch-diff.githubusercontent.com` without CORS).
  Parsed diffs are cached in `storage.local` as `github:{owner}:{repo}:{pull}:{sha}` (`…:commit:{sha}` for commits;
  `github@{host}:` on Enterprise);
  writing a new SHA for the same pull drops the old one.
  **Header counts on PR/commit pages come only from that diff, never from the DOM**, so they change at most once (GitHub's number → ours);
  **A Files tab narrowed to one commit or a range** (`/changes/<sha>`, `/files/<before>..<head>`) reads that commit's diff (`/commit/<sha>.diff`) or the range's (`/compare/<before>..<head>.diff`, the direct comparison of its ends), keyed by that commit or the range's head (`PageInfo.commits`, `narrowedHead`), and the header settled for one diff is never re-asserted on another (`settledHeader.diffUrl`): it used to read the whole pull request's diff there, so every commit and range showed the pull request's counts.
  Only the diff is keyed by the narrowed commit (`diffShaFor`): a review sent from that tab still names the pull request's head (`headShaFor`), since GitHub reviews the pull request, not the commit in view.
  DOM totals are used only where no commit key exists (compare pages).
  The head SHA is read once per page from GitHub's embedded payload (`detectHeadSha`) and cached — except on the conversation tab, where the timeline's last commit row is the head (GitHub's socket appends a pushed commit's row live while the stale-comparison poller keeps the head the page loaded with, so a tab left open across a push read the old head's checks and never saw the new run, geld#71): `conversationHeadSha` takes only a commit row's own link (`COMMIT_ROW`, mirrored from the crawler) to this pull request's commits, or a force-push row's target (`FORCE_PUSH_ROW`, its `compare/<from>..<to>` link in this repository — a rewrite can land as that one row with no commit row of its own) — a commit URL pasted in a comment is not a push — ordered by `compareHome`, since the digest loans the newest rows into a slot above the timeline, and both the review pass and the controller's `headShaFor` read it every pass, the controller re-keying the diff and header counts when it changed as `onFilesRefresh` does;
  the React files view reloads its data in place on the "new changes" refresh without touching that payload, so `watchFilesRefresh` (a `PerformanceObserver` on resource timing, which sees the page's own `changes?_json=1` fetch from the isolated world) asks GitHub's Commits-tab JSON for the newest commit (`fetchHeadSha`) and re-keys the diff when it changed.
  The content script runs at `document_start` and rewrites the header synchronously inside the MutationObserver callback (before paint) whenever a settled or cached value exists, because GitHub's React header re-mounts several times while a page streams in.
  **Rate limiting is the failure mode to design against**: GitHub's `.diff` endpoint serves roughly 45–48 requests in a burst and then answers 429 to *everything* for a minute or more (no Retry-After), so two unpaced list pages used to blank every row and every PR page opened during the block.
  The background therefore paces diff fetches through a persisted sliding-window budget (`DIFF_BUDGET` per `DIFF_WINDOW_MS`, `local:diffThrottle`;
  requests wait for a slot rather than fail), and a 429/403 starts a cooldown that doubles per consecutive strike (60 s → 15 min cap, or Retry-After when given) and is reported to the content script as `retryAfterMs`, which schedules the row's retry just after it.
  **The page's own subject comes first**: a request carries `priority` (`page` = the header of the pull request or commit being read, a commit the reader hovers;
  `background` = list rows and refreshes of stale counts), `PAGE_RESERVE` slots of the budget are only for `page` requests, and a `page` request goes to the front of the content script's queue, so opening a pull request after browsing a list never waits out the window behind rows.
  **The diff host also answers 503 in waves** (GitHub's "Unicorn!" page from `patch-diff.githubusercontent.com`, measured: seven of eight concurrent requests one minute, ten of ten fine the next).
  That is a busy pause for the rows (`BUSY_COOLDOWN_MS`, growing only when the next wave follows the pause;
  every answer within a wave is the same pause, not a longer one;
  any success ends it), never a strike, and the page's own subject is not held by it: it probes through and asks again on `PAGE_BUSY_RETRY_MS` (1.5 s, 3 s, 6 s, 12 s).
  A page github.com serves in a diff's place (its sign-in wall, an organisation's SSO prompt "Sign in to Mintlify", an interstitial) reads as `signed-out` by its title and **gives its budget slot back** (`refundTurn`): it never reached the diff host, and charging it meant a lapsed SSO session cost a page of rows the whole budget, so every row waited out the window after signing in again.
  The options page's "Copy diagnostics" log records each fetch's outcome, status and answering host.
  **The page's own pull request has a second source for its header:** the diff host answers 503 for a minute or more to a pull request whose `.diff` nobody has asked for yet (a freshly opened one, measured: nine 503s over 75 s for a single request), so the moment a `page` request comes back anything but ok, `DiffSource` fetches GitHub's own files-tab data (`/owner/repo/pull/N/changes?_json=1`, same origin, session cookie, `payload.…diffSummaries[]` with `path`/`changeType`/`linesAdded`/`linesDeleted`;
  `@geld/core/diff-summaries.ts`) and reports it as a `provisional` ready state;
  the diff keeps retrying and replaces it when it lands (same numbers, plus binary/whitespace/comment facts), and nothing provisional reaches the disk cache (one exception: a diff the worker calls too large never lands, so its summaries are kept under the head's key).
  The summaries URL is the pull request's, not the head's, so they are asked **once per head** (`summariesHead`, per diff URL: the SHA asked for, or null before the page knew it — a later request for the same head with the SHA re-uses that answer;
  a request under a *new* SHA, the files view's "new changes" refresh re-keying the diff without a reload, drops the old head's `provisional` and `tooLarge` entries and asks again, and an answer to an earlier ask (`summariesAsk` generation) is discarded so an old head's counts never show as the new one's;
  `diff-source.test.ts`).
  The worker is stopped after ~30 s idle, so its in-memory diff cache is short-lived;
  the content script's disk cache (`DiffCache`) is what avoids refetching: SHA-keyed entries for pages (`github:{owner}:{repo}:{pull}:{sha}`, exact and never stale), plus `…:{pull}:latest` entries for list rows — the list markup carries no head SHA (verified: none in the page), so these are served stale-while-revalidate: shown for up to 24 h so a row is never blank, refreshed through the budget once older than 30 min, and a SHA-keyed write (opening the PR) refreshes `latest` too.
  A failed revalidation keeps the stale counts on screen.
  Four concurrent fetches per tab, only for rows near the viewport.
  **No GitHub API is used.**
- Browsers do not inject content scripts into tabs that were open before an install/update.
  `src/lib/inject.ts` puts Geld there on demand: the background injects into every open GitHub tab on `onInstalled`, into a GitHub tab on `tabs.onActivated` when it does not answer a ping, and when the popup gets no answer (`geld:ensure-content`, then one retry).
  The content script dispatches a `geld:takeover` event on start so an older copy still running in the page retires (and `ctx.onInvalidated` retires orphans), so there is never more than one active instance.
  **A retired copy must be inert and must keep answering the ping.**
  Inert: `controller.stop()` → `teardownReviewOverview()` nulls `lastSettings` (the overview's "mounted" sign), drops the pending `reapplySoon`/`fragmentLanded` timers and aborts the fragment fetches in flight (`fragmentAbort`);
  every asynchronous re-apply (`reapplyNow`, `reapplySoon`, `fragmentLanded`, the AI run's `reapply`) checks `lastSettings` first.
  Before that, a retired copy's in-flight fragment landed, `fragmentLanded` asked for more fragments and remounted *its* panel over the live copy's, which rebuilt its own, and the two — each with its own `visit` memory of what was open — took turns on the page every few seconds for as long as fragments remained (seen as the Reviews row and the resolved-threads group opening and closing by themselves, with two builds' counts alternating).
  Answering: `github.content/index.ts` registers `onMessage` before its first `await` (so a ping during settings load is answered with `IDLE_STATE`, not met with silence and a second injection) and never removes it;
  once retired it answers `get-tab-state`/`toggle`/`reveal` with `IDLE_STATE` after `RETIRED_ANSWER_MS` (a live copy in the same world answers synchronously and wins;
  with two Geld builds installed — store plus unpacked — the loser's idle answer is what keeps its background from re-injecting it over the winner, which would retire the winner, whose background would then do the same…), and sends one idle `geld:tab-state` so its badge clears.
  `ensureTab` (background) also skips tabs whose `status` is `loading`: the declared script arrives with the document, and an injection on top would only create a second copy.
- Settings live in `storage.sync` (`src/lib/storage.ts`, writes serialised).
  Categories are opt-in except tests (and the user's own categories, which default on).
  Every built-in category has `groups` (off-switches per pattern group, keyed `category/group`) and `categoryPatterns` (extra lines incl.
  `!` rescues, scoped to that category);
  `customCategories` hold user-defined ones (`custom:<slug>` ids, title, Octicon name from `category-icons.ts`, patterns, optional nouns) and are matched first.
  Legacy `testGroups`/`customPatterns` migrate in `normalizeSettings`.
  Repo rules are gitignore-style (`owner/repo` off, `!` on, last match wins).
  Pattern lists support `[owner/repo]` scope headers.
- **The pattern catalog updates without a store release.**
  The built-in categories, their groups and globs are authored once, in TypeScript (`@geld/core/categories.ts` + `test-patterns.ts`), wrapped as `BUNDLED_CATALOG` (`Catalog` = `{ version, minExtensionVersion, categories }`).
  `pnpm catalog:build` generates `catalog/patterns.json` from it and `pnpm catalog:sign` writes `catalog/patterns.sig` (Ed25519 over the file's exact bytes, private key in the `GELD_CATALOG_PRIVATE_KEY` env var, held by the owner outside the repo;
  `pnpm catalog:keygen` prints a new pair, the public half lives in `catalog-key.ts`).
  CI runs `pnpm catalog:check`, which fails when the JSON drifted from the TypeScript or the signature no longer matches.
  A pull request from this repository that changes patterns would always fail that check (its committed `.sig` is stale and only the push to `main` can commit a new one), so the PR run first regenerates and signs the catalog in the workspace with the same secret, committing nothing;
  a fork's PR gets no secrets and still shows the stale signature.
  **The key never shares a runner with pull request code:** two jobs precede `check-and-pack` on a same-repo PR — `catalog-build` (the branch's checkout, no secret) runs `catalog:build --auto-version` and uploads `patterns.json`, the bumped `categories.ts` and `catalog-key.ts` as an artifact;
  `catalog-sign` checks out the *default branch*, downloads that artifact and runs `node scripts/catalog-sign.mjs` with `GELD_CATALOG_PRIVATE_KEY` (nothing from the branch executes there: no install, no pnpm, the artifact is data the signer reads), uploading `patterns.sig`;
  `check-and-pack` downloads both over its tree before `pnpm check`.
  Splitting *steps* was not enough — anything a branch runs earlier in the same job (pnpm scripts, a `node` on `$GITHUB_PATH`, a process left behind) can reach a secret a later step holds.
  **Publishing a catalog change:** edit the TS → bump `CATALOG_VERSION` (`YYYYMMDD`, or +1 for a second release that day;
  the build refuses a content change without a higher version) → `pnpm catalog:build` → `GELD_CATALOG_PRIVATE_KEY=… pnpm catalog:sign` → commit all three.
  Installed extensions pick it up within a day; **the site renders from the bundled TS, so it needs a deploy** (core changes trigger one on Vercel).
  **Ids are permanent:** settings and gists refer to `category` and `category/group` ids, so the build fails if an id from the previous committed `patterns.json` is missing — deprecate a group by emptying its `patterns`, never by deleting it;
  adding a *category* still needs an extension release (it needs a default, and `resolveCatalog` ignores categories the build does not know).
  **Trust model** (`@geld/core/catalog.ts`): the extension (`src/lib/catalog.ts`) fetches the two files from `api.github.com` (contents API, raw media type — already a host permission;
  `raw.githubusercontent.com` would need a new one and disable the extension in Chrome until re-approved) on install, on browser start (at most every 6 h) and via a daily `alarms` alarm, verifies the signature *before* parsing, validates the whole document (`parseCatalog`: shape, `[a-z][a-z0-9-]*` ids, known icons, every glob compiles), and stores it in `storage.local` (`local:catalog` = `{ version, fetchedAt, json }`) only if `minExtensionVersion` ≤ the manifest version (first three numeric parts) and `version` is higher than the active one.
  `resolveCatalog(bundled, fetched)` takes content (groups, globs, titles, descriptions, icons, nouns) from the fetched file and policy from the bundled one — `defaultEnabled` and the set of categories can only change in code, so a remote file can never turn a category on for everyone;
  groups are unioned so nothing a setting refers to disappears.
  A 403/429 backs off until GitHub's `x-ratelimit-reset` and is not shown as an error;
  every other outcome lands in `local:catalogStatus`, which the options page's "What to hide" card shows ("Built-in patterns (v…)" / "Patterns updated … (catalog …)", "Check now", last failure reason).
  `autoUpdatePatterns` (General, extension only) opts out;
  "Check now" still works.
  Everything that lists or matches built-in categories takes the catalog as an argument (`createMatcher`, `allCategories`, `categoryById`, `describeAdvancedSettings`, `validateSettingsDocument`, `readRemoteValidated`…), defaulting to `BUNDLED_CATALOG`;
  the content script, popup and options page `loadCatalog()` on start and `watchCatalog()` for changes.
  The pure parts (parse, verify, resolve, version compare) are in core and unit tested;
  only the fetch/cache/alarm wiring is in the extension.
- **GitHub sign-in is the Geld GitHub App's device flow** (`@geld/github/auth`, no secret, no server);
  settings sync to a secret gist orchestrated by `src/lib/account-service.ts` in the background.
  Client id comes from `WXT_GELD_APP_CLIENT_ID` (`.env`, CI variable) or the options override;
  tokens live in `storage.local` only (`local:githubAccount`, versioned item).
  App tokens expire after 8 h with a 6-month refresh token that **rotates on every use**, so the background is the only refresher: every gist call goes through `withToken`, which renews five minutes ahead via `createTokenSource` (single in-flight refresh) and retries once after a 401;
  device-flow tokens refresh without a client secret.
  A refused refresh (`bad_refresh_token`) signs out;
  an unreachable GitHub keeps the token and retries later.
  The App was registered in Sep 2026 with Metadata/Contents/Checks/Commit statuses **read**, Pull requests and Issues **read and write**, Gists (account) read and write, device flow on, expiring tokens on;
  Contents write is deliberately not requested (see the dashboard plan).
  **Migration from the OAuth App:** accounts stored by older versions migrate to `auth: 'oauth'`, keep syncing (those tokens never expire) and get an undismissable "Sign in again" notice (`RECONNECT_COPY`) in the popup, options page and geld.sh until the user reconnects;
  the extension just forgets the old token (revoking needs the client secret), the site revokes it with the legacy `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` while those are still configured.
- **Settings are described once, in `@geld/core/settings-schema.ts`** (`SETTINGS_SCHEMA`): sections, fields (`toggle`, `categories` — switch plus an "Advanced" disclosure with group checkboxes and extra patterns, opened on load only when `hasAdvancedSettings` — `custom-categories`, `list`), copy, placeholders, a `popup` flag (also show in the toolbar popup) and optional `surfaces` (`extension` / `site`) for fields that only make sense in a browser (badge, shortcut, Enterprise hosts, which need permission prompts).
  The popup renders `fieldsFor('extension', true)`, the options page fills its cards (`data-section="…"`) from `sectionsFor('extension')`, and geld.sh renders `sectionsFor('site')`.
  Add a setting by extending `GeldSettings`, `DEFAULT_SETTINGS`, `normalizeSettings` and the schema — the schema test fails until every boolean/list key is covered.
  **Features still taking shape live in the `experiments` section** (today: the pull request conversation digest — `prOverview`, `compactTimeline`, `collapseDescription`, `reviewBots`, `suggestedFixes`, the AI gateway fields), off by default and kept out of the popup (`popup: false`, no link — experiments are not advertised until they are ready;
  the options page and geld.sh render the section like any other and people find it there) with one exception while the digest is under active test: `prOverview` is `popup: true`, and the popup draws the section's title as an "Experiments" eyebrow above any popup field from that section, so an experiment is never taken for a settled setting.
  Ship an experiment by moving its fields to the section they belong in.
  Copy may use `backticks`;
  render them with `splitInlineCode`.
  The options page renders the experiments card as one `options__stack` of `options__block`s in schema order (one rule between blocks, the same air on both sides — never a mix of dividers and margins);
  the AI fields are built by `renderAiFields` in the order they are needed.
- **AI is two tiers behind one switch.**
  `aiEnabled` is the master switch: off, nothing is requested whatever else is set;
  on, it takes effect only once `aiBaseUrl`, `aiModel` and the gateway key (`local:aiKey`) are all there, otherwise it behaves as off (`aiConfigured`).
  `aiBaseUrl` is normalised by `normalizeAiBaseUrl` (trailing slashes and a `/v1`/`/v2`/`/typesafe` tail come off;
  every request adds its own `/v1/...`);
  the field offers presets (Vercel AI Gateway, OpenRouter, OpenAI) that save on click, and a pasted URL saves itself once typing pauses.
  Saving the URL or the key loads `/v1/models` into the model `<select>`, which sits disabled with the reason above it until both exist (and offers an "Allow Geld to contact the gateway" control when Chrome has not granted the origin — `permissions.request` needs a click);
  the list is cached in `local:aiGateway` with the id of the gateway's Jev model, if any.
  **The prose tier** (`aiModel`: consolidation, TL;DR, fixes) is any chat model; **evaluation models are never offered for it** (`isEvaluationModel`: Jev produces no text, and picking it made every consolidation fail — and, before `attempted` in `ai.ts`, retry on every pass, shimmering the rows on and off).
  **The decision tier is Jev** (`aiJev`, `@geld/review/jev.ts` + `decisions.ts`): TypeSafe's System One model answers typed questions (`noul` yes/no probability, `choice`, `score`) in one parallel pass, reached through the gateway when it serves Jev (`jevEndpoint`/`jevModelFor` in `jev.ts`: Vercel's TypeSafe-compatible API `{base}/typesafe/v1/systemone` with model `typesafe-ai/jev`, listed in its `/v1/models`;
  OpenRouter's Decisions API `https://openrouter.ai/api/alpha/decisions` with `typesafe/jev-latest`, which its `/api/v1/models` does *not* list — hence the `KNOWN_JEV` host table, consulted when the list names none;
  other gateways get the TypeSafe-compatible prefix), else directly at `https://api.typesafe.ai/v1/systemone` with the user's own key (`local:jevKey`;
  `local:jevSource` = `gateway` | `own` says which wins when both exist — "Use one anyway" sets `own`, "Use the gateway's Jev" or clearing the key sets `gateway`;
  the field and the note are hidden while `aiJev` is off, the field opens when the gateway lacks Jev or `own` is chosen).
  TypeSafe's own docs call it a "TypeSafe API key" (`TYPESAFE_API_KEY`, from console.typesafe.ai).
  The model picker is `src/ui/model-combobox.ts` (WAI-ARIA combobox: filter by id/name/maker, arrows, Enter, an unlisted id can still be typed);
  options show what the gateway's `/v1/models` says for free (`ModelInfo`: maker, context window, tags;
  Vercel types Jev as `evaluation`, which `isEvaluationModel(id, type)` honours).
  Opened empty, the picker leads with the models `@geld/review/model-guide.ts` recommends for the digest's writing (`RECOMMENDED_MODELS`, matched on the id's *tail* since Vercel spells `zai/` where OpenRouter spells `z-ai/`), each with its reason;
  every option shows Geld's rough intelligence and speed tiers (`tiersFor`, a hand-kept family table, marked "not a benchmark" in the list — no gateway lists these and the benchmark sources sit behind API keys) and, for a variant suffix (`-flash`, `-fast`, `-flashx`, `-pro`, `:batch`, `:free`, `-preview`, `-codex`…), what it means (`variantOf`);
  plain models sort before their variants (`pickerRank`).
  Keep the guide current with releases: it is opinion, kept short on purpose.
  Today's decision: before consolidation, `sameProblemRequest` asks Jev which pending items report the same problem;
  only items with a partner go to the prose model (`withSameProblem`, each told its `sameProblemAs`), singletons keep the reporter's wording;
  without Jev everything goes to the prose model as before.
  **The prose tier runs only when the reader asks** (the sparkle control in the Geld row, `aiButton` in panel.ts → `runAi` in `ai.ts`), never on its own: the GitHub App is not a prerequisite for AI, and neither is it required for the button (it shows whenever the switch, URL and model are set).
  What the model writes is stored on this device per pull request (`local:aiRuns`, `AiRunRecord` keyed `github[@host]:{pageKey}`, capped at `AI_RUNS_CAP` runs, oldest out), hydrated at the start of a visit (`loadAiForPage`, the pass re-applies when it lands) and layered by `withAi`, so titles and the TL;DR survive reloads and cost nothing until something new arrives.
  Nothing is posted to GitHub, so nobody else sees a local run.
  `aiStateFor` gives the panel its state: `ready` ("Triage with AI"), `running` (the sparkle pulses, rows shimmer), `current` ("AI · 2 hrs ago"), `stale` (a notice: comments or threads arrived since, from `planConsolidation`'s pending set and `summaryIsCurrent`, with "Triage the new changes"), `failed` (the run's reason from the worker, e.g. the missing gateway permission or an HTTP status, with "Try again": a silent failure used to look like AI doing nothing), and `app` when the digest comment's `producer.ai` is true, in which case the Action's digest wins (`composeMeta` layers nothing local over it) and, if this device still holds a run, a notice offers to clear it (`clearAiForPage`).
  **With `aiJev` on, Jev is the stand-in for the deterministic classification** (`jevDecisionsFor` in `ai.ts`, `classificationRequests` in `decisions.ts`): one request per batch of 24 with the top-level comments and open multi-comment threads as *structured* state (`{ comments: [{id, author, bot, text}], threads: [{id, path, first, replies}] }`, the questions naming fields in backticks as TypeSafe's docs ask), a `choice` lane per comment (`trigger` / `status` / `verdict` / `report` / `finding` / `discussion`, criteria in `LANE_CRITERIA`) and a `noul` "do the replies say it is done" per thread.
  Only a lane with confidence ≥ `LANE_CONFIDENCE` (0.6) is used;
  a comment made of *known* trigger phrases is a trigger whatever Jev says (`isTrigger`: deterministic OR Jev, Jev adds the phrases the list lacks);
  a bot's `status` line folds silently like a trigger;
  a `finding` sorts first in its round with the alert glyph;
  a thread at ≥ `DONE_THRESHOLD` (0.9) becomes `addressed` through `applyAddressed` (still an open status, shown as addressed);
  a preview deployment whose status the parser left `unknown` gets a `choice` over every preview state plus `unknown`, and Jev's answer is taken as given (`previewStatusesFrom`, no confidence gate — it was offered "unknown").
  Answers are cached in `local:jevDecisions` by a hash of author+text (identical "Starting Devin Review." comments share one entry), capped at 3000, and each hash is asked at most once per visit;
  the pass runs from the cache synchronously and re-applies when new answers land (`reapplySoon`), so the first visit shows the deterministic view for ~300 ms and later visits never flicker.
  Jev off gives exactly the pre-Jev counts.
  Test against a mock: patch `fetch` and `chrome.permissions.contains` in the service worker (`/tmp` harness `sw-mock.js` pattern) - the real call needs the permission prompt.
  Not yet Jev-backed: bot verdict parsing (`bots.ts` regexes) and the Action side (no Jev inputs).
- **The gist format is shared too:** `@geld/core/gist-sync.ts` owns the file name (`geld-settings.json`), the `{ geld: 1, savedAt, settings }` payload (also what Export/Import uses), `settingsEqual`, and the read/find/write calls.
  Read with `readRemoteValidated` wherever a person can be told about problems;
  `readRemote` is the lenient variant for code that only needs a best-effort value.
- **Hand-edited settings are validated, not silently repaired.**
  `@geld/core/settings-validate.ts` (`validateSettingsDocument`) scans the whole file and returns every issue with a path (`settings.categories.tests`, `settings.customCategories[1].icon`, line/column for JSON syntax via its own scanner).
  Unknown keys are ignored on purpose so a newer version's settings never look like corruption to an older one, and so are *well-formed* category/group ids the active catalog does not know (a gist may have been written against a newer catalog or a newer Geld);
  ids are still checked for shape and values for type, and `normalizeSettings` keeps such group keys rather than dropping them.
  When the gist is invalid the extension sets `syncState.remoteInvalid`, pauses sync both ways, and shows the alert whose copy is `CORRUPTED_SETTINGS_COPY` (Open gist / Reset to default settings / Check again);
  the site should render the same from `readRemoteValidated`.
  Reset writes `DEFAULT_SETTINGS` to the gist and this device.
  Rollback to a previous revision is left to the gist's own history rather than tracked by Geld.
- **One built-in category is decided from the diff, not from paths: `trivial` ("Trivial changes", `@geld/core/change-kinds.ts`).**
  Its groups are change kinds — `renames`, `modes`, `binary`, `deleted`, `whitespace`, `large` — with empty pattern lists.
  `parseUnifiedDiff` tags each `FileStats` with the kinds it can see (`kinds`, absent when none;
  `large` follows from the counts via `changeKindsOf`).
  `PathMatcher.categorizeFile(facts)` / `explainFile` weigh those after every path category (`usesChangeKinds` says whether they can differ from `categorize(path)`);
  the header/PR-list path (`breakdownFromFiles`) passes the diff's `FileStats` directly, and `GeldController.classify` looks entries and tree rows up in `diffFacts` (the page's diff by path, requested whenever the category is on) falling back to GitHub's displayed counts.
  The React adapter reads a renamed file's *new* path from the heading's screen-reader sentence, since the diff and the tree know it by that name.
  Do not reuse the id `changes` for a category: the sidebar's own "Changes" panel is keyed on it.
- **Preview deployments are a row of their own** (`@geld/review/previews.ts`, `Previews` status row in `panel.ts`).
  Hosting bots post one comment per project or a table of projects and edit it in place;
  `parsePreviews(doc)` reads them into `{ host, project, status, url, inspectUrl, anchor }` from a `PreviewDoc` (text + links + images) that the Action builds from markdown (`previewDocFromMarkdown`) and the extension from the rendered body (`previewDocOf` in crawler.ts — which writes a rendered table's rows as `| a | b |` lines via `textWithTableRows`, the shape markdown has, so a status cell is found beside its project on the page too).
  Hosts and their shapes are documented at the top of `previews.ts` and pinned by fixtures in `__fixtures__/previews/` taken from public PRs: Vercel (a `[vc]: #sig:base64` header with `projects[]` in markdown, dropped by the renderer, so the table is parsed too), Netlify, Cloudflare Pages/Workers, Mintlify, Railway, Render, Amplify, Azure SWA, Read the Docs, Chromatic, CodeSandbox, pkg.pr.new, and a generic "Preview URL + link" shape for Actions.
  `latestPreviews` keeps the newest per `host:project` (comment order is timeline order) and archives the rest.
  The Action ships them as `meta.previews`;
  the page's parse wins for comments both know.
  The row carries a pill per current preview (host avatar, project, state glyph;
  a link to the preview), wrapping like the bots' pills;
  open, one line per preview with Open/Inspect (static rows: no hover surface, no pointer;
  they start at the row edge so their state glyph stands in the header glyphs' column).
  The row's own glyph is Octicon `rocket`, GitHub's mark for deployments, then "N archived previews from earlier pushes" behind a heading.
  A push's row (batch grouping) has room for one summary pill — the hosts' marks overlapping and "N previews" — and shows the named pills in a strip once open.
  The row tints only when a preview failed.
  Pills wear the same state glyphs as the CI breakdown and the per-preview lines (`PREVIEW_GLYPH`: check, x, Primer's spinner, skip);
  a skipped deployment's pill is faded with a `not-allowed` cursor and is not a link (its line keeps Inspect).
  `ICON_IN_PROGRESS` is Primer's Spinner markup and needs `fill: none !important` — GitHub's `.octicon { fill: currentColor }` otherwise fills its track into a dot.
- **Reporter bots have a row of their own, `Reports`, shown only when one has posted** (`@geld/review/reporters.ts`, `reportsRow` in `panel.ts`).
  A reporter is a CI-side tool that posts a *report* on the PR (Blacksmith: "Found N test failures on Blacksmith runners" with the failing tests and logs;
  coverage and bundle-size bots fit the same shape) rather than a review of its code, so it is neither a review bot (no verdict, never a finding, never an approval) nor CI (the checks row already shows the failure;
  the report explains it).
  `REPORTERS` lists each with its logins and a `read(body)` that turns the comment into `{ state: failed | passed | info, headline, count? }` or null when the comment is not a report;
  `reportsFrom` reads the page's bot comments, `latestReports` keeps one per reporter (Blacksmith posts one per push and minimizes the old ones;
  earlier reports stay in their rounds as bot comments, **the latest is seated under the Reports row only** — `reportLineAnchors`, the same treatment as a bot's latest summary: `seatFor` answers `{ REPORTS_KEY, sub }`, the comment is `seatedElsewhere` in its round, bounding it but shown nowhere in it).
  Socket's readings: "Review the following alerts" (failed, Block/Warn/Monitor rows counted), "All alerts resolved" (passed), "New and removed dependencies detected" (info), and its dependency diff "Review the following changes in direct dependencies" (info, one table row per changed package — the reference `npm/@scope/name@version` counts them, written with zero-width spaces in the page's text and linked in the raw Markdown;
  scoped names start with `@`).
  The row is a pill per report (mark, title, headline, state light), red while one reports failures;
  a pill or the chevron opens the row to one line per report, and a line opens its comment in place as a one-bubble chat (`renderReportsList` → `renderCommentChat`), so the failing tests and their logs are right there.
  A pill click goes through `onOpenReport`, not `onOpenAnchor`, so it lands in this row and not in the round that also holds the comment.
  **Check reporters** (`CHECK_REPORTERS`, `readCheckReport`, `reportsFromChecks`) are services that report through a commit status or check run instead of a comment.
  A *commit status* links to the service's site and is known by that host (and, for a shared pages host, its path).
  A GitHub App's *check run* links, in the React merge box, to GitHub's own checks tab (`/pull/N/checks?check_run_id=…`;
  the external Details link is only on that tab), so it is known by the App's own name for it (`checkNames`: "Socket Security: …", `codecov/patch`), read only behind such a link, or by its words when no name is stable (code scanning: "…in code changed by this pull request");
  the App named the check, not the repository.
  A GitHub Actions job links to `/actions/runs/…` and never matches by name, so a job called "Chromatic …" or "Socket Security" is CI, not a report.
  The merge box prefixes a check run's words with its timing ("Failing after 7s — …"), which `readCheckReport` strips first.
  `crawlCheckRuns` now carries each row's `detailsUrl` and GitHub's one-line `description`;
  the report's project comes from the name ("UI Tests: mint" → mint), its headline from the description with GitHub's own words ("Failing after 6m") replaced by the state, skipped/cancelled/neutral runs and the reporter's `ignore`d statuses (Chromatic's "Storybook Publish") report nothing.
  A report's pill says its *short form* (`ReportReading.short`, `ReportPart[]`: "4 changes", "62.50% (+0.03%)", "✗ 2 ✓ 41" with per-part glyph and tone for counts of several kinds, empty when the words are only a verdict so the state light says it alone);
  the line under it says the service's whole sentence.
  One report per reporter and project.
  Bundled: Chromatic (`UI Tests: project`), Percy (`percy/project`), Codecov (`codecov/project`, `codecov/patch`, flags as a third segment: the facet is the project), Sonar (`sonarcloud.io`/`sonarqube.*`, no project), Snyk (`security/snyk - manifest (org)` → the manifest), Cypress Cloud, Argos, Happo, Applitools, Lost Pixel, Lighthouse CI (`googlechrome.github.io/lighthouse-ci/…` only;
  a self-hosted LHCI server has no host to know).
  **Security tools are reporters too** (a security *review* bot that opens findings, Bugbot's appsec, is a review bot instead): Socket (`socket-security[bot]` comments: "Review the following alerts detected in dependencies" over a table whose rows start with the policy action in bold, counted as alerts with the Block ones as a red-dotted count;
  "All alerts resolved";
  the "New and removed dependencies detected" overview, counted as new packages;
  plus its `socket.dev` checks, where "Project Report" and "Alerts: Skipped" report nothing), GitGuardian (comment "GitGuardian has uncovered N secrets", check `gitguardian.com` "N policy breaks detected"), Semgrep (`semgrep.dev`), Aikido (`aikido.dev`, facet after the colon), Gecko (`gecko.security`) and GitHub's own code scanning, whose Details is a plain `github.com/…/runs/N`: a check reporter may require a `description` pattern too ("…in code changed by this pull request"), takes the tool's name as the project (CodeQL), and reads its `state` from the words ("2 new alerts" passes GitHub's check below the failure threshold but is a failed report here).
  `rephrase` strips a service's preamble ("Pull Request #12 Alerts: ").
  A comment body reaches the reporter as the page's block text (bold as `**`, a table row's cells glued on one line), so comment readers match that form as well as raw Markdown.
  **A service that both comments and sets a check is shown once, as the comment** (`latestReports`: a check never replaces a comment under the same `reporter:project` key), since the comment holds the details and opens in place.
  The line has no comment to open: its Open leads to the Details page, the pill is a link to the same page and only that, as a preview pill is to its deployment (**a link in a collapsible header row never also toggles the row**: `mainClickToggles` ignores clicks on `a[href]`, `rowClickToggles` on any control, and a link pill gets no click handler of its own), and the line opens to the service's whole sentence (`reportDetail`), which the line itself cuts short.
  The pill wears the check's avatar (`PanelModel.checkAvatarFor`).
  **A report pill is shaped like a bot chip: the mark, the service's name, then the project (when the report has one) and the numbers** ("Codecov patch 62.50%", "Chromatic mint 3 changes"), or the state's word when the words are only a verdict ("Socket passed";
  `REPORT_STATE_WORD`, as a bot chip says "clean");
  short of room the name goes first, so two Codecov pills still read "patch 62.50%" / "project 80.12%" (see the fit steps under narrow layouts).
  The service's sentence is on the line under it and in the pill's hover card: resting on a pill (`ATTR_REPORT` = the report's anchor, `setReportProvider` → `reportCardFor`, hovercard.ts `showReport`) opens a card that hangs under it like a bot chip's identity card, with the reporter's mark and name, its login, the time, "Failed · mint · 3 changes must be accepted" in the state's colour, a clamped copy of the comment for a comment report (the alerts table, the failing tests), and a foot of "See full report" / "Show in Reports" (opens the row to the line) plus "Open on <service>" for a check or "View the App" for a comment.
  The pill carries no native `title`, which would open beside the card.
  **A mark's frame takes the shape of its picture, read from the pixels** (`mark-shape.ts`, `shapeMark`): GitHub squares every App's and OAuth App's avatar (`data-square`, Chromatic's included), but Chromatic's image is a disc on transparent corners, and a square frame around a disc shows at the corners.
  Nothing in the markup says which, so the picture is drawn on a canvas (avatars.githubusercontent.com answers CORS with `*`) and the pixels a tenth of the way in along each diagonal are sampled - outside an inscribed circle, inside a square or a rounded square of any usual radius;
  all four transparent → `data-shape="round"` (circle, the 1px ring following it) on `.geld-review__bot-icon` and `.geld-review__avatar`.
  Answers are kept per URL for the page's life and written onto every mark showing that picture when they land, so a panel rebuilt meanwhile catches up;
  a tainted canvas keeps the square frame.
  **A bot's pill never wears a person's face**: `avatarSrcOf` (crawler.ts) is bound to the author (the picture captioned with the author's login, through worn pieces;
  then for a bot GitHub's mark for its App, `appAvatarForLogin`;
  then the first avatar outside bodies, forms and reactions, since a report's body carries the faces of people it mentions and a loaned comment's home row leaves the reply box's picture, the reader's, first), and a check report's mark is the service's App (`CheckReporter.appId`, `checkReporterAvatar`), never the merge box row's picture when that is a person's (`/u/`, `avatar-user`): a status posted through someone's authorization shows that someone.
  App ids for every registry bot and reporter were read from `GET /users/<login>` in Oct 2026;
  `avatars.githubusercontent.com/<login>` is an identicon for App logins.
  **A pill that goes nowhere has a dashed border**: every pill is `.geld-review__bot`, a clickable one is an `<a>` (a bot's run summary, a preview, a check report's page) or a `<button>` (a comment report, opening in place) and one with nothing to open is a `<span>` — a bot known only from its check run, a skipped deployment, a report without a page — so `.geld-review__bot:not(a, button) { border-style: dashed }` tells them apart without a second class;
  build a non-clickable pill as a span and it is dashed by itself.
- **A comment's byline says what GitHub's header says beyond the name** (`chat.ts` `ChatByline.author`/`via`, `via.ts`).
  The pull request's author gets a small "Author" pill after the name (GitHub's own `.Label` inside a compact card is hidden;
  it rendered as a full-width box).
  A comment posted through a GitHub App (a review left via Replicas) wears the App's mark on the corner of the picture, read from the timeline row's `.avatar-parent-child a[href*="/apps/"] > img` (alt = name, src, href), and the person's hovercard gets a "Posted via <App>" line linking to the App: GitHub's user hovercard is one shared `.js-hovercard-content` refilled per hover, so `armViaHovercard` arms the login while the marked picture or name is under the pointer and a `MutationObserver` appends the line once the card for that login lands.
- **Comment-only lines** (`@geld/core/comment-lines.ts`, `src/github/ui/comment-rows.ts`).
  `parseUnifiedDiff` also records, per file, the changed lines that hold no code outside comments (language by file name;
  unknown languages are skipped;
  blank changed lines count) as `FileStats.commentLines` (`added` = new-file numbers, `removed` = old-file numbers, dropped above 2000) and tags the `comments` kind when every changed line is one.
  With the `hideCommentLines` setting on, `GeldController.classifyEntries` attaches them to visible entries and `applyCommentRows` collapses the matching `tr`s by GitHub's own line anchors (`diff-<digest>R30`: `data-line-anchor` in the React view, `id` in the classic one;
  a split-view row is collapsed only when every line it shows is comment-only), inserting one note row per run with a "Show" button (`shownCommentRuns` keeps opened runs open across re-renders).
  The counts flow through `HiddenBreakdown.lines` (also folded into `totals`), so header, chips and tooltip agree.
- **GitHub's own file filter is mirrored, not fought.**
  `DiffView.filteredPaths` (`filteredPathsOf` in `model.ts`) collects files whose tree item or diff root carries `hidden` — GitHub toggles that client-side for its extension / viewed / CODEOWNERS filters and leaves its header alone.
  Those files become `Classified.filtered` → `HiddenBreakdown.filtered`, subtracted from the visible numbers (header, chips, tooltip row "Filtered by GitHub") but never counted as Geld-hidden.
  The observer watches the `hidden` attribute for this.
- **When GitHub markup changes or a new list/hovercard appears, follow the repo skill** `.claude/skills/github-surface/SKILL.md` (also linked from `.cursor/skills/`): rule out a stale store build, diff the pasted HTML against the spec hooks, decide catalog vs code, verify with a fixture served as a github.com URL, land.
- **Every GitHub list UI is one declarative entry in `@geld/core/list-surfaces.ts` (`BUNDLED_LIST_SURFACES`), shipped inside the signed catalog** (`catalog/patterns.json` → `listSurfaces`;
  `Catalog.listSurfaces`;
  a newer fetched document replaces the list, an older document without the key keeps the bundled one).
  A spec has the `closest()` row selector from a title link (`row`;
  optional `inside` — the row counts only within a matching container, for generic components such as ActionList items that appear in many menus — and `notInside`), ordered `chipAnchors` (`after` a metadata line, `append`ed to a block description, or `prepend`ed into a single-line ellipsized description and floated right so the counts keep their width and the ellipsis falls on the text — a float placed *after* the text drops below a full `nowrap` line;
  falling back to the "#N" heuristic then the title), ordered `authors` sources (`label` = "opened by X"/"Filter by author X" in title/aria-label, `href` = `author:X` / `author:app/X` → `X[bot]`, `text`) and optional `css`.
  `src/github/list-surfaces.ts` only compiles specs into functions (invalid selectors are skipped with a console warning) and injects the per-surface CSS as `<style id="geld-surface-styles">`;
  rows and chips are stamped `data-geld-surface="<id>"`.
  Current ids: `classic-list` (Rails `.js-issue-row`), `react-list` (Primer ListView `li[id*="-list-view-node-"]` / `li[role="listitem"]`, rolling out to `/pulls` since 2026-09), `stack-popover` (ActionList items `inside` the Stack N/M popover — `[class*="StackState"]`, or since Oct 2026 `[class*="AnchoredOverlay"] [class*="stackNavList"]`;
  chip `prepend`ed and floated right so the branch name takes the ellipsis), `stack-list` (ActionList items inside the merge box's "Stacked pull requests list" nav `[class*="StackList"]` and inside the "Preview stack" dialog `[class*="PreviewStackDialog"]` that proposes a stack from sequential PRs, a Primer portal under `#__primerPortalRoot__`;
  chip `append`ed inline after the branch name — floated right it would sit against the trailing status label, whose width varies per row), `pr-hovercard` (the PR hovercard `.js-hovercard-content[data-hovercard-target-url*="/pull/"]`;
  the chip is `append`ed into the state-badge row of the top box as a flex item beside "Open"/"Draft", vertically centred, `nowrap` so it wraps under the badge whole, bullet hidden (it follows a badge, not text): "10 tests +493 −83", the same chip as everywhere else).
  The tooltip is `position: fixed; z-index: 1001`, one above the hovercard's inline `z-index: 1000` (both are `<body>` children, so only z-index decides);
  fixed rather than absolute because hosts sit inside sticky headers, scrolling panes and overlays, and a viewport-positioned box escapes all of their clipping and stacking with one routine.
  **The PR header's own counts get a flush box** (`attachBreakdownTooltip(…, { align: 'end', flush: true })`, header-stats.ts): the header's counts sit right above the tab bar's bottom border, so `position()` looks for that bar (`barUnder`: an element with a bottom border within 24px under the host, spanning it, among the host's ancestors and their children and grandchildren, since GitHub's tab nav is in a flex wrapper beside the counts' wrapper), lays the box's top border exactly over the bar's (`top = bar.bottom − bar's border width`, unrounded, as is `left`, because the host's right edge is fractional at most zoom levels and a rounded box ended half a pixel short), and sets `data-flush` so the top corners are square: the box hangs from the bar as a drawer.
  Geometric, not class-based, and re-checked on every reposition, so a narrow layout that moves the counts off the bar gets the floating box;
  the narrow mirror and every list chip never ask for it.
  The caret (two stacked border triangles, the surface colour over the border colour) is anchored by its base on the padding edge (`bottom: 100%` below the box, `top: 100%` above it), never by a fixed offset: at a zoom other than 100% the browser rounds the triangles' borders down to device pixels (7px became 6.1), a caret placed 14px up ended short of the box, and the box's top border, laid on the bar's when flush, ran through its base.
  Both end alignment and the flush box hold only when the underlined count sits at the host's end (`END_SLACK`, 160px, which the PR header's "+N −M" and blocks fit within): the classic compare and commit headers make the whole "Showing 29 changed files with 5 hidden, …" line the host, and aligning to its right edge put the box at the far side of the page with the caret left on the count, so there the box is centred on the count as elsewhere.
  Chip spacing: `--geld-chip-gap` (`.geld-pr-stat`, github.content/style.css) is the gap on *both* sides of the "•" — text→bullet is the chip's margin, bullet→counts the first count's — so a surface widens it by setting the one variable, never `margin-left`.
  When GitHub changes markup: edit the spec, push;
  CI publishes the catalog, extensions pick it up within six hours — no store release.
  **GitHub's CSS-module class names changed shape in Oct 2026**: `Component-module__name--hash` became `name__hash` (`MergeBoxExpandable-module__expandableWrapper--x` → `expandableWrapper__noG29t`, `Description-module__container` → `container__x description__y`, the Stack popover's `StackState` wrapper → a `nav.stackNavList__x` inside a Primer `AnchoredOverlay`, the sticky header → `stickyHeader__x`).
  Every hook now matches on the bare name (`[class*="expandableWrapper"]`), which both shapes contain, or on a role (the Checks section header is `section[aria-label="Checks"] > :has(> button[aria-label$="checks" i])`);
  never on `-module__` again.
  The symptom was GitHub's whole Checks section — header, ring and chevron — inside the CI row's slot, because `quickViewFor(CHECKS_KEY)` loans the expandable wrapper alone and fell back to the section when the hook missed.
  New behaviour (placement modes, source kinds) is code.
- **Diffstats for other commits/PRs (hovercards) are catalog surfaces too** (`DiffstatSurfaceSpec` in `@geld/core/list-surfaces.ts`, `catalog.diffstatSurfaces`, applied by `src/github/diffstat-surfaces.ts`).
  A spec names the container (`root`), where the subject is written (a root attribute or a link's href containing `/owner/repo/commit/<sha>` or `/pull/<n>`), the diffstat `host` and its `additions`/`deletions`/`srOnly` elements, plus optional `css`.
  The extension requests the subject's `.diff` through `DiffSource` (cached per SHA), classifies it with the repo's matcher and rewrites with `applyHeaderStats` via `statGroupFrom`, so the label, tooltip and sr-only sentence match the page header.
  Idempotent per host via `data-geld-diffstat="<diffUrl>|<totals>"`.
  Bundled: `commit-hovercard`.
- **"Hide whitespace changes" (`hideWhitespace`) is URL state on GitHub, and Geld treats it as such** (`src/github/whitespace-viewed.ts`).
  `?w=1` on a diff page hides them, `?w=0` is what GitHub's diff-settings menu writes when the reader unchecks the option, and the React files view persists nothing between pull requests (verified Oct 2026: the menu toggle only rewrites the URL, and the next PR loads with `viewSettings.hideWhitespace: false` again).
  The former design assumed GitHub remembered the choice and set a `local:whitespacePersisted` flag after driving the menu once, after which it never re-applied;
  that flag is gone and the menu is no longer driven.
  Now the content script redirects at `document_start` (`redirectEarly`, before the settings-independent work and before GitHub renders anything) when a `pull-files`/`commit`/`compare` page has no `w`, the setting is on and the page is not opted out;
  `WhitespaceRedirector.ensure` does the same for SPA navigations once the view exists and submits the legacy view's own `/diffview` form instead when it is there (GitHub persists that one).
  **Opt-outs are per page key** (`/owner/repo/pull/N`, a commit's or compare's path) in `local:whitespaceOptOuts` (key → when, oldest dropped past 300): a `?w=0` records one, a `?w=1` on an opted-out page clears it (only the reader can produce that, since Geld neither redirects nor rewrites links for opted-out pages).
  `rewriteFilesLinksForWhitespace` adds `?w=1` to the Files tab and its per-commit forms (`/files/<sha>`, `/changes/<base>..<head>`) for pages not opted out.
  A redirect GitHub strips the parameter from (the document that follows within 4 s has no `w`) marks the path `unsupported:<time>` in `sessionStorage` for a minute, not the session, so a stray hit on that guard costs little.
- **Narrow screens keep the header counts.**
  GitHub hides the PR header diffstat by container width (its wrapper is `PullRequestHeader-module__hideWhenVeryNarrowContainer`).
  `syncNarrowMirror` (header-stats.ts) keeps a copy, `.geld-header-mirror` (label + `+N −M`, same tooltip provider), appended to the state-label row (`[data-component="StateLabel"]`'s parent in the same `[data-component="PageHeader"]`, so after the stack button) and toggles its `hidden` on every apply from whether the original host has client rects;
  the controller re-applies on `resize`.
  Removed with `restoreHeaderStats`.
- **Submit review from any tab** (`quick-review.ts`, experiment `quickReview`, on by default): Geld's own review group (below) stands just left of the line counts in the pull request's tab bar on every tab, placed every pass (`placeQuickReview`) and again in the pre-paint header path when GitHub remounts its header.
  GitHub's button exists only on the React Files changed tab (`[class*="ReviewMenuButton"]`, React's), so it is not moved: while Geld's is mounted `html[data-geld-quick-review]` hides it and the classic `details.js-reviews-container`, so the action shows once.
  **A pull request with no line changes still gets counts** (`syncCountsStandIn`, header-stats.ts): GitHub leaves the tab bar's counts out for a change of binary files only (their wrapper rendered empty, its Suspense boundary resolved to nothing), so the header had no counts, no breakdown and the review group nowhere to stand (mintlify/landing#886).
  When the page's diff is loaded and has no added or removed lines, a stand-in of GitHub's own shape (`[data-geld-counts-stand-in]`: `+0`, `-0`, the "Lines changed:" sentence) goes into that wrapper, or into a wrapper of Geld's (`.geld-counts-stand`, floated and hidden by the same `@container (width <= 768px)`) where there is none, and the header pass reads and rewrites it as it does GitHub's: label, breakdown tooltip, the narrow-screen copy, the review group before it.
  It is not marked as Geld's UI (the header scan skips that, `isInsideDiffEntry`), and the diff alone decides it — an empty wrapper is also what a header still loading its counts looks like, and a stand-in there would flash on every pull request.
  GitHub's own counts always win: a push that brings line changes renders them, the mutation callback sees them arrive (`headerNodesAdded`) and the stand-in steps aside before paint while the counts are rewritten;
  a push that takes them away leaves the next pass with no counts, the new head's diff with none, and the stand-in comes back (and before paint after a header remount, while it is wanted, `countsStandInWanted`).
  Geld's own nodes make no passes, so a change to the stand-in on a path that does not finish the header (before paint, a repository config pending) schedules one (`onCountsStandInChanged`).
  Teardown clears the decision before removing the stand-in: its removal is a mutation like any other, and with the decision standing the observer put it back, the next pass took it away, and so on after Geld was turned off.
  **Header counts offer their breakdown whenever anything changed** (`applyHeaderStats`): with nothing hidden GitHub's numbers stand, but the label is still dotted and its tooltip lists the files (Essential, each category, Total, the file count from the diff), since "0 tests +0 −0" over a binary file that changed says nothing on its own;
  only a change of nothing at all (no files, no lines) has no tooltip.
  Restoring GitHub's numbers keeps the tooltip when it is about to be attached again (`restoreNumbers(group, keepTooltip)`): detaching forgets the host while its listeners stay bound, and attaching anew bound another set on every pass.
  While the diff is not in (or cannot be had), `standAnchor` gives the group a mark of Geld's (`.geld-quick-review__mark`) in the empty wrapper, or a stand of its own (`.geld-quick-review__stand`), only while it shows, as `anchorOf` requires of the counts, so on a narrow header the group steps aside and GitHub's own button stays;
  the mark and stand go once counts, GitHub's or the stand-in, are there.
  Neither the stand-in nor the mark goes in while GitHub's wrapper holds anything of its own (`countsWrapperBusy`): while the counts load it holds their skeleton (a Suspense fallback, `skeleton__…`), and the group put beside that stood right of it, then jumped left of the counts when they replaced it;
  it now first appears where it ends.
  A skeleton that comes back (GitHub suspending the counts again) takes the group out before paint: the mutation callback asks `quickReviewStandBusy` (the group in a wrapper holding something of GitHub's, and not standing before GitHub's own counts: on its mark, or before the stand-in, which steps aside before paint) and places it again in the same task;
  only for a group inside a counts wrapper, since riding in the sticky header or toolbar its row is GitHub's and always holds more, and the check would re-place it before every paint.
  **The pull request's status pill in GitHub's header is a menu of the statuses the reader may switch to** (`status-pill.ts`, `showStatus`, `openStatusMenu`;
  this replaced a close / merge / Ready for review button group beside the review group, which also shifted the control as it arrived).
  GitHub's label (React's `[data-component="PageHeader"] [data-component="StateLabel"]`, both the header's and the sticky header's, or the classic `.gh-header-meta .State` / `.gh-header-sticky .State`, never a timeline badge) is never edited: it is hidden (`data-geld-status-hidden`) and a button of Geld's stands right after it in the label's own classes, `data-status`, `data-size` and title (Primer's StateLabel keys its look on them), with its glyph and its words, re-dressed only when the label changes (`dressedFrom`).
  Its caret lies over the glyph (`.geld-status-pill__lead`) and takes its place while the pill is hovered, focused or open, so the pill is never wider than GitHub's label.
  The button's resets are `:where()`, so GitHub's class rules win over the user agent's button look;
  hover and open darken it a little (`filter: brightness(0.92)`).
  The menu (`.geld-quick-review__status-menu`, the comment-kind menu's look, fixed under the pill and placed again as the page scrolls) lists each status the reader may switch to, never the one it has, forward first, in the order Open, Merged, Draft, Closed (merging before turning back to a draft, closed always last), as GitHub's action menu draws an item: one line of GitHub's words for what it does (15px, medium weight), after the status's glyph (18px) in GitHub's colour for it (`--fgColor-open`, `--fgColor-draft`, `--fgColor-done`, `--fgColor-closed`) (`statusOptions`, pure and tested): a draft offers Open ("Ready for review", `viewerCanMarkReadyForReview`) and Closed;
  an open one Merged (GitHub's label for its default method, or "Bypass rules and merge"), or in its place Queued ("Merge when ready", the `git-merge-queue` glyph in `--fgColor-attention`) where the repository merges through a merge queue, or Merged as "Enable auto-merge" where the pull request still waits on its checks or reviews and GitHub offers auto-merge, with Merged as "Bypass rules and merge" right after either where an admin may merge past the rules (`bypassBeside`);
  every "Bypass rules and merge" wears `alert-fill` at 10px in `--fgColor-attention` over its glyph's bottom-right corner (`.geld-quick-review__menu-badge`), the glyph masked away around it by the same triangle stroked 1.5px wider (`data-bypass`;
  the mask's offsets are the badge's less 5/3px and move with it), then Draft ("Convert to draft", `viewerCanConvertToDraft`) and Closed;
  Queued and auto-merge, like Closed, ask the browser's confirmation ("Add this pull request to the merge queue?", "Merge this pull request automatically once its requirements are met?") and then go at once, auto-merge with GitHub's default method and the commit it would write;
  a closed one Open ("Reopen pull request": GitHub gives no reopen permission of its own, so `viewerCanClose` stands for it);
  a merged one nothing, and GitHub's pill stays as it is.
  Pull requests have one way to close: the close reasons (not planned, duplicate) are issues', and GitHub's close request carries no body.
  **⌘ (Ctrl off a Mac) held makes the pill a 1-click merge on an approved pull request** (`instantMergeReady`, `showInstantMerge`, `instantMerge`, `data-geld-instant-merge`): an approval standing, no request for changes, not in a stack (which would merge the pull requests below it too, so that goes through the merge box and its sentence), and GitHub would merge it now with its default method (`mergeOffer` is `merge`;
  a merge only past the rules never goes in one click, its box asks for GitHub's checkbox).
  While the key is held (read as the review group's instant key is, `followInstantKey`, plus the pointer over a pill) the pill reads "Merge" with the merge glyph in `--fgColor-done`, no fill and a 1.5px ring of `--borderColor-done-emphasis`, the stroke of GitHub's 16px glyphs so it weighs what the merge glyph and its word do, with keyboard focus's outline moved 2px outside it since GitHub draws it just inside the pill, over the ring (`!important` over Primer's fill for the status), its aria-label "Merge now: Squash and merge";
  the merge face (`.geld-status-pill__merge`, `aria-hidden`) lies absolutely over the usual one, which keeps its room (`visibility: hidden`), so the pill's width and the header's words after it never move.
  A click with the key first reads the merge box again (what was read may be a minute old: an approval dismissed or changes requested since must not merge in one click;
  no longer qualifying, or unread, it opens the status menu instead), then sends GitHub's merge for its default method with the commit GitHub would write (as the merge box sends it, `bypassBranchProtections: false`), and on success, from the merge box too, the pills turn into GitHub's merged label before the page reloads to GitHub's own (`showMergedPills`: each pill dressed from a copy of GitHub's label turned merged, `data-status="pullMerged"` or the classic `State--merged`, GitHub's own glyph element drawing the merge octicon, "Merged", so it is built exactly as GitHub's merged label is and the reload moves nothing;
  it then has no `aria-haspopup` and no `aria-expanded`, and the caret, hover tint, pointer and click all key on `aria-haspopup`, so with the pointer still on it it reads as GitHub's plain label, and it stays keyed to GitHub's label as it stands so a pass before the reload does not dress it back);
  a refusal opens the merge box under the pill with GitHub's reason.
  Merged opens the merge box, hanging under the pill (`positionPanel` anchors a status box to `statusOpener`, fixed when the pill is in a sticky header);
  Closed asks the browser's own confirmation (`window.confirm`, "Close this pull request?") and closes at once, with no box to click through;
  Open and Draft act at once, as GitHub's own controls do, and a refusal opens the box with GitHub's reason and the action again (`runStatus`, `openConfirmBox(…, failure)`).
  GitHub's React merge box reads `GET page_data/merge_box?merge_method=…&bypass_requirements=…` (`state`, `isDraft`, `viewerCanClose`, `viewerCanConvertToDraft`, `viewerCanMarkReadyForReview`, `viewerCanAdminBypassMergeRequirements`, `viewerMergeActions` → the `DIRECT_MERGE` methods allowed, `mergeRequirements.state`, the commit it would write, the `STACK` condition), read once per pull request, each minute while the tab is shown and when it comes back (`loadMergeActions`).
  It is read again the moment the header's state label changes (`pullRequestStateWords` in `page.ts`, `Mounted.stateWords`, compared every pass): GitHub converts a draft, marks it ready, merges, closes and reopens in place, rewriting the label, and until the minute's read the menu offered what no longer applied.
  A label still empty while the header streams in is no change, so a page load reads once.
  **The pill is swapped in the header's first frame** where the reader may change the status, so GitHub's label never shows first and is then replaced.
  The controller's mutation callback calls `reassertStatusPills` before paint on every batch (the tab bar's counts, which the controls wait for, can render after the header's label);
  before the merge box answers the repository's hint decides (`statusHint` / `rememberStatusHint`: whether the reader could change the status the last time a pull request of this repository was read, `geld:status-menu` in the page's `localStorage`, read synchronously and kept in memory, at most 200 repositories;
  a merged pull request teaches it nothing), and every pill shares one click handler (`openFromPill`), since a pill can exist before the controls are mounted.
  **A pill that is a menu always opens one**: a click before the merge box has answered (on the hint, or after a read that failed — GitHub answers 503 in waves) starts the read and opens at once on a single muted line (`.geld-quick-review__menu-empty`, `data-placeholder`), "Loading options…" while the read is out (`mergeLoading`), "The options could not be read" with a nudge to try again once it failed, and the options take its place when the current read lands (`refreshPlaceholderMenu`, called by `loadMergeActions` itself, so a superseded read finishing first never leaves it loading, and a later read that finds options fills a menu that said there were none);
  a read that offers this reader nothing says "No options available" and keeps its pill while the menu stays open (`holding` in `showStatus`), and closing it gives the header back to GitHub's label (`closeStatusMenu` re-runs `showStatus` for a placeholder menu, except in teardown, which would otherwise put back the pills it removed), with Escape's focus going to the review group's first control when the pill has gone, or, where narrow screens leave the group no place, to the first visible control after GitHub's status label, the author's link (`returnStatusFocus`, `controlAfter`).
  Before, the menu returned without opening when it had nothing to list, so the click seemed to do nothing.
  The controls' state exists on every pull request page for a signed-in reader whether or not the review group has somewhere to stand (GitHub hides the header's counts on narrow screens: `unplace` takes the group out and shows GitHub's own button), so the pill works there too;
  the pre-paint swap runs under the same guards as a pass (`mayDressPage`: Geld on, the extension alive, not a sign-in page, the repository allowed), and teardown removes the pills even before the controls were made.
  `mergeOffer`, in the order GitHub's merge box picks its button (read from its bundle): none on a draft or a closed pull request, `queue` when the merge box's `MERGE_QUEUE` action is `ALLOWED` and the pull request is not `isInMergeQueue` (`canQueue`, as GitHub decides to show "Merge when ready", which is the queue's word only;
  GitHub shows the queue even where a direct merge would also go, and the queue waits for the checks itself, so it is offered whatever they say), else `merge` when GitHub would take it now (`mergeableNow`: `MERGEABLE`, or `MERGEABLE_IF_STATUSES_PASS` with the pull request's `mergeStateStatus` `CLEAN`/`HAS_HOOKS`, as GitHub's merge box decides;
  mint#13535 read as not mergeable over GitHub's Squash and merge), else `auto` when the merge box's `viewerCanEnableAutoMerge` is true and no `autoMergeRequest` stands (`canAutoMerge`), else `bypass` when only an admin's bypass would (the same box read with `bypass_requirements=true` says mergeable).
  **An admin's bypass also stands beside the queue and auto-merge** (`bypassBeside`, `MergeActions.bypass`), as GitHub's "bypass rules" checkbox does beside "Merge when ready" (merging at once, ahead of the queue) and "Enable auto-merge" (merging now rather than once the requirements are met), never beside a merge GitHub would take now: the box is read past the rules wherever it is not mergeable or a queue stands in the way, and the bypass's merge box offers the methods that reading allows (`bypassMethods`, since a queue's repository may allow no direct method otherwise).
  The merge box offers the allowed methods (GitHub's labels, its default first), the commit GitHub writes for the chosen one, editable and re-read when the method changes (none for a rebase), GitHub's own checkbox "Merge without waiting for requirements to be met (bypass rules)" for a bypass, which the confirmation waits on, and GitHub's "Confirm squash and merge" in Primer green, "Bypass rules and merge" in the danger red;
  a refused status change opens a box with GitHub's reason, Cancel and the action again (default button, its glyph in its colour), as wide as its buttons.
  Requests are GitHub's (read from its bundle, captured with writes stubbed, Oct 2026): `POST page_data/merge` `{ bypassBranchProtections, mergeMethod, commitTitle, commitMessage, authorEmail }`, or for a pull request in a GitHub stack `POST page_data/enqueue_stack` `{ mergeAction: 'DIRECT_MERGE', bypassRules: 'true'|'false', … }` (which takes every pull request below it too, so its merge box says so, `.geld-quick-review__stack-note`), `POST page_data/enable_auto_merge` `{ mergeMethod: 'GROUP' }` for "Merge when ready" and `{ mergeMethod, commitTitle, commitMessage, authorEmail }` for "Enable auto-merge" (GitHub's merge queue strategy is `GROUP`;
  `SOLO` is its "Queue and force solo merge"), and `POST page_data/close_pull_request`, `mark_ready_for_review`, `convert_to_draft` and `reopen_pull_request`, each with no body (`Accept: application/json`);
  `authorEmail` is `defaultCommitAuthorEmail` and is sent only while the merge box lists `possibleCommitAuthorEmails`, as GitHub's own button does (`parseMergeBox`): on a pull request a bot opened the default is the bot's noreply address with no emails to pick, and sending it answered "Invalid email for web commit" (mintlify/docs#8081), where leaving it out lets GitHub take the reader's own.
  reopening could not be tried live (no closed, unmerged pull request the test account may act on).
  **A pull request in a GitHub stack of more than one gets the menu by type** (`stackGroups`, status-pill.ts;
  `Stack` from `GET page_data/stacks`, top first, merged members left out, and every member's merge box, read with the page's in `readMergeActions`): each type (Ready for review, Reopen, the merge or "Merge when ready" as the page's own merge box would offer it, Convert to draft, Close;
  auto-merge and the bypass stay a stack of one's) is a parent, not a choice, with a chevron and a submenu beside it on the menu's inline-end side as Primer's open (`placeSubmenu`: its first choice level with the parent, `data-geld-flip` to the other side where the viewport has no room and `data-geld-under`, under the parent over the rows below it, where neither side has, placed again on resize;
  hover or a click opens it, the arrow toward it moves in and the arrow away or Escape comes back to the parent);
  the choices are "This pull request", "This and N below" and "Entire stack (N)", each shown only when every pull request it takes allows the type (`STACK_CAN`, from its merge box;
  a member whose box could not be read allows nothing) and a type only with a choice left;
  merging mirrors GitHub, which merges a stacked pull request with every one below it, so "This pull request" merges only at the foot of the stack, from the top "this and below" is the entire stack and says so, and the entire stack merges through its top's `enqueue_stack` whichever pull request is being read;
  this pull request alone goes as the flat menu's item would (the merge box, a confirmation before closing or queueing, the rest at once), and anything that changes more than one asks `window.confirm` first naming every one ("Close the entire stack of 3 pull requests (#9, #7 and #5)?", `stackConfirmWords`);
  what is chosen goes out only while the reader is still on the pull request it was chosen on, by the controls' own record and by the address (which changes first), checked before each request and before the reload (they move with the reader to another one, and a stack's merge first reads its top's merge box);
  a merge then goes through the top of the choice's `enqueue_stack` (`DIRECT_MERGE` with GitHub's default method and the commit it would write, read afresh) and "Merge when ready" as `{ mergeAction: 'MERGE_QUEUE' }` alone (`stackQueueRequest`, also what a stacked pull request's own "Merge when ready" sends), the rest as one request per pull request, top first (`sendSteps`), stopping at the first GitHub refuses with its reason and a retry of what was left (`openRetryBox`), and the menu read again when any before it went through.
  A stacked pull request whose stack could not be read gets the flat menu without its merge and its place in the queue (`flatStatusOptions`): both would take every pull request below it, which only the stack names.
  a refusal shows GitHub's error and rule errors in the box, success reloads the page.
  **The reader's standing verdict is drawn pressed in** (`showVerdict`, `data-current`, Primer's selected surface with an inner shadow and the glyph in its verdict colour, "(your current review)" in its name), read from the merge box's `latestOpinionatedReviews` (each reviewer's latest approval or request for changes, dismissed ones gone);
  still a button that leaves a new review.
  GitHub keeps one standing verdict per reviewer, so approving after requesting changes replaces it (and the other way round) while a comment-only review leaves it standing: after a review goes through the pressed segment follows at once and the merge box is read again.
  **Left of the group, how the reviews stand** (`review-tally.ts`, `showTally`, `.geld-quick-review__tally`): "2 ✓ 1 ✗ 3 💬", muted counts with each glyph in its verdict's colour and no surface until hovered or focused, when GitHub's neutral muted one shows at three quarters of its contrast (`color-mix` with transparent, so both schemes), as tall as the group beside it (`align-self: stretch`), 4px from it (a link), 3px from count to glyph and 6px between kinds, a kind with none left out and nothing at all with no reviews, its words in the `aria-label` ("2 approvals, 1 request for changes, 3 reviewers commented").
  Its glyphs are the buttons' own at the buttons' size (16px) and on their line, the comment bubble nudged down a pixel as in its button, so each stands level with its counterpart in the group.
  It is the sidebar's Reviewers block, each reviewer once by their latest review as GitHub keeps them (a dismissed approval counts as comments, a pending request not at all, Apps such as Copilot included as the sidebar lists them), fetched from the partial the block refreshes itself from (`issues/N/show_partial?partial=pull_requests/sidebar/show/reviewers`, served for any tab) and read with `crawlSidebarReviewers`, with the merge box's verdict for the same login winning (`standingReviewers`: the sidebar names a reviewer by their latest review, the merge box's `latestOpinionatedReviews` keeps an approval standing over a later comment);
  read with the merge box (`loadMergeActions`), so on mount, each minute while shown, on return, and after a review goes through.
  **Resting on the tally (or focusing it) shows the reviews behind it** (`armSnapshot`, `showSnapshot`, `.geld-quick-review__snapshot`, 200 ms in and out, kept while the pointer is on the card, Escape closes): one line per reviewer with picture, login and standing review as its glyph alone in its colour (the words in its `aria-label` and title), each a link to that review on the conversation (`reviewLink`): its own `#pullrequestreview-<id>` when the merge box gave the id (`ReviewVerdict.id`, approvals and requests for changes only), else Geld's marker `#geld-review-by-<login>`.
  The tally itself links to `#geld-reviews`.
  **The conversation resolves those markers** (`followReviewHash`, each pass and on `hashchange`, for up to `HASH_PATIENCE_MS` while the timeline loads): a reviewer's marker becomes the anchor of their latest `pullrequestreview-<digits>` row whose `.author` is the login (GitHub writes "Name (login)" where full names are shown, and `-permalink` ids repeat the number), which the browser or the digest then lands on;
  `#geld-reviews` (or a reviewer never found) drops the hash and lands the digest's Reviews row 96px below the top and opens it, or without the digest centres the sidebar's Reviewers.
  The row is scrolled into place *before* it is clicked, since opening a row makes the digest hold it at the viewport top it has at that moment (`hold.ts`), and is brought back twice over the next second unless the reader scrolls.
  **The group is drawn at once and its parts land as they are read**: the tally (from the Reviewers partial), the pressed verdict and the status pill (from the merge box) arrive when their reads do, none of them moving a button (the tally appears to the group's left, which the right-aligned row grows into).
  It once waited for both reads (`holdUntilReady`, up to 1.5 s), from when merge, close and ready buttons stood left of it and pushed it as they landed;
  those moved into the status pill, and the wait only left a blank where GitHub's own review button had already been hidden.
  **💬's box posts a plain comment or a review** (`CommentKind`, `Draft.kind`), and **💬 wears the kind it will post** (`showCommentKind`, `data-kind`): the comment octicon for a plain comment, `code-review` (a bubble holding code brackets) for a review, its name "Comment"/"Review" in its label and tooltip, no word beside the glyph ever (the choice is the box's, so the button no longer needs "Review" written on it).
  The sending glyph for a review is `ICON_CODE_REVIEW_SEND`: that bubble fills its whole box, so the arrow sits over its lower-right corner and an SVG mask cuts the bubble back around the arrow, the bubble where the plain glyph has it.
  Its box: its submit is a split button whose caret opens a small menu of two, each with its octicon, name and a one-line note — "Comment · Add to the conversation" (`comment`) and "Review · Submit as a review" (`code-review`), the current one checked;
  arrow keys move in it, Escape closes it first.
  With comments pending a review is the default (they go with it, as before), without them a comment, until the reader chooses;
  a plain comment needs words and leaves pending comments pending.
  It is GitHub's conversation composer's request (`timelineCommentRequest`: `POST page_data/create_timeline_comment` `{ text }`, read from its bundle;
  an empty text answers 422 "Comment text is required."), after which the conversation is caught up to show it (`catchUpTimeline`, reloading only where that cannot be done) and screen readers hear "Commented".
  ✓ and ✗ open the box with no choice.
  **With comments pending, ⌘-click on 💬 submits them at once** as a comment review with no words (`isInstantClick(…, pending)`, `data-pending` on the group): its glyph gains the arrow while the key is held (`ICON_COMMENT_SEND`, the arrow below the bubble's edge, the bubble where it stands) and its tooltip reads "Comment" over "⌘ 1-click review", or "Submit pending comments" while held;
  a refusal opens the box with GitHub's reason, as for ✓ and ✗.
  **The group rides every tab's sticky header** (`place`, `stickyPlace`), so it is always to hand while reading.
  On Files changed, GitHub's toolbar (`section[class*="stickyHeader"]`, classic `.js-sticky`) holds its own review button and sticks to the viewport's top as the diff scrolls;
  while it is stuck the group stands just before GitHub's hidden button (`data-geld-place="toolbar"`, 28px as the toolbar's buttons are, `margin-left: -8px` while the tally shows right after the row's divider, so the 12px the row leaves after it is the group's own 4px, and none after a button of GitHub's ("Merge status", there since Oct 2026, which had the tally flush against it) or without the tally, when the row's 8px gap spaces it as it does GitHub's buttons;
  the group is `min-width: max-content`, since Primer's group floats its buttons and so has a one-button min-content, and the toolbar's right-hand row, sized from its children's min-content, shrank below the group and pushed its last buttons past the toolbar's edge).
  Stuck is read **from the toolbar's box on scroll** (`measureToolbarStuck`: its top at its sticky `top`), in a passive `scroll` listener, which runs before the frame is painted: GitHub's `is-stuck__<hash>` class comes from an observer that reports after paint, a frame late (noticeably the first time), so following the class alone showed the stuck toolbar without the group for a moment.
  The reading is cached (`Mounted.toolbarStuck`) and a pass only uses it, since passes must not measure;
  the class flipping and a newly found toolbar (one rAF later, for a page opened or restored scrolled down) re-read it too.
  On every other tab GitHub shows a compact header once the page header has scrolled away (`[class*="prHeader"][class*="stickyHeader"]`, `display: none` until its `is-stuck__<hash>` class, `position: fixed`): the group goes at the end of its title row (`[class*="TitleArea"]`, `data-geld-place="header"`, `order: 99` since Primer orders the row's parts, `margin-left: auto`), moved by a `MutationObserver` on that class (`watchSticky`), which runs in the same task as the flip that shows the header, so the group is there in the header's first frame.
  Off both, it goes back before the tab bar's counts.
  Inserting Geld's node into these React rows leaves React's own children alone.
  The comment box opened from a sticky header is `position: fixed` under the group (in page coordinates under the tab bar), and re-placed when the group moves.
  Verified on the React views (Files changed, Conversation, Checks;
  Commits on #13 is too short to stick);
  the classic view's toolbar was not reachable.
  **The control is one Primer button group, [✓ | ✗ | 💬]** (`createControls`, `.BtnGroup` of `btn btn-sm BtnGroup-item` icon segments), 26px tall (overhanging the tab bar's 18px line by 4px each way) and about 29px wide, dressed as the Files changed toolbar's own default buttons (Merge status, the settings gear): `--button-default-bgColor-rest` surface, `--button-default-borderColor-rest`, `--button-default-shadow-resting` (GitHub's is a flat surface and a 1px shadow, no gradient, measured Oct 2026), the default hover and active surfaces, and every glyph in its hover colour at rest too (✓ `--fgColor-success`, ✗ `--fgColor-danger`, 💬 `--fgColor-default`), so each button says what it does before the pointer reaches it;
  under the pointer, and only there (not while its box is open, which is the pressed surface, nor for the instant key), ✓ tints that surface with `--bgColor-success-muted` laid over it at 70% (a one-colour gradient over the button colour, so the grey shows through), its border `--borderColor-success-muted` (about the grey border's lightness, only tinted) and colours its icon `--fgColor-success`, ✗ the same with the danger tokens (💬 the default grey hover);
  Primer draws a group's dividers as each next button's left border, so a hovered button's right edge is its neighbour's `border-left-color`, tinted with it, theme variables only and no fixed green or red, so a colour-blind or high-contrast theme's own success and danger come through (checked: GitHub's colour-blind light theme makes them blue and orange), and every change is instant (`transition: none`, Primer's 80ms ease included);
  the icon is a block coloured on the svg itself, since inline it sat on the text line off-centre and Primer's `.btn .octicon` colours the icon directly, and the comment glyph sits 1px low, its bubble being the top 11 of 16px with the tail under it, so it reads centred beside ✓ and ✗: Approve, Request changes, Comment.
  A click opens the comment box with that verdict chosen, so the box is also the confirmation (the segment reads as pressed, `aria-expanded`;
  the same segment again closes it);
  ⌘-click on a Mac, Ctrl-click elsewhere (`isInstantClick`), on ✓ or ✗ sends at once with no comment, and 💬 always opens the box, being there for the words.
  With words waiting in the box (its draft for this pull request), the instant click opens the box with that verdict instead, since an empty send would leave them out and the reload after it would drop them.
  While that key is held the group says so before the click (`followInstantKey`: `data-instant` from every key event, from the pointer over the group since the key may have gone down in another window, cleared on blur;
  the listeners go with the group): ✓ and ✗ swap their glyph for one with a small arrow in the bottom-right corner (`ICON_CHECK_SEND`, `ICON_X_SEND`: Octicons has no "send at once" mark, so the check and the cross stand exactly where the plain glyphs do, and the swap moves nothing, with an arrow at the octicons' 1.5 stroke tucked into the free bottom-right corner, `sendArrow(dx, dy)`;
  the cross's lower arm reaches that corner, so its arrow sits further out and overhangs the 16px box, which the svg's `overflow: visible` and the segment's padding allow), both glyphs in the segment and the stylesheet showing one (`.geld-quick-review__glyph--instant`).
  The key once tinted ✓ and ✗ instead;
  that colour is now the hover's, and a shape says what the key does.
  The pending count is a badge on the group's top-right corner (`.geld-quick-review__count`, accent fill ringed in the page colour so it reads over the outline, `aria-hidden`, `z-index: 2` over the group's buttons, which Primer lifts to 1 when focused, pressed or hovered), outside the group in a `.geld-quick-review__badged` wrapper, since inside it Primer's `:last-child` rounding would land on the badge;
  💬's name says it ("Comment, 1 pending comment").
  Each segment's words are GitHub's own `tool-tip` (`segmentHint`, one entry per line, broken with `<br>`: "Approve" over "⌘ 1-click review", Ctrl off a Mac, "Approve without comments" alone while the key is held (`followInstantKey` re-describes the segments as the key changes, so an open tooltip changes with it), and "Comment" alone;
  the `title`, lines joined by a newline, where the page defines no `tool-tip`), placed beside the group, never between its buttons, because Primer rounds the outer corners on `:first-child`/`:last-child`.
  **On their own pull request the author has 💬 alone** (`showAuthor`, `EventInfo.authorMay`): GitHub refuses an author's own approval and request for changes, so ✓ and ✗ leave the group, out of the DOM rather than hidden, since Primer rounds the corners on `:first-child`/`:last-child` (they once stayed, disabled with GitHub's reason as the tooltip, which was clutter for something that can never apply).
  An instant send GitHub refuses (it may want words for a change request with nothing pending) opens the box with that verdict and GitHub's reason;
  **A send freezes the group in place** (`aria-busy`, `data-sending` on the pressed segment): the other segments fade, and the pressed one's glyph gives way to Primer's spinner (`ICON_SPINNER`) in the glyph's own colour, since it sits in a `.geld-quick-review__glyph` like the glyphs the colours key on.
  "Submitting…", then "Approved" / "Changes requested" / "Review submitted", is said to screen readers only (`role=status`, visually hidden): words beside the group appeared and went with every send and pushed the controls around.
  **The words are written in GitHub's own comment writer** (`comment-writer.ts`): the conversation's "Add a comment" box (`form#new_comment_form .js-previewable-comment-form`), with Write and Preview, the Markdown toolbar, mentions, references, saved replies and uploads, all driven by GitHub's own behaviours, which run on every pull request tab (verified Oct 2026 on Files changed).
  It is server-rendered into the conversation page with its preview and upload tokens and has no partial of its own, so on this pull request's conversation the page's box is copied, and elsewhere the conversation's HTML (about 480 KB) is fetched once per pull request when the reader heads for a review segment (`prefetchWriter` on the review group's `pointerenter`/`focusin`, never the merge, close or ready actions) and kept for the page's life;
  a box opened before it lands shows a placeholder in the writer's shape (`writerPlaceholder`: Write, Preview and toolbar bars over a field-sized block, shimmering, static under reduced motion), focused so Escape still closes the box, and at the width the last writer was fitted to (`writerWidth`), never a plain field that the writer then replaces;
  the plain field shows only when the writer cannot be read, or after `WRITER_PATIENCE_MS` (5 s) of waiting, and a writer landing after that still replaces it, words, focus and selection kept.
  A copy is reset to an empty Write tab and re-id'd (`reid`: every id and every attribute naming one, `for`, `aria-labelledby`, `data-hotkey-scope`…), since the toolbar, its hotkeys and tooltips find their textarea and buttons by id and reached the page's own box otherwise;
  GitHub's session resume is taken off the field.
  It stands in a `<form>` of Geld's (`.geld-comment-writer`): GitHub's preview finds the writer's form and without one answers "Error rendering preview", and the form's submit (GitHub's Ctrl+Enter) is always cancelled, the box sending the words itself.
  The box is as wide as the writer needs for every toolbar button plus 16px (`fitWriter`: the writer measured at `max-content`, not the whole box, whose ellipsised pending lines would stretch it), since GitHub's action bar folds buttons that do not fit into "⋯", and once fitted any toolbar button still reaching past the header row's edge widens the box by that much (the toolbar can measure narrower than its scripts then lay it out, and its last buttons ran off the box);
  the box's `input` listener sits on the body, not the field, so GitHub's toolbar edits and a swapped-in field both reach it, and Escape a suggestion list took (`defaultPrevented`) leaves the box open.
  It reads as the box's own, not a card inside it: its root's Primer `Box` frame and the grey header behind its toolbar are taken off, Write and Preview are quiet 32px pills on the box's surface (the selected one on GitHub's `--control-transparent-bgColor-selected`), and the field sits flush with the box's padding (`CommentBox-container` without its margin), all scoped to `.geld-quick-review__panel`.
  The comment box (`geld-quick-review__panel--writer`) keeps everything 6px from its edges: the Write tab, the field, the pending comments and the footer's buttons, so each corner's 6px radius is concentric with the box's 12px, and the header row's children lose their own vertical padding (the toolbar's 32px buttons set its height, so the tabs once sat lower than they sat in from the side);
  the pending rows and Discard keep their glyphs in one column 12px in, their hover surfaces inside the box.
  The box's body has 2px of bottom padding taken back by an equal negative margin, since GitHub's focus ring on the field (`.CommentBox-container:focus-within`, a 2px outline at `outline-offset: -1px`) reaches 1px past the field, and a body that scrolls (a box fixed under a sticky header) clipped that pixel along the bottom, the one side with no padding.
  The preview is framed like the field in Write: a 1px `--borderColor-default` border and the field's 6px radius on `.js-preview-body`, not its panel (GitHub's 8px margin on the panel goes), because GitHub gives the body a `min-height` of the field's framed height and the body is border-box, so switching tabs moves nothing.
  The writer's foot ("Markdown is supported", "Paste, drop, or click to add files") is hidden (`hideFoot` in `comment-writer.ts`, found by its words since nothing in GitHub's markup names the row, `data-geld-writer-foot`): it repeats what the toolbar's attach button and dropping onto the field already do, and the file input stays in the page.
  The writer's `<form>` is `noValidate`: GitHub's field is `required`, and a submit there (Ctrl+Enter, a toolbar button) showed the browser's "Please fill out this field" bubble over the toolbar.
  Wherever it opens, the box keeps to the room in the window on the side it opens (`positionPanel` sets its `max-height` to that room, never more), the footer's buttons always in view, so it never runs off an edge: under the anchor, or over it, bottom edge 4px above the anchor, when less than `PANEL_ROOM` (240px) is left below and more is above, placed again as the box or anything in its body changes size (a `ResizeObserver`, since one over its anchor grows upward) and as the page scrolls (its room is the window's, and a box placed in page coordinates moves with the page);
  the words' field, or the preview in its place, takes what that room leaves once the tabs, the pending comments and the footer have theirs (`fitField`, `--geld-field-max`, `!important` over the `max-height` GitHub's sizer writes inline from the window's bottom edge, which let a long comment outgrow the box, scroll under the tabs and have its focus ring cut off by the scrolling body) and scrolls inside itself, so the body scrolls only when even `FIELD_MIN` (90px) does not fit;
  the preview's inline `min-height`, the field's height GitHub copies onto it when Preview opens, is held to the smaller of itself and that cap (`--geld-preview-min`), GitHub's value left as written so the tabs match again when the room returns;
  Write, Preview and the toolbar are sticky at the top of that body (stuck over its 6px top padding, on the box's surface) for that case;
  an open suggestion list (`[role=listbox]`, `.suggester`, an open `details-menu`) makes the body overflow instead, so GitHub's slash commands, mentions and saved replies hang past the box rather than being cut off and scrolling it.
  Without the writer (the fetch failed) the plain field stays.
  The comment box is a small Primer `Overlay` under the group (GitHub's own comment writer, no header, no title and no radio choices: the segment that opened it chose the verdict, and another segment while it is open changes the verdict in place, words, caret and all, through `Mounted.retarget`), its footer with no rule above and slim 24px buttons (12px words): Cancel a ghost button in the text colour, and the submit button naming the verdict in GitHub's colour for it (`EventInfo.submitClass`: "Approve" Primer's green `btn-primary`, "Request changes" red from the theme's danger button tokens at their solid hover step, `geld-quick-review__submit--danger`, with no shadow (the danger tokens' only one is an inset line that read as a second border) and, disabled until there are words (or pending comments, which go out with it), the same red washed halfway into the page with faded white words as Primer's disabled green is, not GitHub's red-on-grey danger look, "Comment" the default grey);
  the author's box only ever opens for a comment, Ctrl/Cmd+Enter to send, Escape to close, the draft kept per pull request for the visit.
  It sends what GitHub's dialog sends (captured Oct 2026 with the request stubbed): `PUT /owner/repo/pull/N/page_data/submit_review`, JSON `{ body, event: 'comment' | 'approve' | 'request changes', headSha }`, `GitHub-Verified-Fetch: true`, `X-Requested-With`, the page's `X-Fetch-Nonce`, same-origin cookies, no form token, so it works from any tab.
  **Pending comments are GitHub's dialog's too** (`pending-review.ts`): the group carries the count (the badge above), read live from GitHub's hidden Files changed button (`[class*="ReviewMenuButton"] [data-component="ButtonCounter"]`) where there is one (on Files changed, buttons with no counter mean none pending: GitHub drops the counter when the pending review is discarded there, and the count read earlier kept the badge up) and otherwise from `page_data/thread_previews` (read once per pull request and tab, again on a switch to another tab or a return to this one, and when the box opens), where a pending comment is `state: "pending"` with `viewerDidAuthor`;
  `page_data/pending_review` answers 404 whether or not one exists (Oct 2026) and says nothing.
  The box lists them under "Pending comments N" (folding, closed at first) one line each, as the digest lists threads, to keep the box small: the comment's first sentence (`firstSentence`, through `inlineText` so its code and emphasis stay), then the file's name and line in muted type (the whole path in the tooltip) and an Outdated label, the line a link to the comment on the Files changed tab (`currentDiffResourcePath`, `/pull/N/files#r<id>`, which github.com redirects to `/pull/N/changes#r<id>`;
  `linkOnFilesTab` writes `/changes` when the page's own tab is that, so from the Changes tab the link is a same-document jump to the comment's `#r<id>` rather than a reload);
  the list scrolls past six rows.
  Pending comments go out with the review, so a comment or change request may then be sent without words.
  **Discard review** (footer left, led by the `trash` octicon, which stands in the pending rows' glyph column, only with pending comments;
  word and icon `--fgColor-muted` at rest and `--fgColor-danger` on hover (the icon's colour set over Primer's `.btn .octicon`, which kept it grey), keyboard focus or press, never a surface, as Primer's `btn-octicon-danger` trash cans are) asks GitHub's own native confirm ("Are you sure you want to cancel?
  You will lose all your pending comments.") and sends GitHub's `DELETE page_data/abandon_review` (no body), then reloads Files changed (which still draws the discarded comments) or clears the count.
  Verified for real on geld#68 with a pending comment made for the test and discarded through Geld's button.
  **On success the review is shown at once and held** (`showOwnReview`, `heldReview`, `OWN_REVIEW_HOLD_MS` 90 s): ✓ or ✗ pressed in and the tally counting the reader's review (`withOwnReview`;
  a comment leaves a standing verdict standing), over GitHub's merge box and Reviewers partial, which answer from before the review for some seconds and took both back;
  only Files changed with pending comments just published reloads (its view still draws them as pending), after the review is shown;
  elsewhere screen readers hear what was sent ("Approved", "Changes requested", "Review submitted"), the pending count goes to none when they went with it, and the conversation is caught up (`catchUpTimeline`) so the review shows without a reload.
  Verified on brandonmcconnell/geld#68 with the harness answering the request itself (`block` command), so nothing was posted;
  the success response's body was not seen.
  In the tab bar GitHub floats the counts right and drops their line with 12px of top padding;
  a 26px group in that 18px line grew the box to the border (a layout shift, and the button over the tab border), so the box holding both (`[data-geld-quick-review-host]` on GitHub's `rightContentWrapper`) is the tab bar's 40px with no padding and both centred on the tabs, and the button overhangs with `-4px` vertical margins wherever else it lands, 8px before the counts.
  Panel rules carry both `.Overlay` and the panel class, and pin `right`/`bottom` to `auto`: Primer's own `.Overlay` comes later in the cascade and won the tie (full width, in flow), and something stretched it to the viewport bottom.
- **The tooltip closes when its host leaves the DOM.**
  GitHub's React lists re-render rows wholesale (the merge box's stack list when the PR's state changes), removing a hovered chip with no `mouseleave`;
  the fixed tooltip then sat at stale coordinates or snapped to the viewport corner once `follow` measured an empty rect.
  While a tooltip is shown, `ui/tooltip.ts` observes the document (childList + `hidden`/`style`/`class`) and, one frame after a burst, hides the tooltip if the host is disconnected or has no client rects (`hostGone`);
  `position()` checks the same before measuring.
  The re-added chip gets its own tooltip on the next hover.
- **Diff fetch pacing and diagnostics.**
  The worker's `fetchDiff` never sleeps inside a message: when the 30/min budget is spent it answers `{ reason: 'queued', retryAfterMs }` and `DiffSource` keeps the row `loading` and re-asks then (with jitter) — a worker sleeping in a timer is idle to Chrome, which stops it after ~30 s and closes every pending port ("message port closed", normalised to `port-closed`).
  Transient failures retry on `TRANSIENT_RETRY_MS` then keep going at its last step up to `TRANSIENT_MAX_ATTEMPTS`.
  The diff endpoint also answers **503** (sometimes 502/504) to a burst — measured headless: a third of a page within seconds, well under the budget — which is GitHub busy, not a block: `recordBusy` pauses everyone 12 s, doubling to 60 s while they keep coming (`cooldownReason: 'busy'`, separate from 429/403 strikes, reset on success), and the page treats `busy` like `queued` for up to `BUSY_MAX_WAITS` pauses before the row says "GitHub busy".
  Measured after this: three list pages (75 rows) opened at once all count within ~2.5 min with no failed chip;
  the budget, not failures, sets the pace.
  `DiffCache` writes merge into the *stored* map (read-merge-write, serialised per tab) and every tab follows the stored map via `watch`;
  writing a tab's own snapshot used to drop the entries other tabs had added.
  `src/lib/diagnostics.ts` keeps a ring of ~300 events in `session:diagnostics` (worker starts, per-fetch outcome/timing/budget by `owner/repo#N`, rate-limit strikes, cache clears — no URLs, bodies or tokens);
  the options page's "Copy diagnostics" (`copy-diagnostics`, extension-only) puts them on the clipboard.
- **A diff that could not be had is never cached, and the row says so.**
  Signed out of a private repository, GitHub answers a `.diff` request with 404 (`text/plain` "Not Found");
  with a lapsed SSO session it answers 200 with its sign-in page, which parsed as a diff of no files and used to be cached and shown as `0 hidden +0 −0`.
  `fetchDiff` (background) now fails with `signed-out` when the response was redirected to `/login`, `/session*`, `/sso` or `/orgs/*/sso`, and with `not-a-diff` when the body is HTML (`looksLikeHtml`);
  neither is cached, and nor is `http-404` any more (a 404 is the signed-out answer too).
  `DiffSource` treats those as definitive for the page — no retries spending the rate budget;
  signing in and reloading is the fix — and refreshes any on-disk entry that has zero files (poisoned entries from older builds).
  `pr-list.ts` `renderFailure` puts the reason in the chip's place (`.geld-pr-stat__failure`, muted italic: "sign in to count", "counts unavailable", "counts paused", "diff too large";
  the `title` explains).
  The options page's "Clear cached diffs" also empties the worker's ten-minute memory cache (`geld:clear-diff-cache`).
  The action is extension-only (`surfaces: ['extension']`): the site has no channel to the extension's `storage.local`.
- **Commit links get the breakdown tooltip on hover intent** (`src/github/commit-hover.ts`, gated with the list chips by `showListStats`).
  Any same-origin link to `/owner/repo/commit/<sha>` or `/pull/N/{commits,changes,files}/<sha>` (the PR timeline, the Commits tab — whose React version links each commit to `/changes/<sha>` — and branch commit lists) counts, except links GitHub already gives a commit hovercard (`data-hovercard-url` containing `/commit/`, rewritten by the surface above) and the page's own URL.
  A PR can list hundreds of commits, so nothing is fetched up front and no link gets a listener: one delegated `mouseover`/`mouseout`/`focusin`/`focusout` on the document, and a link must rest under the pointer for `HOVER_INTENT_MS` (300 ms;
  focus is immediate) before `DiffSource.request` runs for `/commit/<sha>.diff` (cached per SHA).
  Until the diff lands the tooltip shows skeleton rows in the breakdown's shape (`showTooltipLoading(host, LoadingShape)`: "Essential" + one hidden row + "Total" when any category is on — a commit rarely touches more than one — else a single row;
  known labels as text, Primer-style shimmering bars for the numbers, still under reduced motion;
  "Counting" for screen readers only);
  the diff source's `onChange` re-applies, and `applyCommitHover` re-presents the armed link when its state object changed.
  Rate-limit and definitive failures get a one-line message.
  **A wrapped link's tooltip hangs under the line the pointer is on** (`tooltip.ts`: `mergeLineRects` folds the anchor's client rects into one per line, `lineIndex` picks the line under the pointer's viewport y — the nearest in the leading between lines, the first with no pointer;
  `position` anchors to that line rather than to `getBoundingClientRect`'s union, which hung the box under a last line that may not even reach the pointer's column).
  The point comes with the show (`TooltipPoint`: `mouseenter`'s `clientY` for bound hosts, the `mouseover`'s for commit links, none on focus), is kept while the same host is re-presented (the diff arriving), and the hovered commit link alone gets a `mousemove` listener from the moment it is hovered (`watchPointer`;
  a link focused first gets it when the pointer arrives), so the pointer crossing to another line during the intent wait opens the box under the right one and crossing after moves it (`moveTooltipPointer`, which re-positions only when the line changes) — the cursor itself is never followed.
  Subject parsing shared with the diffstat surfaces lives in `src/github/subject.ts`.
- **Chips never repeat the page's own PR in the merge box checks list**: each check row's name links to `/pull/N/checks?check_run_id=…`, which `findRows` (`pr-list.ts`) skips by the query parameter, so the `react-list` surface (which those `li[role="listitem"]` rows otherwise match) leaves them alone.
  The stack list *does* include the current PR on purpose — every stack entry gets counts.
- **Pull requests hidden by author** (`@geld/core/pr-authors.ts`, `src/github/pr-authors.ts`, setting `hiddenAuthors`, section `lists`).
  Login patterns with `*` wildcards, case-insensitive, brackets literal (`*[bot]` = every GitHub App). the row's surface reads the author (classic: the "pull requests opened by X" link title;
  React list: `a[data-testid="author-filter-link"]`'s "Filter by author X" label;
  `author:app/<name>` hrefs → `<name>[bot]`);
  matching rows get `data-geld-author="hidden"` and each list gets one note (`.geld-author-note`, a `li` wrapper inside `ul` lists) with a Show that flips the list to `data-geld-authors-shown` for the visit.
  Stack-popover items carry no author and are skipped.
- **Repositories can configure Geld for everyone reviewing them** (`@geld/core/repo-config.ts`, `src/github/repo-config-source.ts`).
  A committed `.github/geld.yml` (and an org's defaults in `owner/.github`, `geld.yml` at the root or under `.github/`) uses the settings vocabulary — `categories`, `groups`, `categoryPatterns`, `customCategories` — and is checked by the same strict validator plus `collectRepoConfigIssues` (personal keys such as `enabled`/`repoRules` are rejected, unknown keys ignored).
  `.gitattributes` `linguist-generated` lines feed the Generated category via `generatedConfigFrom`.
  **A sign-in page at a repository URL gets nothing** (`isSignInInterstitial`, `page.ts`: GitHub marks its login, organisation SSO and 2FA pages with `session-authentication` on `<body>`;
  `runPass` and the pre-paint header path stand down there, since every request for the repository's data would answer 401 in the console).
  **No lookup may 404 in the page** — the browser prints every failed `fetch` as a red console error attributed to Geld, and most repositories have none of these files.
  So (`RepoConfigSource.readFile`): the repository's own files are fetched `/{owner}/{repo}/raw/HEAD/{path}` from the page origin (session cookie → private repos work;
  the redirect to raw.githubusercontent.com is CORS-open) but only after GitHub's directory listing (`/{owner}/{repo}/tree/HEAD[/dir]?noancestors=1` with `Accept: application/json` → `payload.tree.items[].path`, 200 whenever the repo is visible;
  memoised per directory) says they exist — an unusable listing falls back to the direct fetch.
  The org's `.github` repository is read by the background (`geld:fetch-file`) from `raw.githubusercontent.com/{org}/.github/HEAD/{path}` **without credentials**: the worker has no host permission there, CORS applies, and the host's `*` is only accepted uncredentialed (which is also why the worker cannot follow github.com's `/raw/` redirect;
  adding the host permission would disable the extension on update until users re-approve).
  That requires the `.github` repo to be public — GitHub's own rule for default community files.
  Enterprise hosts serve raw files on their own origin and are fetched by the worker with credentials.
  Text is cached per `github:{owner}:{repo}:{path}` in `local:repoConfigCache` for 30 min, and `GeldController.effectiveSettings(repo)` layers the valid configs (org, repo, gitattributes;
  later wins, user `!` rescues stay first) under `createMatcher`.
  The header waits for a pending lookup so it settles once.
  Gate: setting `repoConfigs` (`always` / `ask` / `never`, a `choice` schema field);
  `ask` answers are per repo in `local:repoConfigChoices` and taken in the popup, which also names whose config is in use and lists problems.
  Files hidden by a repo config are counted and listed like any other — that is deliberate, hiding is the attack surface.
  **One key is the repository's own: `reviewBots`**, a list of review-bot registry ids (`bugbot`, `coderabbit`, …) naming the bots installed on it, allow-listed rather than free logins because the extension knows what to post, read and show only for registry entries;
  core cannot import `@geld/review`, so `parseRepoConfig(text, catalog, knownBots)` takes the ids from the caller (`RepoConfigSource` passes `REVIEW_BOTS`;
  the site passes nothing and checks shape only), and an unknown id fails the file like any other problem, with the known ids in the message.
  The same directory listings answer which bots have one of their own config files in the repository (`ReviewBot.configFiles`: `.coderabbit.yaml`, `.cursor/BUGBOT.md`, `greptile.json`, `.github/copilot-instructions.md`, `.gemini/`, `.capy/`, `.codex/`;
  never `AGENTS.md`, which every agent reads) — `RepoConfigSource.botConfigs(origin, repo)`, memoised for the same half hour, independent of the `repoConfigs` setting since it reads the repository and applies nothing.
  Every key and valid value is documented on geld.sh/repo-config (`apps/site/app/repo-config/page.tsx`, rendered from `@geld/core` and `@geld/review/bots`, so the site depends on the review package too).
- **Popup and options styling mirrors the site**, not GitHub: `src/ui/base.css` declares the same oklch tokens as `apps/site/app/globals.css` with `light-dark()`, bundles Geist/Geist Mono variable fonts (`src/ui/fonts/`, OFL), keeps everything square except buttons and the account control (`corner-shape: bevel square` on TL/BR;
  where the property is missing — Safari — the `hyperellipse` polyfill is dynamically imported by `src/ui/corner-shape.ts` from the popup/options entrypoints only, reads the `--corner-shape` twin declared next to the native property, and `--corner-scale: 0` keeps corners square until it runs;
  the site does the same in `components/corner-shape-polyfill.tsx`, gated on `CSS.supports`, so Chrome never downloads the chunk), and uses the site's 36×20 switch with a 12px thumb.
  Change a token in both places or not at all.
- **Safari ships through a thin Xcode wrapper** in `apps/extension/safari/` (generated once with `pnpm --filter @geld/extension safari:project`, i.e. `xcrun safari-web-extension-converter --copy-resources`;
  committed, including the copied extension build under the extension target's `Resources`).
  Before every App Store archive run `pnpm --filter @geld/extension safari:sync`: it rebuilds the Safari flavour, rsyncs it over `Resources`, sets `MARKETING_VERSION` from `package.json` and bumps `CURRENT_PROJECT_VERSION`.
  Archive/upload happens in Xcode (`safari:open`, Product → Archive, Distribute App → App Store Connect);
  submissions must come from a release Xcode, not a beta.
  Bundle ids `sh.geld.safari` / `sh.geld.safari.Extension`.
- Toolbar icon dark mode: Chrome/Edge use an offscreen `MATCH_MEDIA` document;
  Firefox uses `theme_icons`;
  Safari tints template icons.
  Icons are pixel-snapped renders of `assets/brand/geld-logomark.svg` (see git history for the generator approach;
  regenerate at 1/2/3 px per grid unit).

## Website (apps/site)

A small, fast marketing site for geld.sh, not a docs site.
Run it with `pnpm --filter @geld/site dev` (or `pnpm dev:site`);
`pnpm --filter @geld/site check` runs typecheck, lint, unit tests and a production build, and is part of root `pnpm check`.

- **Stack:** Next.js 16 App Router with `cacheComponents: true`, Tailwind CSS 4, shadcn components generated on **Base UI** (`components/ui/`), the `cn` package for class merging, Geist via the `geist` package, `lucide-react` icons.
  Everything is prerendered;
  the only cached-async piece is the latest-release lookup (`lib/release.ts`, `use cache`, revalidated hourly, falls back to the Releases page when there is no release yet).
  Light/dark follows `prefers-color-scheme` by default;
  the footer's theme menu (`components/theme-menu.tsx`, `lib/theme.ts`) can pin a scheme via `data-theme` on `<html>`, persisted in localStorage and applied by an inline script before paint.
  Colour tokens use `light-dark()` keyed on `color-scheme`, and the `dark:` variant covers both cases (globals.css).
  Nothing on the site is rounded except the GitHub-imitating demo visuals (kept round on purpose).
  Calls to action — buttons, button-like links, clickable pills — use the `geld-corners` utility: square with the top-left and bottom-right corners cut via `corner-shape: bevel square` (size from `--geld-cut`, `geld-cut-*`), echoing the logomark;
  hover deepens the cut by 3px (a child inside `group/geld`, like the account avatar, follows its parent's hover), and an `::after` pseudo-element makes the hit area the full square plus 1px so the cut-away corners are still clickable.
  Browsers without `corner-shape` get plain square corners.
  Form fields, chips, cards, popups and badges are plain squares.
  Hover details that phones must reach (the count breakdowns) use `components/ui/popover.tsx` (opens on hover and tap), not the tooltip.
  The white brand SVGs are shown in dark mode by toggling two `<img>`s with that variant (`components/logo.tsx` references `assets/brand/` via `new URL(..., import.meta.url)`);
  the SVG favicon can only follow the OS.
- **Feedback goes through the site.**
  The extension's Feedback links (popup footer, options footer, `src/ui/feedback-link.ts`) point at `https://www.geld.sh/feedback?version=…&browser=…&page=…` (never a URL or a login), and `app/feedback/route.ts` forwards to a new issue on the repository with the issue form `.github/ISSUE_TEMPLATE/feedback.yml` pre-filled.
  The hop exists so the destination can change (a form on the site opening issues through the Geld App on a private tracker, once the source is closed) without a store release.
- **Pages:** `/` (hero, before/after PR header + hidden row built from `components/demo/sample-pr.ts`, which classifies its sample files with `createMatcher(DEFAULT_SETTINGS)` so the picture cannot lie;
  install buttons;
  live "try a path" demo in `components/path-tester.tsx`), `/how-it-works`, `/patterns` (rendered from `CATEGORIES` — the same source `catalog/patterns.json` is generated from — never hand-written;
  no runtime fetch, so a catalog change reaches the site with the next deploy), `/faq`, `/privacy` (doubles as the store privacy policy).
  Favicons are drawn from the brand SVGs at build time (`lib/brand.ts`);
  the OG image (`app/opengraph-image.tsx`) combines the wordmark with a real 2× screenshot from `assets/screenshots/` (embedded as a data URL, `loadScreenshot`).
  Re-capture that screenshot with the extension on a public PR when the header UI changes;
  the Vercel ignore script watches the folder.
- **Data that must stay in sync with the extension:** the version comes from `apps/extension/package.json` (`lib/version.ts`);
  patterns and categories from `@geld/core`;
  install links from the latest GitHub Release until store listings exist — set a URL in `STORE_URLS` (`lib/downloads.ts`) to switch a browser over.
  Author profile URLs live in `lib/site.ts` (entries with `url: null` are not rendered).
- **Deployment:** Vercel, dreamthinkbuild account, Root Directory `apps/site`, domain geld.sh.
  `apps/site/vercel.json` points the Ignored Build Step at `scripts/vercel-ignore.sh`, which skips builds for commits that only touch the extension (core, the extension's `package.json`, brand assets and the lockfile do trigger builds).
- **No database, ever.**
  The only user data is the settings gist on the user's own GitHub account.
  The site signs users in with the **same Geld GitHub App** as the extension, via the web flow (the App's callback URLs are `https://www.geld.sh/auth` and `http://localhost:3000/auth`;
  the extension's device flow never uses them).
  The canonical host is **www.geld.sh** (`SITE_URL`);
  the apex 308-redirects to it.
  `callbackOrigin()` returns the same origin as `authOrigin()` and must match a registered callback exactly.
  Code: `app/auth/start` (state cookie + redirect to GitHub;
  no `scope`, the App's permissions decide), `app/auth` (callback: verify state, `exchangeCode` from `@geld/github`, `fetchGitHubProfile`, set cookie;
  if the previous session was an OAuth App one, revoke that token with the legacy credentials), `app/auth/signout` (POST: clear + best-effort revoke with whichever app issued the token), `app/auth/refresh` (renews an expiring App token and redirects back;
  pages redirect here on `stale`), `app/auth/expired` (pages redirect here on `SignedOutError`).
  Only routes/actions may write cookies, so **`resolveSession(config, writable)`** in `lib/auth/session.ts` is the one entry point: with a cookie store it refreshes inline (server actions, route handlers), with `null` it only peeks and returns `stale` for a token within five minutes of expiry (pages).
  `lib/auth/config.ts` reads `GELD_APP_CLIENT_ID`, `GELD_APP_CLIENT_SECRET`, `AUTH_SECRET` (all server-only;
  `AUTH_SECRET` derives the AES-GCM key in `lib/auth/crypto.ts`) plus the optional legacy `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` used only to revoke OAuth App tokens, and the redirect origin comes from `authOrigin()` — `http://localhost:3000` in development, `SITE_URL` otherwise, never from request headers.
  The token pair (access + rotating refresh token, `lib/auth/session-model.ts`) lives only in the encrypted HttpOnly `geld_session` cookie (30 days, rewritten on every refresh);
  a readable `geld_account` cookie carries login + avatar for the header.
  Old cookies without the new fields read as `auth: 'oauth'` sessions and `/settings` shows the shared `ReconnectNotice` above the form.
  `/settings` renders `sectionsFor('site')` and reads/writes the gist with `@geld/core/gist-sync` through server actions (`app/settings/actions.ts`) that re-read the gist (strictly, via `readRemoteValidated`) before layering a change on it;
  an `invalid` gist renders the shared `CORRUPTED_SETTINGS_COPY` alert (`components/settings/corrupted-settings.tsx`) with the issue list, an Open gist link and a reset-to-defaults action instead of the form, and saves are refused until it is fixed.
  The site accepts no uploaded files today;
  if it ever does, run them through `validateSettingsDocument`.
  `/auth*` and `/settings` are dynamic;
  everything else stays prerendered.
- **Auth environments.**
  Production has the App variables (and, during the migration period, the legacy OAuth ones) in Vercel.
  **Preview deployments deliberately have none** (their hostnames are random, so no callback could be registered) and `authConfig()` additionally returns `null` whenever `VERCEL_ENV` is not `production`, so `/settings` shows "Sign-in isn't configured in this environment" and the build still succeeds.
  Local development uses the *same* App (its `http://localhost:3000/auth` callback);
  put the values in `apps/site/.env.local` (see `.env.example`, or `vercel env pull` from the Development scope) with a different `AUTH_SECRET` per environment.
  Without real credentials the flow can be exercised against a fetch mock, which is how it was verified.

## Code review bots

Two review bots are installed on the repository, both **manual-trigger only** (community PRs are reviewed on request, not on every push): **Cursor Bugbot** — comment `bugbot run` (or `cursor review`) on the PR;
repo settings in `.cursor/config/bugbot.yaml` (read from the default branch only), review guidance in `.cursor/BUGBOT.md`, the "run only when mentioned" switch lives in the Cursor dashboard per repository.
**Greptile** — comment `@greptileai`;
config in `greptile.json` (`skipReview: "AUTOMATIC"` is the manual-only switch;
note Greptile reads the file from the PR's *source* branch).
`.github/CODEOWNERS` makes those files owner-reviewed.
Keep `BUGBOT.md` in step with this file when an invariant changes.

## Verifying changes

There is no GitHub login available to automation here.
Verify against public pages: `https://github.com/wxt-dev/wxt/pull/2544/files` (classic view, 6 test files), `https://github.com/wxt-dev/wxt/commit/d05ac55ba78b7d01c5ab9feb0e862775e45509ef` (React view), `https://github.com/vitest-dev/vitest/pull/10554/files` (124 files, progressive loading), `https://github.com/wxt-dev/wxt/pulls` (PR list).
Branded Chrome ignores `--load-extension`;
install the built folder with Puppeteer's `browser.installExtension()` after launching with `enableExtensions: true`, `pipe: true` and `--enable-unsafe-extension-debugging` in `args` — all three (the option only drops Puppeteer's default `--disable-extensions`, without which the install "succeeds" but the extension stays inert: no service worker, `ERR_BLOCKED_BY_CLIENT` on its pages;
the flag is what makes `Extensions.loadUnpacked` available;
the pipe is required for it), and bring a tab to the front before interacting with it (background tabs stall element handles).
The full launch recipe, with a service-worker sanity check, is in `.claude/skills/github-surface/SKILL.md` §4.
