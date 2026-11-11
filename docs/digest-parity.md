# Digest parity: GitHub, GitLab and Bitbucket

Status: audit, no behaviour change.
Written on Nov 10, 2026 against the stack tip `codex/provider-expanded-digest-parity` (#590, `7a1c83ef`).
Nothing is stacked on #590 yet.
This document is the first step of the parity work: it records where GitLab and Bitbucket stand against GitHub's digest, proposes the shared model that should drive all three, and lists the decisions the owner needs to make before any reorganisation starts.
It is written one sentence per line, like `AGENTS.md`, so that pull requests touching different lines merge cleanly.

## 1. Summary

The port renders natively on each host, but it is a different design from GitHub's digest, not a skin over it.
Five structural differences explain most of the gap:

1. **No native slots.** GitHub's digest lends GitHub's own live nodes to the panel (`teleport.ts`, `quick-view.ts`, `chat.ts`, the MAIN-world portal), so CI, threads, replies, reactions and menus stay GitHub's.
   The provider renderer (`providers/review-panel.ts`) rebuilds every row from fetched or sanitised copies, and only proxies a few native controls (Reply, Resolve, the status menu) by scrolling to or clicking them.
2. **No rounds.** GitHub's default grouping is by type with rounds ("N rounds to review", settled rounds, a current round that is never settled), and by push it is "Needs attention" plus "N pushes".
   The provider default nests threads under each reviewer and bot, with a flat "Comments · N" split into push rounds, and its by-push view has no "N pushes" header.
3. **No one-open accordion.** Every provider disclosure toggles on its own (`disclosure()`), where GitHub keeps at most one row open (`visit.openKey`) and restores focus by key.
4. **Status rows differ in set and order.** The providers show Reviews, Merge checks, Review bots, Agent notes, Reports, CI checks, Previews.
   GitHub shows Reviews, Review bots, Reports, CI checks, Previews, Deployments, Agent notes (Agent notes sits under Review bots in the code, see §3.1).
5. **Bots are re-modelled.** A provider bot is recognised only after the reader binds its account in settings, and the Review bots row lists one disclosure per bot rather than GitHub's pill row, bot lines, one-bubble summary chats, threads as chips, Rerun, View, See latest and the "Request a review" checklist.

Both hosts share one renderer, which is why GitLab and Bitbucket resemble each other and not GitHub.
The data side of the port is in some ways cleaner than GitHub's (typed `ProviderReviewInput`, explicit coverage and `unavailable` areas), and that part should be kept and grown into the shared document proposed in §5.

## 2. Known problems from the owner's testing (§2a of the handoff)

All five were reproduced in code, and the approval facts were read live from GitLab's public API on triage-ops !4544 on Nov 10, 2026.

### 2.1 GitLab Duo's approval

Live facts on !4544:

- `GET …/merge_requests/4544/approvals` answers `approvals_required: 2`, `approvals_left: 2`, `approved: false`, and lists `GitLabDuo` in `approved_by` with a plain user object: no `bot`, no `user_type`.
- `GET …/approval_state` lists three rules, "All Members" (`any_approver`), `*` (`code_owner`) and "Coverage-Check" (`report_approver`), each requiring 1 and each with an empty `approved_by`, so Duo's approval satisfies none.
- `GET …/reviewers` lists `GitLabDuo` with `state: approved` and again no bot fields.
- Only the page's own `discussions.json` marks the account: `bot: true`, `user_type: duo_code_review_bot`.

What Geld does today:

- `gitlab/review.ts` `fetchGitLabReview` reads `/approvals`, `/reviewers`, `/pipelines` and `discussions.json`, never `/approval_state`.
- Every `approved_by` entry becomes a reviewer with `state: 'approved'`, with no notion of whether it counts.
- `authorOf` marks an author automated only from `bot` or `user_type`, so Duo is automated only when one of its notes is in the discussions (the second pass at `review.ts` ~483).
  When it is, `review-panel.ts` drops it from Reviews and shows it in Review bots as an unbound `automated:<id>` row, not as a recognised bot, since nothing in `packages/review/src/provider-bots.ts` or `bots.ts` knows Duo.
  When it is not (no note yet, or the discussions failed), Duo is a person's approval in the Reviews row.
- The fraction itself is right: `reviewStandingSummary` derives `0/2` from `approvals_required` and `approvals_left`.
  Next to an "Approved" Duo, it reads as a contradiction.

Proposed fix, for the owner to confirm:

- Read `/approval_state` too, and record per approval whether it satisfies a rule, and which rule.
- Register GitLab Duo Code Review as a native review bot (account type `duo_code_review_bot`), so it is recognised without a manual binding and lands in the Review bots row.
- Show the fraction from the provider's rules alone, and name the approval that counted ("1 of 2 · Alice (code owner)").
- A bot approval that counts toward a rule (possible on GitLab, and for GitHub Apps on GitHub) is still a bot's, shown in Review bots, and the Reviews fraction says it counted.

### 2.2 A bot's approval against a bot that is merely clean

One glyph means several things today:

- GitHub uses `ICON_CHECK_CIRCLE_FILL` for a person's approval (`ENTRY_GLYPH.approved`), a bot's good health (`HEALTH_ICON.good`), resolved threads, passing CI, ready previews and active deployments.
- The providers use `digestIcon('check')` for a person's approval and for a bot's good health alike.
- The verdict model has no "approved" for a bot: `BOT_VERDICTS` is `clean`, `findings`, `failed`, `running`, `loading`, `unknown`, and a bot's "Verdict: approve" or "Would approve" is parsed as `clean`.

Proposal (a GitHub behaviour change, so its own pull request and the owner's approval first):

- Add a formal approval fact to a bot's record (`approved: { counts: boolean, rule?: string }`), separate from its verdict, read from the host (GitLab `approved_by`, GitHub's review state `APPROVED` by an App, Bitbucket participants).
- A bot that formally approved wears the approval treatment a person's verdict gets (the same glyph and colour as `ENTRY_GLYPH.approved`), on its pill and its line.
- A bot that is only clean or fully resolved wears a distinct "all clear" mark.
  The candidate is Octicons' `shield-check` in the success colour, which reads as "checked, nothing found" rather than "approved"; the alternative is the plain outline check.
- The hover card and accessible label say which it is, and for an approval whether it counts ("Approved · does not count toward the 2 required").

### 2.3 GitLab's count popover

- `gitlab/diff.ts` `gitLabHeaderTargets` makes the Changes tab's count (`[data-testid="diffs-tab"] .js-changes-tab-count`) a header target with `hoverHosts: [tab]`, the whole `a[data-action="diffs"]` link, on Overview and Changes alike.
- On Overview, with no `.diff-stats` counts on the page, the adjusted counts go into `.merge-request-tabs-actions` before `#discussionCounter`, on the right of the tab bar, which is where the owner wants them on every tab.
- `providers/controller.ts` `bindHeaders` binds each hover host to the breakdown, and `providers/hover.ts` opens it after the intent delay on hover of the tab.
- Clicking the tab focuses the link, `onFocusIn` records it as the focus host, and `onMouseOut` closes only when the focus host is not the active host, so the popover stays open after the click.

Proposed fix: on every tab, place the counts on the right of the tab bar as Overview does, bind the breakdown to the counts element only (never the tab), and have `ProviderHover` open on hover and on keyboard focus (`:focus-visible`) and close on leave and blur, with no pointer-focus pinning, matching `github/ui/tooltip.ts` `attachBreakdownTooltip`.

### 2.4 The lone "Essential" heading

- `providers/controller.ts` `applyFiles` calls `categoryTree.update` whenever `groupHidden` is on, and `providers/tree.ts` `update` clears only when there are no files at all and no hidden categories.
- GitHub's controller removes its tree section and sidebar layout when nothing is hidden ("Nothing hidden: GitHub's sidebar stays exactly as it was"), and keeps a panel only while a file-filter search is active.

Proposed fix: in `tree.ts` `update`, clear when `hidden.categories.length === 0`, keeping GitHub's search exception, so !4544's Changes tab shows GitLab's own tree with no Geld headings.

### 2.5 "Failed to load test coverage"

This is GitLab's own merge widget message, shown with Geld disabled, tied to the Coverage-Check approval rule (`report_approver`).
No Geld code hides, restyles or re-hosts GitLab's report widgets: `gitlab/merge-checks.ts` only reads the merge-check rows, and `gitlab/theme.css` is scoped to Geld's own classes.
The panel is placed at the end of the description, right above the merge widget, so the two can read as one.
Geld's own failure lines ("CI checks could not be read.") are similar in tone.
Record in the matrix: a host message, left as it is.
Proposed: keep the digest's bottom edge visibly Geld's (the "Built from this page" line GitHub's digest has), and word Geld's own failures so they name the digest.

## 3. Parity matrix

Legend: **match**, **partial** (what differs), **missing**, **n/a** (cannot exist on that host, and why).
"Source" is where the host's data comes from.
"Slot" says whether the host's own live node should be shown in Geld's layout (a native slot), and whether it is today.
Paths are under `apps/extension/src/` unless they start with `packages/`.

### 3.1 Status rows

| GitHub feature | GitLab | Bitbucket | Source (GL / BB) | Slot |
| --- | --- | --- | --- | --- |
| Rows only when they have something to say | partial: `review-panel.ts` `render()` | partial: same | — | — |
| Order: Reviews, Review bots, Agent notes, Reports, CI, Previews, Deployments | partial: the same order with the merge checks inside Checks, Deployments missing | partial: same | — | — |
| Merge checks / requirements | match: inside the Checks row, above CI (`mergeChecksList`, `gitlab/merge-checks.ts`) | match: same (`bitbucket/requirements.ts`) | DOM: merge widget rows / sidebar | should be a slot, today a copy |
| Deployments row | match: `deploymentsSection` from the merge request's `ci_environments_status` (`gitlab/deployments.ts`) | missing | GL: the merge widget's `ci_environments_status`, answered signed out · BB: `/deployments` (Pipelines) | data |

GitHub has no Merge checks row because its merge box sits under the digest and the status pill carries the merge choice.
Decision needed: keep Merge checks as a provider row, or fold it into CI and the status pill as GitHub does (see §7).

### 3.2 Review bots

| GitHub feature | GitLab | Bitbucket | Source | Slot |
| --- | --- | --- | --- | --- |
| Pill per bot with traffic light (`botHealth`) | match: `botsSection` chip lights a check, an amber dot, a red exclamation, the refusal triangle or a red cross | match: same | comments, checks | data |
| Recognised without setup (registry, `/apps/` links) | partial: needs a bound account in settings (`providerReviewWithTrustedAccounts`) | partial: same, and `bots: []` from the fetch | user `bot`/`user_type` (GL) · none reliable (BB) | — |
| Opened: one line per bot (`botLine`) | partial: a disclosure per bot with health, verdict, score, reason, "View review" | partial: same | — | — |
| Line opens to latest summary as a one-bubble chat | match: the latest summary is seated on its line (`seatedSummaries`), not in its round, and still previews on hover | match: same | sanitised copy | should be a slot (the note node) |
| Run's threads as chips (`threadHeadOf`) | partial: the bot's threads nested by status | partial: same | discussions / comments | — |
| Rerun on the summary | partial: CodeRabbit and Greptile only, "Copy command" and "Open native comment", never posts (`gitlab/bot-request.ts`) | missing | — | — |
| View (bot site badge) | missing | missing | comment body | — |
| See latest | missing | missing | — | — |
| Request a review checklist | missing | missing | — | — |
| Bot approval distinct from clean | missing (see §2.2) | missing | GL `/approval_state` · BB participants | — |

### 3.3 Reviews

| GitHub feature | GitLab | Bitbucket | Source | Slot |
| --- | --- | --- | --- | --- |
| Pills per reviewer by latest verdict, grouped approved, changes requested, commented, awaiting | match: one pill per person in that order, each verdict as its glyph, awaiting dashed with the amber dot (`reviewStandings`) | match: same | GL `/approvals`, `/reviewers`, MR `reviewers` · BB `participants` | data |
| Required approvals fraction | partial: from `approvals_required`/`approvals_left`, no rules (§2.1) | missing: recorded as unavailable, merge checks read from the sidebar | GL `/approval_state` · BB branch restrictions (needs admin), sidebar DOM | — |
| Index of reviews leading to their round | missing: the Reviews row lists standings, the rounds hold the threads | missing: same | — | — |
| ⋯ Request reviewers menu | partial: "Reviewer controls" focuses GitLab's sidebar widget | missing | native sidebar | slot (the sidebar widget) |
| Dismiss review, Re-request | missing | n/a for Dismiss (Bitbucket has no dismissal), Re-request missing | GL: approvals reset / `requested_changes` | native controls |

### 3.4 CI, Previews, Reports

| GitHub feature | GitLab | Bitbucket | Source | Slot |
| --- | --- | --- | --- | --- |
| CI row shows the host's own checks section | missing: re-rendered from jobs (`checksSection`) | missing: re-rendered from statuses | GL `/pipelines`, jobs · BB `/statuses` | **slot**: GitLab's pipeline mini-graph or merge widget pipeline section, Bitbucket's builds panel |
| Status ring and counts | partial: counts by state with host icons, no ring | partial: same | — | — |
| Workflows awaiting approval ("Run") | n/a as such; GL manual jobs and blocked pipelines are the nearest | n/a | GL jobs `manual` | — |
| Previews pills, links, last successful | partial: `previewsSection`, shared parsers since #561 | partial: same | comment bodies | data |
| Reports pills and hover card | partial: check reporters only, from job or status URLs | partial: same | jobs / statuses | data |
| Comment reporters (Socket, Blacksmith…) | unverified | unverified | comments | data |

### 3.5 Groups, rounds and nested rows

| GitHub feature | GitLab | Bitbucket | Source | Slot |
| --- | --- | --- | --- | --- |
| By type: "N rounds to review", settled, current round | match: `roundSections`, rounds from push system notes | match: rounds from `/activity` updates | GL commit system notes · BB `/activity` updates | — |
| By push: "Needs attention", "N pushes", newest first | match: `historySections` heads the pushes "N pushes", with what came before the first push as its last entry | match: same | GL commit system notes · BB `/activity` updates | — |
| Grouping menu in the Geld row | match: `toolbarMenu` | match | — | — |
| Thread opens to a chat of the host's own nodes with its reply box | partial: GitHub's chat layout (one box at the word column, reader on the right, runs, byline outside the bubble, ⋯ on the empty side) over sanitised copies (`chatMessage`); Resolve and Reply relay the host's own controls behind the ⋯ (`gitlab/thread-actions.ts`) | partial: same (`bitbucket/thread-actions.ts`) | discussions | **slot**: GitLab's `.discussion` node, Bitbucket's comment thread |
| Pinned source strip | match | match | the bot's same-run summary, live only: no edit history to show past readings | — |
| One-open accordion, focus by key | match: opening a row closes the open one (`ACCORDION_ROW`), groups fold on their own | match: same | — | — |
| Rows never jump | partial: status-only updates keep position, a full render replaces children | partial: same | — | — |
| Times line up down a list | unverified | unverified | — | — |

### 3.6 Other activity and the Geld row

| GitHub feature | GitLab | Bitbucket | Source | Slot |
| --- | --- | --- | --- | --- |
| Timeline events row with headline | partial: "Activity · N" by type (`eventRow`) | partial: same | GL system notes · BB `/activity`, `/tasks` | GL system note nodes could be slots |
| Commits | partial: push events only | partial: same | GL `/commits` · BB `/commits` | — |
| Mentions | partial: Incoming and Outgoing references | partial: same | page and API | — |
| Native timeline folded in compact mode | match: `ProviderConversation.syncCompact` | match | — | — |
| Copy digest | match | match | — | — |
| AI triage | match (#548) | match | — | — |
| Hidden people | partial: no block lists | partial: same | — | — |
| Agent notes | match: from the description | match | — | — |
| Flow | match (#557) | match | — | — |
| View menu and intro | partial: View option, placement above or below | partial: same | — | — |
| Status pill menu (merge, queue, draft, close, bypass) | partial: opens GitLab's own actions menu | partial: opens Bitbucket's "More actions" | — | the host's menu, acceptable as a slot |
| Review group (approve, request changes, comment) | match in shape (`renderProviderActionControls`) | match in shape, comment plus verdict hands off to the native writer | — | — |
| Header counts and breakdown | match: counts in the tab bar on every tab, hover and keyboard focus only | match: same rule for its Files tabs | diff | — |
| Changes-tab category accordion | match: none when nothing is hidden | match: same rule | diff | — |

### 3.7 Gaps that cannot close

- **Bitbucket has no review dismissal and no "requested changes" fraction**: required approvals live in branch restrictions, readable only by admins, so the digest says the requirement is unknown rather than inventing one.
- **Neither host exposes comment edit history** the way GitHub's `user_content_edits` does, so pinned-source revisions ("as it read when this thread was opened") cannot exist there; the strip shows the live comment and says so.
- **Bitbucket does not mark bot accounts** in its API: bots stay a reader binding (or a registry of known account ids) there.
- **Block lists**: neither host exposes the reader's or the organisation's blocks to a content script.

## 4. GitHub-visible changes already in the stack

Read from `git diff main...` the tip over `src/github/`, the popup, options and background, `src/lib/`, `apps/action/src`, `packages/review` and `packages/core`.
The GitHub content script entrypoint and the page-world portal are untouched, and five of the six changed files under `src/github/` are moves or re-exports.
What a GitHub user or the Action would notice:

**Seen by GitHub users**

1. The popup and options page show "Additional sites" with Enable GitLab and Enable Bitbucket for everyone, and some copy turns provider-neutral ("Open a supported repository").
2. `packages/review/src/bots.ts` `checkWords` now strips only a "Completed in N" or "Successful in N" prefix from a check's description, where it stripped everything up to the first dash.
   A skipped check whose text starts with other timing ("Failing after 7s — …") may now show that whole string as the bot's skip reason; needs a check against the merge box's wording.
3. In-page AI results are now saved through the background (`review/ai.ts` `store()`, `lib/local-review-write.ts`), with a 2 s tab confirmation and size limits.
   If the confirmation times out or a limit is broken, `store()` throws inside `runAi` and the AI control may be left looking busy; needs a check.
4. `packages/core/src/diff-parse.ts` reads quoted, one-side-quoted and octal-escaped paths correctly, so files with spaces or non-ASCII names get their real paths in counts, categories and tooltips (a fix).
5. The manifest description names GitLab and Bitbucket, and `scripting` is an optional permission on MV2.
   GitLab and Bitbucket origins are kept out of the required host permissions, so an update should not disable the extension; confirm they are optional on MV3.
6. Options: "Clear cached diffs" also clears provider caches; the empty Enterprise message reads "Saved. No additional GitHub Enterprise hosts."; the Review bots field shows its syntax help.
7. Settings: a new `digestAboveDescription` toggle (extension only), and two new Experiments lists, Trusted review accounts and Trusted summary publishers, which have no `surfaces` limit and so also show on geld.sh.
   The Hidden people help now advertises Bitbucket's `bitbucket.org/uuid/<UUID>` form, while `packages/core/src/pr-authors.ts` is unchanged; check that `authorRuleProblem` accepts it.

**What the Action posts or reads**

1. `apps/action/src/github.ts` `findSummaryComment` reads its previous payload only from the exact published frame (`parsePublishedSummaryBody`).
   An old fenced summary, or one whose AI TL;DR holds an unbalanced fence, now reads as no payload: the comment is still updated, but earlier AI wording is not carried over and the model is asked again.
2. `summary-render.ts`: the body is byte-identical except that inline code holding double backticks, and a suggested fix holding a fence, get a longer fence (both fixes).
3. `model.ts`: new optional fields (`ReviewSource.sourceId`, `authorId`, `automated`, `provider`, `origin`, `url`, `BotVerdictRecord.checkSha`, `GeldPrMeta.nativePublication`), none emitted by the GitHub Action, so GitHub payloads validate as before.
4. `cluster.ts` `firstSentence` skips lines with no letters or digits and strips a leading Greptile P1/P2 badge, which can change item titles in the summary and the panel.

**Before the stack lands**

`main` is six commits past the stack's base.
#545 and #546 rewrote `src/github/attachment-viewer.ts`, which the stack moved to `src/ui/attachment-viewer.ts` from the code before #545, and the GitHub wrapper does not pass `large: true`: a careless merge would undo #545 on GitHub.
#576 touches the manifest, popup and options copy that the stack also edits.

Items 2, 3 and 7 and the Action's stricter read are behaviour changes a GitHub user could notice, and under the handoff's rule they need the owner's approval or a split into their own pull requests.

## 5. Proposed architecture

### 5.1 `DigestDocument`

A pure, zod-validated document in `@geld/review` (`digest-document.ts`), with no DOM and no callbacks, filled by each adapter.
The first slice is built: subject, reviewers, requirement, bots, checks, items, previews, events, coverage and capabilities, with `digestFromProvider`, `digestFromMeta` and `digestDocumentIssues`.
Deployments, reports, agent notes, related links and work, mentions and pushes join as the rows that need them move onto the document.
It holds every fact a row needs:

- `subject`: provider, origin, repository, id, head, state (open, draft, merged, closed), author.
- `reviewers[]`: login, kind (person or bot), standing (approved, changes requested, commented, awaited), whether the approval counts and toward which rule, request state, anchor.
- `requirement`: approvals required and left, rules with their state, or `unknown` with a reason.
- `bots[]`: today's `BotVerdictRecord`, plus `approval` (§2.2) and `presence` (seen, declared, configured).
- `checks`: counts by state and per-check rows (`RawCheckRun`), coverage.
- `previews[]`, `deployments[]`, `reports[]`, `agentNotes[]`, `relatedLinks[]`, `relatedWork[]`, `mentions[]`.
- `items[]`: today's `ReviewItem`s with their `ReviewSource`s and thread state.
- `pushes[]`: id, head, time, commits; and `rounds[]` as anchors per push, built by the layout, not the adapter.
- `events[]`: kind, actor, time, anchor.
- `coverage`: per area `complete`, `partial`, `unavailable`, with a reason, which already exists in spirit as `ProviderReviewSnapshot.unavailable` and `checksCoverage`.
- `capabilities`: what the host can do at all (dismiss reviews, edit history, bot accounts, merge queue, deployments), so the layout never asks `provider === …`.

Relation to `GeldPrMeta`: the document **wraps** it.
`GeldPrMeta` stays the Action's wire format (versioned, size-budgeted, in a comment), and `DigestDocument.fromMeta(meta, live)` lifts it in, as `withLiveRuns` does today.
`ProviderReviewInput` becomes the adapter-facing subset that fills the document, so there is one schema with one entry point per source rather than two overlapping ones.

### 5.2 Native slots

A typed registry, separate from the data: `ci`, `thread(anchor)`, `comment(anchor)`, `reviewers`, `status`, `mergeChecks`, `summary(botId)`.
Each host implements the slots it can, and the layout asks for a slot by name and falls back to rendering from the document.
On GitHub the registry is the existing loan machinery, unchanged: placeholders, no cloning of React nodes, `restoreAll`, `reclaimOrphans`, the MAIN-world portal.
On GitLab, Vue owns the merge widget and discussions, so the same rules apply: move, never clone, put back before Vue's next patch, and verify that Vue tolerates a moved node (Vue 2 patches by reference, so a placeholder in the parent should hold as React's does with the portal's parent patch; unverified).
On Bitbucket the page is React, so the portal approach carries over more directly.
CI is the first slot to build on both hosts.

### 5.3 Layout model

Pure functions from document plus UI state to a `DigestLayout`: rows, groups, nested rows, order, counts, tones, the open key and what is seated where.
The source today is GitHub's `overview.ts` (`buildBatches`, `seatFor`, groups), `panel-model.ts` and the model half of `panel.ts`.
Moving them means separating the pure parts from the DOM reads they are interleaved with, which is most of the work and is why GitHub moves last.

### 5.4 Per-host renderer and skin

A thin renderer per host draws the layout with the host's tokens and mounts slots.
GitHub keeps its renderer until the migration, and the provider renderer is replaced section by section.

### 5.5 Adapter contract

An adapter must fill `subject`, `items` and `coverage`, and may fill everything else, declaring what it cannot read as `coverage` and what its host cannot do as `capabilities`.
A conformance suite in `@geld/review` runs every adapter's fixtures (full, partial, missing, unknown states) through the document schema and the layout, and checks that no row claims what coverage denies.
A short "Adding a provider" guide goes beside this document.

## 6. Other provider families (design input only)

Nothing below is built until GitHub, GitLab and Bitbucket reach parity.
Each family should fit through an adapter alone; where it does not, the document needs a field first.

- **GitHub family** (github.com, Enterprise Server, Enterprise Cloud with data residency): the same adapter with per-host origins, already supported for user-added hosts.
- **GitLab family** (gitlab.com, self-managed, Dedicated): one adapter, with `capabilities` per version (approval rules are Premium, Duo is Ultimate add-on).
- **Bitbucket Data Center**: a separate adapter from Cloud, with a different REST API (`/rest/api/1.0`), its own "Needs work" reviewer state, which maps to changes requested, and merge checks readable without admin.
- **Gitea, Forgejo, Codeberg**: reviews with approve, request changes and comment, required approvals by branch protection, Actions-compatible statuses; close to GitHub's model, one adapter.
- **Gerrit** (googlesource, OpenDev, Wikimedia): the hardest fit.
  A change has patch sets, so `pushes[]` must be patch sets and rounds follow from them; votes are labels (Code-Review −2 to +2, Verified), so a reviewer's standing needs a `votes[]` map, with the label's own range, beside the plain verdict; submit requirements replace the approvals fraction, so `requirement` must be a list of named requirements, which it already is in §5.1; relation chains are stacks.
- **Azure DevOps** (Services and Server): votes Approved, Approved with suggestions, Waiting for author, Rejected, none, which map to the standing plus a `qualifier`; branch policies are requirements; Azure Pipelines are checks.
- **Launchpad, SourceForge**: merge proposals with votes and simple statuses; fit through the same fields.
- **Gitee, GitCode, GitFlic**: GitHub-like models; vocabulary to be translated per host rather than assumed.
- **Cursor's Origin**: pull requests and stacks; expected to fit the GitHub-like path.
- Watched only: Pagure, sourcehut (patches by mail, likely out of scope), OneDev, Harness Code, Tangled, Radicle.
- Left out: AWS CodeCommit, Phabricator.

## 7. Decisions

Answered by the owner on Nov 10, 2026.

1. **Bots go in Review bots, people in Reviews, on every host.**
   Any automated account is a bot for the digest, recognised from the host's own marks (GitLab's `bot` and `user_type`, GitHub's Apps) even when the registry does not know it, and is never listed in Reviews.
   Approval requirements are read from the host's rules, including group, project and repository rules where the host has them, so a bot whose approval a rule counts is seen as counting.
   How a bot's approval is worded on its pill is still open (see §8).
2. **Approval against clean stays as it is for now.**
   The shared check mark keeps both meanings; a distinct mark can be reconsidered later.
3. **The row is "Checks" on every host.**
   On GitHub it holds the CI checks as today; on GitLab and Bitbucket it holds their CI and their merge checks, with the details each host gives.
   Renaming GitHub's "CI checks" is a visible GitHub change and goes in its own pull request.
4. **The status pill uses the host's own menu where that menu is complete**, judged host by host.
   GitHub's was overridden because it lacked the merge and the stack's choices; GitLab's and Bitbucket's are to be assessed the same way.
5. **`GeldPrMeta` stays separate and `DigestDocument` wraps it.**
   `GeldPrMeta` is a wire format: versioned, size-budgeted to fit a comment, written by the Action and read by older extensions, so its schema has to change slowly and stay small.
   `DigestDocument` is the in-memory reading every renderer uses, and grows freely; `fromMeta` lifts one into the other.
6. **Order of work: §2.3 and §2.4 first, then the document and layout, then row by row, then GitHub.**
   Parity covers more than the digest: header counts and their breakdown, the Changes-tab categories, the sidebar's Related links and Related work, collapsible description headings and the cut, hidden and blocked people, and Flow.
   Each is checked against GitHub's implementation as the work reaches it, and the matrix grows a section for each.

## 8. Decided after the first answers

1. **A bot that approved reads "approved" on its pill, with no note about whether the approval counts.**
   The Reviews fraction is the host's own (GitLab's `approvals_required` and `approvals_left`), which already counts a bot approval wherever a rule does.
2. **Bots are recognised from the host's own marks, not only the registry.**
   GitLab: a note author's `bot`/`user_type`, and for approvers and reviewers GitLab's GraphQL `bot` flag, since the REST approval and reviewer lists carry none (GitLab Duo on triage-ops!4544).
   Bitbucket: an `app_user` account.
