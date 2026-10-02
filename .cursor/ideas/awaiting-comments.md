# Idea: surface a person's top-level comment that is waiting on you

Status: parked (Oct 2026). No code change yet. Prompted by mint#12365: a coworker left a review body with a question and no threads under it, every thread on the PR was resolved, and the compact view bubbled nothing up. The comment was only visible as a line inside the Reviews row.

## The gap

Attention is built from `ReviewItem`s, and items only come from review threads (`packages/review/src/cluster.ts`; `needs-reply` is decided in `addressed.ts` from `humanReplied`). A person's top-level comment or review body is a `ReviewEntry` (`panel.ts`): it renders as a line in the Reviews row or its round and has no lifecycle, so nothing marks it as answered or unanswered and nothing puts it in front of the reader. With agents doing much of the work, a human question that needs a human answer is exactly what the panel should feature.

## What GitHub offers

- Review threads resolve (`resolveReviewThread`). Top-level comments and review bodies do not.
- The closest native gesture is Hide (`minimizeComment`, reasons include *Resolved*, rendered "This comment was marked as resolved"); bots use it on their stale summaries. It needs triage/write and collapses the comment for everyone, so it is a secondary action, not the default for "I read this".
- Reactions are the per-person signal GitHub does have; the panel already reads the signed-in user's (`myReactionOn`) and offers the picker on rows.

## Design

1. **A deterministic "awaiting you" predicate** in `@geld/review`, pure and tested. A top-level comment or review body counts when: it is by a person other than the reader, has a body, its lane is `discussion` or `finding` (never `trigger` / `status` / `verdict` / `report`, `COMMENT_LANES` in `decisions.ts`); the reader has posted nothing on the PR after it (no later top-level comment, review or thread reply); and the reader has not reacted to it. A push does not answer a question, so the comment stays through pushes; an earlier and a later unanswered comment both stay. Jev can refine (a one-bit "asks something of the author" judgment, `addressed` evidence for "a later commit answered this request"), but the rule stands alone, as `applyAddressed` does.
2. **Make those comments items, not entries.** `ReviewItem.kind: 'thread' | 'comment'` (default `'thread'`); `clusterComments` emits one `comment` item per qualifying top-level comment with `status: 'needs-reply'`. Downstream comes free: the Needs attention group, the badge count of `needs-reply` items, `done-manual` via the existing tick (persisted with the summary), Jev's `addressed` pass, and the Action's digest payload, so agents reading the `geld` JSON see the open question too. Thread-only fields (`resolvable`, Resolve, `path` / `line`) are already optional.
3. **Dismissal, lightest first:** Reply (closes by rule 1); React from the row's picker (closes by rule 1, visible to the asker); tick done (`done-manual`, local, no GitHub side effect); Hide as resolved as an opt-in ⋯ item labelled with what it does to everyone.
4. **Surfacing:** a Needs attention row per awaiting comment (asker's avatar, first sentence, "needs reply" tone, opens in place as a chat like a thread row), and a chip on the Reviews status row ("1 awaiting reply") that lands on the line with `onOpenAnchor` plus the flash.

## Decisions to take when picking this up

- Who is "you": the signed-in login (natural); when that login is a requested reviewer, also count the author's comments, since the author's questions are to the reviewers.
- Scope of "answered": "anything by you after it" is cheap and forgiving (resolving an unrelated thread clears a question); the stricter reading (a reply that mentions or quotes them, or follows in the same round) is Jev's job, with the forgiving rule as the fallback.
- Noise: without the lane filter LGTMs and thanks would show; `discussion` plus a small "ends in a question mark or imperative" heuristic covers most, Jev the rest.
- Rounds were considered and set aside: showing only the current round's latest comment hides an earlier unanswered one after a push, which is the case that matters most.

## Where the pieces live

`packages/review/src/cluster.ts` (items), `addressed.ts` (status), `decisions.ts` (lanes), `model.ts` (`ReviewItem`, `ITEM_STATUSES`); `apps/extension/src/github/review/overview.ts` (`reviewEntriesFrom`, `myReactionOn`, `onReply`, `onOpenAnchor`), `panel.ts` (`ReviewEntry`, Needs attention group, the badge's `needs-reply` count), `panel-model.ts` (status order and copy).
