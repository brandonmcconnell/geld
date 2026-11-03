/**
 * Which revision of an edited comment was in effect at a moment. Pure, so
 * the rule has tests; `edit-times.ts` reads the revisions from GitHub and
 * fetches the chosen one.
 */

export interface Revision {
  /** When this revision was written (the comment's creation for the first). */
  readonly at: string;
  /** The revision's view, `/user_content_edits/UCE_…`. */
  readonly url: string;
}

/**
 * Which of `revisions` (oldest first) was in effect at `at`: the latest one
 * written by then, where "then" stretches `settleMs` past `at` for the
 * edits a bot makes in the moments after posting (its summary filled in
 * once the threads are up). Before the first revision (a thread that
 * predates the comment) the first revision is the nearest reading.
 */
export function revisionIndexAt(revisions: readonly Revision[], at: number, settleMs: number): number {
  let index = -1;
  for (let cursor = 0; cursor < revisions.length; cursor += 1) {
    const revision = revisions[cursor];
    if (revision !== undefined && Date.parse(revision.at) <= at + settleMs) index = cursor;
  }
  return index === -1 ? 0 : index;
}

/** A comment that may head a thread from the same run: its anchor and every time it was written (posted, then each rewrite). */
export interface SameRunCandidate {
  readonly anchor: string;
  readonly times: readonly string[];
}

/**
 * Which of `candidates` was written in the same run as a thread at `at`:
 * one posted or rewritten from `beforeMs` before the thread to `afterMs`
 * after it, the nearest in time when several were. Bots rewrite one summary
 * run after run, so a rewrite at the thread's time counts as much as the
 * post. Null when none was, or with no time to go by.
 */
export function sameRunAnchor(candidates: readonly SameRunCandidate[], at: number, beforeMs: number, afterMs: number): string | null {
  if (Number.isNaN(at)) return null;
  let best: { readonly anchor: string; readonly gap: number } | null = null;
  for (const candidate of candidates) {
    for (const time of candidate.times) {
      const written = Date.parse(time);
      if (Number.isNaN(written) || written < at - beforeMs || written > at + afterMs) continue;
      const gap = Math.abs(written - at);
      if (best === null || gap < best.gap) best = { anchor: candidate.anchor, gap };
    }
  }
  return best?.anchor ?? null;
}
