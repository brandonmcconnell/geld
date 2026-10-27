import type { SidebarReviewer } from './review/crawler';
import { crawlSidebarReviewers } from './review/crawler';
import type { ReviewVerdict } from './merge-actions';

/**
 * How the pull request's reviews stand, as the sidebar's Reviewers block
 * keeps them: each reviewer once, by their latest review (an approval, a
 * request for changes, or comments; a dismissed approval reads as
 * comments). The block is GitHub's own partial, served for any tab
 * (`issues/N/show_partial?partial=pull_requests/sidebar/show/reviewers`,
 * the URL the block refreshes itself from), so the tally is the same on
 * Files changed as on the conversation.
 */
export interface ReviewTally {
  readonly approved: number;
  readonly changesRequested: number;
  readonly commented: number;
}

/** `/owner/repo/pull/N` → the Reviewers block's partial. */
export function reviewersPartialUrl(pullPath: string): string | null {
  const match = /^(\/[^/]+\/[^/]+)\/pull\/(\d+)/.exec(pullPath);
  return match === null ? null : `${match[1]}/issues/${match[2]}/show_partial?partial=${encodeURIComponent('pull_requests/sidebar/show/reviewers')}`;
}

/**
 * The sidebar names a reviewer by their latest review, so an approval
 * followed by a comment reads "commented" there, and one asked to review
 * again reads "awaiting". GitHub's merge box (and
 * the digest) keep the approval standing: its verdict for the same login
 * wins. Dismissed verdicts are already gone from the merge box.
 */
export function standingReviewers(sidebar: readonly SidebarReviewer[], verdicts: readonly ReviewVerdict[]): SidebarReviewer[] {
  return sidebar.flatMap((reviewer) => {
    const verdict = verdicts.find((entry) => entry.login.toLowerCase() === reviewer.login.toLowerCase());
    // A reviewer only awaited (asked, with no verdict standing) has no review to count or show.
    if (verdict === undefined) return reviewer.state === 'awaiting' ? [] : [reviewer];
    const state = verdict.state === 'APPROVED' ? 'approved' : 'changes_requested';
    return [reviewer.state === state ? reviewer : { ...reviewer, state }];
  });
}

export function tallyOf(reviewers: readonly SidebarReviewer[]): ReviewTally {
  let approved = 0;
  let changesRequested = 0;
  let commented = 0;
  for (const reviewer of reviewers) {
    if (reviewer.state === 'approved') approved += 1;
    else if (reviewer.state === 'changes_requested') changesRequested += 1;
    else if (reviewer.state === 'commented' || reviewer.state === 'dismissed') commented += 1;
  }
  return { approved, changesRequested, commented };
}

/** "2 approvals, 1 request for changes, 3 reviewers commented": what the tally says, in words, for its label. */
export function tallyWords(tally: ReviewTally): string {
  const parts = [
    tally.approved > 0 ? `${tally.approved} ${tally.approved === 1 ? 'approval' : 'approvals'}` : '',
    tally.changesRequested > 0 ? `${tally.changesRequested} ${tally.changesRequested === 1 ? 'request for changes' : 'requests for changes'}` : '',
    tally.commented > 0 ? `${tally.commented} ${tally.commented === 1 ? 'reviewer commented' : 'reviewers commented'}` : '',
  ];
  return parts.filter((part) => part !== '').join(', ');
}

/** The reviewers, each by their standing review, for a pull request; null when GitHub could not say. */
export async function fetchReviewers(pullPath: string): Promise<readonly SidebarReviewer[] | null> {
  const url = reviewersPartialUrl(pullPath);
  if (url === null) return null;
  try {
    const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' } });
    if (!response.ok) return null;
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    // Awaiting reviewers stay in: one asked again keeps the verdict the merge box still counts (`standingReviewers`).
    return crawlSidebarReviewers(doc);
  } catch {
    return null;
  }
}

/** Where the conversation shows the reviews: Geld's marker, which the page resolves (to the digest's Reviews row, else the sidebar's Reviewers). */
export const REVIEWS_HASH = '#geld-reviews';
/** A reviewer's latest review, when its id is not known here: the conversation finds it by its author. */
export const REVIEW_BY_HASH = '#geld-review-by-';

/**
 * The link to one reviewer's standing review on the conversation: its own
 * anchor when the merge box gave its id (approvals and requests for
 * changes), else Geld's marker naming the reviewer (comment reviews, whose
 * ids only the timeline has).
 */
export function reviewLink(pullPath: string, login: string, id: number | null): string {
  return id === null ? `${pullPath}${REVIEW_BY_HASH}${encodeURIComponent(login)}` : `${pullPath}#pullrequestreview-${id}`;
}
