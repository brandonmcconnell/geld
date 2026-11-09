# Idea: count Greptile's "Comments Outside Diff" as open findings

Status: parked (Nov 2026). No code change yet.

## What

Greptile posts the findings it cannot attach to a line as a separate top-level comment headed "Comments Outside Diff" ("These findings could not be posted inline."), a few seconds after its review threads. Each finding is a bold title with a `path:line` code span and a ▶ link. Geld does not count them today: `parseBotBody` reads the comment as nothing (no count, score or verdict), and since #352's fix it adds to the run without changing the verdict.

## Why it might be worth it

- These findings are real and cannot be resolved on GitHub (they are not threads), so a run with only outside-diff findings left reads "resolved" or "clean" while something is still open. On geld#352 the outside comment held a P1 ("Old team settings stay active") that nothing else on the page surfaced.
- CodeRabbit's outside-the-diff findings already stand on their own (`unthreaded`, "Findings the summary holds with no thread … stand whatever becomes of its threads"), so Greptile's would follow an existing shape.

## Why not yet

- Nothing marks one as addressed: without a thread to resolve, the count never goes down, and a chip that cannot reach "resolved" invites people to ignore it. Needs a rule for when an outside finding is done (a later run's comment that no longer lists it, a manual "mark done", or the file no longer having that line).
- Only one sample so far (geld#352). The shape should be confirmed on a few more pull requests before it is parsed.

## If we do it

- Recognize the comment in `@geld/review/bots.ts`: the `<!-- greptile_outside_diff -->` marker raw, or the "Comments Outside Diff" heading as the page reads it, one finding per bold title.
- Feed it through `ParsedBotBody.unthreaded` (count plus the comment's anchor), as CodeRabbit's outside-diff findings are, so `verdictsFrom` adds them to the thread run's open count.
- Show them in the bot's line and the item list as unresolvable findings that link to the comment, with a way to mark one done that the digest remembers.
