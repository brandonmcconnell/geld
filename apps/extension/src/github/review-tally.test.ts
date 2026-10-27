// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { reviewersPartialUrl, standingReviewers, tallyOf, tallyWords } from './review-tally';

describe('review tally', () => {
  it('asks the Reviewers block GitHub refreshes itself from', () => {
    expect(reviewersPartialUrl('/acme/widgets/pull/7')).toBe('/acme/widgets/issues/7/show_partial?partial=pull_requests%2Fsidebar%2Fshow%2Freviewers');
    expect(reviewersPartialUrl('/acme/widgets')).toBeNull();
  });

  it('counts each reviewer once by their standing review, a dismissed approval as comments', () => {
    const reviewer = (login: string, state: 'approved' | 'changes_requested' | 'commented' | 'dismissed' | 'awaiting') => ({ login, avatarSrc: null, state, bot: false });
    const tally = tallyOf([reviewer('a', 'approved'), reviewer('b', 'approved'), reviewer('c', 'changes_requested'), reviewer('d', 'commented'), reviewer('e', 'dismissed'), reviewer('f', 'awaiting')]);
    expect(tally).toEqual({ approved: 2, changesRequested: 1, commented: 2 });
    expect(tallyWords(tally)).toBe('2 approvals, 1 request for changes, 2 reviewers commented');
    expect(tallyWords({ approved: 0, changesRequested: 0, commented: 0 })).toBe('');
  });

  it('keeps an approval standing over a later comment, as the merge box does', () => {
    const reviewer = (login: string, state: 'approved' | 'commented') => ({ login, avatarSrc: null, state, bot: false });
    const standing = standingReviewers([reviewer('Copilot', 'commented'), reviewer('aeschli', 'approved'), reviewer('connor4312', 'commented')], [
      { login: 'aeschli', state: 'APPROVED', id: 1 },
      { login: 'Connor4312', state: 'APPROVED', id: 2 },
    ]);
    expect(standing.map((entry) => `${entry.login}:${entry.state}`)).toEqual(['Copilot:commented', 'aeschli:approved', 'connor4312:approved']);
    expect(tallyOf(standing)).toEqual({ approved: 2, changesRequested: 0, commented: 1 });
    // Asked to review again, an approver reads "awaiting" in the sidebar and still counts; one only awaited does not.
    const asked = standingReviewers([{ login: 'ann', avatarSrc: null, state: 'awaiting', bot: false }, { login: 'bo', avatarSrc: null, state: 'awaiting', bot: false }], [{ login: 'ann', state: 'APPROVED', id: 3 }]);
    expect(asked.map((entry) => `${entry.login}:${entry.state}`)).toEqual(['ann:approved']);
  });
});
