import { expect, it } from 'vitest';
import { readyForReview } from './queue';
it('includes a requested draft in the same ready count and excludes unrequested drafts and closed pulls', () => {
  expect(readyForReview({ state: 'open', draft: true, reviewers: ['alex'] })).toBe(true);
  expect(readyForReview({ state: 'open', draft: true, reviewers: [] })).toBe(false);
  expect(readyForReview({ state: 'open', draft: false, reviewers: [] })).toBe(true);
  expect(readyForReview({ state: 'closed', draft: false, reviewers: ['alex'] })).toBe(false);
});
