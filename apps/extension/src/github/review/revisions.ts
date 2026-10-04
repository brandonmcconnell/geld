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
