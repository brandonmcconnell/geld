import { describe, expect, it } from 'vitest';
import { digestFromProvider } from './digest-document';
import { reviewsSummary } from './digest-rows';
import type { ProviderReviewInput } from './provider-review';

const subject = { provider: 'gitlab' as const, origin: 'https://gitlab.com', repository: 'group/project', id: '7', headSha: 'a'.repeat(40) };
const base: ProviderReviewInput = { subject, threads: [] };

describe('reviewsSummary', () => {
  it('counts people only, beside the host requirement', () => {
    const document = digestFromProvider({
      input: { ...base, reviewers: [
        { author: { id: '1', login: 'alice' }, state: 'approved' },
        { author: { id: '2', login: 'bob' }, state: 'changes_requested' },
        { author: { id: '3', login: 'carol' }, state: 'pending' },
        { author: { id: '9', login: 'GitLabDuo', automated: true }, state: 'approved' },
      ] },
      approvalsRequired: 2, approvalsLeft: 1,
    });
    expect(reviewsSummary(document)).toEqual({ coverage: 'complete', label: 'Reviews · 1/2 required approvals · 1 change request · 1 pending review' });
  });

  it('says partial and observed when one review source failed, and unavailable when none answered', () => {
    const partial = digestFromProvider({ input: { ...base, reviewers: [{ author: { id: '1', login: 'alice' }, state: 'approved' }] }, unavailable: [{ area: 'reviews', reason: '403' }] });
    expect(reviewsSummary(partial).label).toBe('Reviews · Partial · 1 observed approval');
    expect(reviewsSummary(digestFromProvider({ input: base, unavailable: [{ area: 'reviews', reason: '403' }] })).label).toBe('Reviews · Unavailable');
    expect(reviewsSummary(digestFromProvider({ input: base, approvalsRequired: 1, approvalsLeft: 1 })).label).toBe('Reviews · Partial · 0/1 required approvals');
  });

  it('counts a known empty list as no approvals', () => {
    expect(reviewsSummary(digestFromProvider({ input: { ...base, reviewers: [] } })).label).toBe('Reviews · 0 approvals');
  });
});
