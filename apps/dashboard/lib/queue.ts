import type { PullSummary } from '@geld/domain';
export function readyForReview(pull: Pick<PullSummary, 'state' | 'draft' | 'reviewers'>): boolean {
  return pull.state === 'open' && (!pull.draft || pull.reviewers.length > 0);
}
