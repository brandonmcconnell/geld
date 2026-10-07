# Idea: a Review tab that walks a pull request in steps, not files

Status: **being built** (Oct 2026). Phases 1 to 4 below are in `apps/extension/src/github/review-tab/` behind the `reviewTab` experiment; the assistant column (5), Jev's judgments (6) and the narrow and Enterprise passes (7) are not. Written to be carried out without further input: every open question below has a default, and the defaults together are a buildable spec. Companion idea: `scope-map.md` (the same inputs drawn as a map).

## What landed first, and what the page taught

- **The route is a hash, not a query.** GitHub's page script `replaceState`s the files URL to its canonical form once loaded and drops any query it does not know (`?geld=review` was gone within a second on wxt#2544) while keeping the fragment, so the tab is `/files#geld-review` (`page.ts` `pull-review`), and the in-place switch is a `pushState` of the fragment. The rest of section 1 holds.
- **The files layout hides as a fixed, invisible band, not with `display: none`.** Both experiences render diffs as they come into view, so the layout has to keep a viewport to intersect with. The band (`data-geld-review-area`, `visibility: hidden` on it and every descendant, since Primer's ActionList sets `visibility: visible` on tree sub-groups) sits behind the page and adds nothing to its scroll height; a file GitHub has not rendered is sought by moving the band up a viewport at a time (`--geld-review-seek`). The classic progressive loader rendered all 124 files of vitest#10554 this way without a seek.
- **A loaned file must still read as present.** The adapters read GitHub's container, and a file on loan to the step is no longer in it; reading `view.entries` alone flipped every file between "Loading…" and shown on alternate passes. The view reads the union of the adapter's entries and the files on loan to the current build.
- **Hunk folding keeps to `tbody` rows.** GitHub's diff `thead` is a clipped screen-reader header; a note row placed before a folded run that began there vanished with it.
- **Stories are written only for a plan the model made.** The rules' free grouping shows its own words and the footer offers "Plan with AI"; writing stories for every rules step on open would have spent tokens nobody asked for. (The idea said the story runs when the step is reached; it still does, for AI plans.)
- **Progress survives a push by step id and fingerprint**, as planned, and a stored plan is laid over a later diff by hunk signature (`remapProposals`) so stale hunk refs are never shown; new hunks gather under "Everything else" behind a Replan (AI) or Regroup (rules) notice. The rules plan is remade for free on a new head.
- **The rules producer needs stop-lists.** "Same stem anywhere" grouped four `package.json`s with a `cspell.yml`; generic stems (`index`, `package`, `main`, `types`, …) are left out, and lone files sharing a whole name or a directory join instead. Without commit file lists (over 12 commits, or signed out of the Commits JSON) the grouping is weak on purpose: that is what the model is for.
- **Verified in the headed harness** (`.claude/skills/github-surface/SKILL.md` §4) on wxt#2544 (classic files page, 2 commits → "Replace nano-spawn with tinyexec" · "Fix cspell" · "Tests"), on vitest#10554 (124 files, 27 rules steps), with a seeded AI-shaped plan splitting one file's hunks across two steps (the fold notes both ways, accept, flag with a note, the finish and its prefilled body, keyboard, both tab switches), and with a mock gateway in the service worker (plan call with 28 handles and the rules' candidates, stories for the current and next step, "Planned by mock/planner"). The React PR files experience and a signed-in finish were not reachable from the harness.

## What

A tab Geld adds to pull request pages, next to Conversation, Commits, Checks and Files changed, called **Review**. Files changed stays what it is today: the whole diff, browsable by category, with Geld hiding the noise. Review is for *doing* the review. It turns the pull request into an ordered list of **steps**, each one a body of work (a feature slice, a refactor, a fix) that may span several files and several languages, and the reviewer works through the steps in order: read a short plain-language account of what the step does and why, read the hunks that belong to it (and only those), accept it or flag it, move on. An assistant panel sits open beside the steps the whole time, already knowing the plan and the current step. At the end the reviewer is offered to mark everything viewed and to submit the review through GitHub's own form, with the flagged steps drafted into the body.

Three files touched by four features (a script, a stylesheet and a template each) become four steps, not three files.

## Why

- File-by-file review is an artefact of how diffs are stored, not how changes are made. A reviewer reconstructs the author's intent from the file list every time; the author already had it.
- "Viewed" per file says nothing about understanding. A step that is accepted says "I followed this change end to end".
- Geld already knows which files are noise and already has the two AI tiers, the diff cache, the review digest and the ability to loan GitHub's own rendered nodes into a Geld surface (`teleport.ts`). The tab assembles existing parts around a new unit of work, the step.
- Copilot's "explain this" on GitHub is an action the reader takes on a selection. Here the explanation is the default framing of the page and the raw diff is the evidence beneath it.

## Why not yet

- It is the first Geld surface that is a *page*, not an addition to GitHub's page. Routing, layout and the empty states are all new ground.
- The plan needs a generative model. Without AI configured the tab can only offer the deterministic grouping (below), which is useful but is not the product.
- The current AI path is one request, one answer (`geld:ai-complete`). A chat panel wants streaming, a per-tab conversation and cancellation, so the worker side grows.
- Hunk-level focus inside GitHub's rendered diff is new. File-level teleport is proven, hunk-level dimming is not.
- The owner wants to think about it first. This file is that thinking.

## The shape of it

```
┌ Conversation  Commits  Checks  Files changed  Review ─────────────────────────────┐
│                                                                                     │
│ ┌ Steps ───────┐ ┌ Step 2 of 5: Debounce the search box ─────────┐ ┌ Assistant ─┐ │
│ │ ✓ 1 Settings  │ │                                               │ │            │ │
│ │ ▸ 2 Debounce  │ │ Typing in the search box used to fire a       │ │ Knows the  │ │
│ │   3 Results   │ │ request per keystroke. This step waits 250 ms │ │ plan and   │ │
│ │   4 Tests     │ │ after the last key, cancels the request in    │ │ this step. │ │
│ │   5 Chore     │ │ flight, and shows the spinner only once the   │ │            │ │
│ │               │ │ wait is over, so fast typists see no flicker. │ │ Explain    │ │
│ │ Replan        │ │                                               │ │ What could │ │
│ │ 2 new commits │ │ Touches: search.ts (2 hunks), search.css (1), │ │  break     │ │
│ │               │ │ SearchBox.tsx (1). Tests: in step 4.          │ │ Draft a    │ │
│ │               │ │                                               │ │  comment   │ │
│ │               │ │ [GitHub's rendered diff of search.ts, hunks   │ │            │ │
│ │               │ │  of other steps folded: "12 lines in step 3"] │ │ > ask…     │ │
│ │               │ │                                               │ │            │ │
│ │               │ │          Flag with a note   Accept and next ▸ │ │            │ │
│ └───────────────┘ └───────────────────────────────────────────────┘ └────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

Narrow viewports stack the three: steps as a horizontal stepper on top, the assistant as a drawer from the bottom edge with a persistent handle.

## How it works, in order

### 1. The tab and its route

GitHub has no `/pull/N/review` route, and a route of our own would 404 on reload. The tab is a link to **`/pull/N/files#geld-review`** (the `changes` spelling on the React experience, whichever the page uses, see `page.ts` and `whitespace-viewed.ts` for how the files URL is already rewritten for `?w=1`; a query was the first draft, see "What landed first"). GitHub serves its files view; Geld hides the files view's main column and sidebar (`[data-geld-review-area]` on the layout, CSS only, nothing is removed) and renders the Review view in their place. Everything the files view mounts is still there underneath: the per-file diffs the steps teleport, the Viewed controls, and the "Review changes" popover used at the end. That is the reason for choosing the files page over the conversation page.

- The tab is inserted into GitHub's underline nav (`nav[aria-label="Pull request tabs"]`, both the Rails `UnderlineNav` and the React one) after Files changed, with the same markup as its neighbours, stamped `data-geld-ui` so the controller's own-element rule ignores it. It carries a counter like the others: steps accepted over steps total once a plan exists.
- `describePage` gains `pull-review` (a `pull-files` URL with `geld=review`), so the controller does not run the files layout there. The review view owns the page; the header counts, chips and whitespace handling keep running as on `pull-files`.
- Navigating between Files changed and Review is a `history.pushState` of the query, not a reload (GitHub's SPA leaves the DOM in place when only the query changes; verify on both experiences, fall back to a full navigation if the React router remounts).

### 2. Inputs

- **The raw diff text.** The background already fetches the PR's `.diff` (`DiffSource`, cached per SHA as parsed `FileStats`), but the parser keeps counts, not hunks. The planner needs hunks: add `parseUnifiedDiffHunks` in `@geld/core` returning, per file, `{ header, oldStart, oldLines, newStart, newLines, lines }` for each hunk (the parser already walks them for `commentLines`), and keep the raw text for the current page in memory in the content script (not in `storage.local`: the cache stays counts-only, a large PR's text is megabytes).
- **Geld's classification of each file** (`matcherFor(repo)`, categories and change kinds), so a step knows which of its files are tests, generated, fixtures, lockfiles.
- **The commits**: ordered list with messages and the files each touched. Source: the PR's Commits tab payload or `/pull/N/commits` fetched like the timeline fragments are (`fetchFragment`), parsed to `{ sha, message, files? }`; per-commit file lists from `/commit/<sha>.diff` through `DiffSource` only when the planner asks (budgeted, same cache as the commit hovercards).
- **The PR title and description** (first `.comment-body` on the conversation page or the files page's hidden copy in the embedded payload; the digest comment's `meta` when the Action runs).
- **The review digest** (`GeldPrMeta` items), so a step can list the open findings that fall inside it.

### 3. The plan

```ts
interface ReviewPlan {
  readonly id: string;              // hash of headSha + step ids, so progress binds to a plan
  readonly headSha: string;
  readonly madeAt: string;          // ISO
  readonly producer: 'rules' | 'ai';
  readonly model: string | null;
  readonly steps: readonly ReviewStep[];
  readonly unassigned: readonly HunkRef[]; // should be empty; shown as a final "Everything else" step when not
}

interface ReviewStep {
  readonly id: string;              // stable across replans when the hunks are the same (hash of its first hunk's path+newStart)
  readonly title: string;           // 3 to 7 words, imperative or noun phrase ("Debounce the search box")
  readonly kind: 'feature' | 'fix' | 'refactor' | 'tests' | 'docs' | 'chore' | 'generated' | 'other';
  readonly story: string | null;    // 2 to 5 short sentences, plain words; null until written (see 5)
  readonly why: string | null;      // one sentence tying it to the PR's goal, or null
  readonly touches: readonly HunkRef[];       // every hunk of the step, in reading order
  readonly supporting: readonly HunkRef[];    // tests, fixtures, snapshots, generated output that exist because of this step (hidden categories)
  readonly dependsOn: readonly string[];      // step ids to read first
  readonly watch: readonly string[];          // 0 to 3 things worth a second look ("the retry loop has no cap"), model-written
  readonly findings: readonly string[];       // digest item ids that fall inside this step's hunks
}

interface HunkRef { readonly path: string; readonly hunk: number; } // index into that file's hunks at headSha
```

Rules that hold whatever produced the plan (enforced after parsing, like `parseConsolidateOutput` enforces ids):

- Every hunk of every non-hidden file appears in exactly one step's `touches`. Duplicates are dropped from the later step, omissions go to `unassigned`.
- Hunks of files Geld hides (tests, generated, fixtures, lockfiles, by the user's active categories) are never `touches`: they are `supporting` of the step whose non-hidden hunks they relate to (a test file follows the file it names, `foo.test.ts` to `foo.ts`, `__snapshots__/Foo.tsx.snap` to `Foo.tsx`, else the step the planner names), and whatever remains forms one trailing step of kind `tests` / `generated` / `chore`.
- Steps are ordered by `dependsOn` first (topological), then by the planner's order. Cycles are broken by the planner's order.
- A plan with one step for the whole PR is valid and is what tiny PRs get.
- Size cap: a step with more than ~400 changed lines is split by file by the rules (the model is asked for steps under that size, this is the backstop).

### 4. How the plan is made

Two producers, the first always available, the second the product.

**Rules (`producer: 'rules'`, free, synchronous, in `@geld/review`).** The fallback with AI off, the seed given to the model with AI on, and the thing tests can pin down.

1. Partition hunks by Geld's categories: hidden files go to `supporting` by the naming rules above.
2. Group the rest by **commit co-change**: files changed together in one commit are one candidate group, merged transitively while the union stays under the size cap. Commit messages become candidate titles.
3. Then by **symbol co-occurrence**: an identifier introduced in one hunk (a `+` line defining a function, class, const, CSS class, component) and referenced in another hunk's `+` lines joins the two groups. Cheap tokenizer, no parser.
4. Then by **path**: same directory, same basename across extensions (`search.ts`, `search.css`, `Search.tsx`).
5. Leftover singletons become their own steps. Titles come from the commit message or the file's basename.

Expected quality: good on PRs with tidy commits, mediocre on squash-style single-commit PRs. That is the point of the model.

**Model (`producer: 'ai'`).** One chat completion with a JSON schema (the `jsonSchema` option of `ChatCompletionOptions`, parsed and validated like `prompts.ts` does), through the background's `geld:ai-complete` as every prose call is today. Input, in this order and within a token budget:

- The PR title and description, the commit list with messages.
- The rules producer's candidate steps (the model refines rather than starts from nothing, and small PRs cost almost nothing).
- Per non-hidden file: path, status, counts, and for each hunk its header line plus the first N and last N changed lines (N scales down with the PR: full hunks under ~2k changed lines total, excerpts above, headers only above ~10k, with a note in the view that the plan was made from headers).
- Hidden files as a path list only.
- The digest's open items with path and line.

Output: `steps` with `title`, `kind`, `touches`, `dependsOn`, `watch`, and a one-line `gist` per step (not the story yet). The system prompt asks for steps a reader can hold in their head, ordered so that each step reads with what came before it, grouped by purpose and never by file type, with supporting changes left to the rules.

**Replan.** Never automatic. The tab shows "Plan this review" until a plan exists. After a push: a notice "3 commits since this plan" with "Replan". The replan sends the previous plan and asks the model to keep step ids where the hunks are the same change (it is told which hunks are new or changed by comparing the two diffs at hunk granularity), so progress carries over: an accepted step with changed hunks becomes `changed`, not `pending`, and shows what changed in it.

**Which model.** The planner needs a model that writes JSON and reasons about structure: a chat model, never an evaluation model (`isEvaluationModel`). It gets its own setting, `aiReviewModel`, defaulting to the prose tier's `aiModel`, with the picker (`model-combobox.ts`) leading with models `model-guide.ts` marks as reasoning-capable and a one-line note under the field: "Planning steps is reasoning work. A model that thinks before it answers makes better steps than a fast one." The guide gets a `plans` recommendation list beside the digest's. The user may still pick anything.

**Jev's part.** Jev cannot write the plan (it produces no text), but it is a good fit for cheap judgments around it, each optional and gated by `aiJev` as today:

- *Same change?* After the rules producer, ask a `noul` per candidate pair that the rules left apart but that touch the same directory or share a symbol ("do hunk A and hunk B belong to one change?"), merging above a threshold. Bounded to the top K pairs by shared-token score so it never goes quadratic.
- *Did the model keep every hunk where it belongs?* A `noul` per step, "does this step's gist describe these hunks?", surfacing steps that score low with a "Check this grouping" mark rather than silently trusting the plan.
- *Risk.* A `score` per step for "how likely is this step to need a careful read" to order the stepper's attention marks. Not used to reorder steps.

Jev is never required. Jev plus a chat model is the full experience, a chat model alone is the product, rules alone is the fallback.

### 5. The story, written when the step is reached

The plan call names the steps. The **story** (what the step does, how it fits the PR, what the pieces do, in plain words a reader who did not write the code can follow) is a second, smaller completion per step, with that step's full hunks and the plan's step list as context, run when the step becomes current, with the next step prefetched. A 20-step PR therefore costs one plan call plus as many story calls as steps the reader actually opens.

Prompt discipline (system prompt in `prompts.ts`, next to the digest's): tell what changes and why, not line by line. No praise, no "this PR". Three to five sentences, the first is the point. Name files only where the reader would otherwise be lost. If something is worth a second look, say it in one sentence beginning with "Worth checking:". Never say what is not in the diff. The story is rendered with the inline markdown renderer already used by the panel (`inline-markdown.ts`), so backticks work and nothing else does.

Both calls are cached per plan id and step id in `local:reviewPlans` (below) so revisiting is free and reloads do not re-ask.

### 6. The step view

The centre column shows the step's title, its story, a "Touches" line, then the diff of each file in `touches`, then a folded "Supporting changes" disclosure with the `supporting` files.

**The diff is GitHub's own.** The files view is mounted underneath (see 1). Each file's rendered diff element is loaned into the step (`teleportInto`, the same loan the review panel uses for timeline nodes, so GitHub's commenting, suggestions, "Viewed", expand-context and live updates keep working, and `restoreAll` puts everything back when the reader leaves the tab). The files view is progressive and, on the experimental large-PR mode, virtualised: a file not yet mounted is requested the way `reveal` requests it (`seekEntry`, `activateTreeItem`), with a skeleton in its place until it mounts. Hunks that belong to another step are not removed: their rows get `data-geld-step="other"` and are collapsed into one note row per run, "14 lines belong to step 3, Results list", with a Show control, exactly as `comment-rows.ts` collapses comment-only lines by line anchor today. Rows are mapped to hunks by the line anchors GitHub stamps (`data-line-anchor` / `id`) and the hunk ranges from `parseUnifiedDiffHunks`.

Below the diffs, two controls. **Accept and next** records `accepted`, marks each file of the step viewed when every one of that file's hunks is now in an accepted step (the Viewed control is pressed through `activateControl`), and makes the next pending step current. **Flag with a note** records `flagged` with a free-text note (the note is local until the end, where it is offered into the review body) and also moves on. Keyboard: `j`/`k` between files inside the step, `]`/`[` between steps, `a` accept, `f` flag, `?` the list, all ignored while typing.

The left column is the stepper: each step's title, kind glyph, state (pending, current, accepted, flagged, changed since accepted), the count of open findings inside it, and a Jev attention mark where present. Clicking any step makes it current. Under the list: "Replan" with the new-commit notice, and "Plan again from scratch" in a ⋯ menu.

### 7. The assistant panel

Open by default on wide viewports (`reviewAssistantOpen` remembered per device), a drawer on narrow ones. **In the page, not the browser's side panel**: Chrome's `sidePanel` has no Firefox or Safari equivalent, lives outside the page's DOM (no access to the loaned diffs, selection or scroll), and would make the layout differ by browser. An in-page column is one implementation everywhere.

- Context, assembled per message and never stored: the plan's step list with gists, the current step's story and full hunks, the step's open findings, the last N turns. The reader's text selection inside a loaned diff, when there is one, is quoted into the message ("about these lines:"). Tokens are budgeted the same way as the plan input.
- Quick prompts above the input, each one a message: "Explain this step as if to a new teammate", "What could break", "Is this tested, and where", "Draft a review comment", "Summarise what I have accepted so far".
- Answers stream. The worker gets a port-based variant of `geld:ai-complete` (`geld:ai-stream`: open a `runtime.connect` port, the worker forwards SSE deltas, disconnecting cancels the fetch). Markdown is rendered incrementally with the panel's renderer.
- "Draft a review comment" produces a draft the reader can edit and post on a line (it opens GitHub's own comment form on the chosen line inside the loaned diff and fills it, nothing is posted by Geld). The reader stays the author of every comment.
- Each answer carries the model id and a "Copy" control, as the digest's AI output does.

The panel is also where Geld says what it is doing: "Planning with gpt-5… (12 files)", "Writing step 3…", and the failure text from the worker with "Try again", in the same words `aiStateFor` uses.

### 8. Progress and the finish

```ts
// local:reviewProgress, keyed `github[@host]:{owner}/{repo}/{n}`, capped like AI_RUNS_CAP
interface ReviewProgress {
  readonly planId: string;
  readonly steps: Readonly<Record<string, { readonly state: 'accepted' | 'flagged'; readonly at: string; readonly note?: string }>>;
  readonly current: string | null;
}
```

Plans and stories live in `local:reviewPlans` under the same key (the current plan and at most the previous one, for the replan diff). Nothing is written to GitHub by any of this and nothing leaves the device except the model requests to the user's own gateway.

When every step is accepted or flagged, the centre column becomes the **finish**: a list of flagged steps with their notes, a count of accepted steps, "Mark all files as viewed" (every Viewed control through `activateControl`, the shortcut the hidden-files row already offers), and **Approve**, **Comment**, **Request changes**. Those three open GitHub's own "Review changes" popover on the mounted files view with the event chosen and the body prefilled: flagged steps as a bulleted list, each "**Step title**: note", under a line "Reviewed in N steps with Geld" that the reader can delete. Posting is GitHub's form submit, so no App permission and no new network path. If the popover cannot be found (markup drift), the fallback is to scroll the files view's own button into view with the draft on the clipboard and a toast saying so.

### 9. Settings, gating, trust

- `reviewTab` (toggle, section Review, default off while it is new, popup-visible): adds the tab. Without AI configured the tab works with the rules producer and says so in its empty state ("Geld can group the changes by commit and file. With a model configured it plans the review and explains each step." with a link to the AI settings).
- `aiReviewModel` (model field, section AI, shown when `reviewTab` is on, default: the prose model).
- The assistant inherits `aiEnabled`, `aiBaseUrl`, the key and the gateway permission exactly as the digest does, including `aiConfigured`. No separate switch.
- Repository config (`.github/geld.yml`) may set `review: { ai: false }` so a repository can ask that its diff text not be sent to a model; the tab then runs on rules and says why. Mirrors the trust posture of repo configs today: a repository can restrict, never enable.
- Enterprise hosts work the same, keyed `github@{host}:`.

### 10. Phasing

1. The tab, the route, hiding the files view, the rules producer, the stepper and the step view with whole-file teleport (no hunk folding yet), accept/flag, progress, the finish with GitHub's popover. No AI. This is already a different way to read a PR with good commits.
2. Hunk folding inside loaned diffs, the Viewed sync per file, keyboard.
3. The plan call, `aiReviewModel`, replan with carried-over ids, the empty states and notices.
4. Stories per step with prefetch and caching.
5. The assistant panel with streaming, quick prompts, selection quoting, comment drafts.
6. Jev's three judgments.
7. Narrow layout, Enterprise verification, AGENTS.md.

Verification per phase in the headed harness against public PRs (`wxt-dev/wxt#2544`, `vitest-dev/vitest#10554` for progressive loading, a virtualised one), with the AI calls against the fetch mock the digest's tests use.

## Decisions taken here (change them if you know better)

- **Files page, not conversation page, hosts the tab** so GitHub's diffs, Viewed controls and review form are mounted underneath. Cost: the files view loads even when the reader only wants the stories. Accepted.
- **Steps own hunks, not files.** A file split between features reads in two steps. Folding the other step's hunks keeps GitHub's diff intact.
- **GitHub renders the code.** Geld never paints a diff of its own: commenting, suggestions, syntax highlighting and live updates stay GitHub's, and the view cannot disagree with Files changed.
- **Nothing runs on its own.** Plan, replan, story and assistant calls all follow a click (the story's prefetch of the next step is the one exception, and only once the reader has opened the current one).
- **Chat model required for the real thing, Jev optional, rules always.** Jev is not offered as the planner.
- **Posting goes through GitHub's form.** No review is created by Geld's code even when the App is connected.
- **Plans and progress are local to the device.** Sharing a plan through the Action's digest comment (so a team reviews in the same steps) is a later idea, noted in the digest's `producer` field's style, not designed here.

## Open questions (defaults in parentheses)

- Should the Files changed tab's hidden-files row offer "Review in steps" as a second entry point? (Yes, as a link to the tab, once the tab is on.)
- Should accepted steps collapse their diffs when revisited, or show them? (Show, with the stepper state as the only signal.)
- Where does the step counter go on the tab for very long plans? (The tab shows `3/12`, the stepper shows the rest.)
- Do stacked pull requests plan per PR or per stack? (Per PR. The stack is the scope map's job.)
- When the plan was made from hunk headers only (very large PR), should the view say so once or on every step? (Once, in the stepper's footer.)
- Should the assistant have a tool to open a file at a line, or only text? (Text that names `path:line` becomes a link that reveals the line in the step, no tool calls.)

## Where the pieces live today

`apps/extension/src/github/page.ts` (page kinds), `controller.ts` (`apply`, `reveal`, `seekEntry`, `markHiddenViewed`), `whitespace-viewed.ts` (`findViewedControls`, `activateControl`, files-link rewriting), `review/teleport.ts` (loans), `review/ai.ts` (`runAi`, `aiStateFor`, `jevDecisionsFor`, `local:aiRuns`), `review/overview.ts` (`fetchFragment`, the panel's lifecycle), `ui/comment-rows.ts` (row folding by line anchor), `src/ui/model-combobox.ts`; `packages/review/src/prompts.ts`, `ai-client.ts`, `jev.ts`, `model-guide.ts`, `inline-markdown.ts`; `packages/core/src/diff-parse.ts` (`parseUnifiedDiff`, to gain hunks), `settings-schema.ts`, `repo-config.ts`; `apps/extension/entrypoints/background.ts` (`geld:ai-complete`, `geld:ai-evaluate`).
