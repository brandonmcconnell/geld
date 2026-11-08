/**
 * Which comment a review thread was posted under: the one rule behind a
 * round line's thread count, the Review bots row's chips and a thread's
 * pinned strip. Linking by author, or by a bot's latest summary at the
 * thread's time, put every thread of a bot's in a round under every comment
 * of the bot's there (geld#349).
 */

import { reviewCommentOf } from './crawler';
import { sameRunAnchor } from './revisions';
import type { SameRunCandidate } from './revisions';
import { closestAtHome } from './teleport';

/** A bot finishes writing its summary in the moments after it posts the run's threads; edits this soon after count as the run's. */
export const RUN_SETTLE_MS = 5 * 60 * 1000;
/** How long before a thread a bot's summary, posted or rewritten, still counts as that run's: a summary that leads its threads leads by seconds. */
export const SAME_RUN_BEFORE_MS = 2 * 60 * 1000;

export interface ThreadHead {
  readonly anchor: string;
  /** The review's own comment when the head is the review holding the thread; null for a bot's summary from the same run. */
  readonly review: HTMLElement | null;
}

/** The review timeline item holding `node`, at its outermost copy: GitHub repeats the review's id on nested wrappers (a minimized review, its permalink). */
export function outermostReviewOf(node: Element): HTMLElement | null {
  let review = closestAtHome(node, '[id^="pullrequestreview-"]');
  while (review !== null && review.parentElement !== null) {
    const outer = closestAtHome(review.parentElement, '[id^="pullrequestreview-"]');
    if (outer === null || outer.id !== review.id) break;
    review = outer;
  }
  return review;
}

/**
 * The comment `thread` (posted at `at`, epoch ms) hangs under: the review
 * holding it when that review has a comment of its own, else, for a bot's
 * thread, the one of the bot's `summaries` posted or rewritten from just
 * before the thread to `RUN_SETTLE_MS` after it (Greptile posts its summary
 * as a comment and its threads in a review with no words). `summaries` is
 * null for a person's thread. Null when nothing heads it.
 */
export function threadHeadOf(thread: Element, at: number, summaries: readonly SameRunCandidate[] | null): ThreadHead | null {
  const review = outermostReviewOf(thread);
  const reviewNode = review === null ? null : reviewCommentOf(review);
  // An Overview review is one box, its words and its threads' boxes together: the box is its comment though it holds the thread.
  const overviewBox = reviewNode !== null && reviewNode === review && review.tagName === 'ARTICLE';
  if (review !== null && reviewNode !== null && (overviewBox || !reviewNode.contains(thread))) return { anchor: review.id, review: reviewNode };
  if (summaries === null) return null;
  const anchor = sameRunAnchor(summaries, at, SAME_RUN_BEFORE_MS, RUN_SETTLE_MS);
  return anchor === null ? null : { anchor, review: null };
}
