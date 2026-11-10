import { describe, expect, it } from 'vitest';
import type { ProviderComment, PullRef } from '@geld/domain';
import type { GeldPrMeta } from '@geld/review/model';
import { renderSummary } from '@geld/review/summary-render';
import { queueDigest } from './queue-digest';
const head = 'a'.repeat(40);
const ref: PullRef = { provider: 'github', host: 'github.com', owner: 'acme', repo: 'api', number: 1 };
const meta: GeldPrMeta = {
  v: 1,
  headSha: head,
  generatedAt: '2026-11-02T12:00:00Z',
  producer: { kind: 'action', version: 'test', ai: false },
  items: [
    {
      id: 'open',
      title: 'Check the race',
      rewritten: false,
      status: 'open',
      severity: 'bug',
      sources: [{ anchor: 'issuecomment-1', kind: 'comment', author: 'reviewer' }],
    },
    {
      id: 'reply',
      title: 'Confirm the contract',
      rewritten: false,
      status: 'needs-reply',
      severity: 'question',
      sources: [{ anchor: 'issuecomment-1', kind: 'comment', author: 'reviewer' }],
    },
    {
      id: 'done',
      title: 'Done',
      rewritten: false,
      status: 'resolved',
      severity: 'nit',
      sources: [{ anchor: 'issuecomment-1', kind: 'comment', author: 'reviewer' }],
    },
  ],
  reviewers: [{ login: 'alex', state: 'approved' }],
  bots: [{ id: 'greptile', login: 'greptile[bot]', verdict: 'clean', reviewedSha: head, score: 5 }],
  fold: { comments: [], events: [] },
};
function comment(value: GeldPrMeta, author = 'github-actions[bot]'): ProviderComment {
  return {
    id: 'summary',
    author,
    body: renderSummary(value, { owner: 'acme', repo: 'api', number: 1 }),
    path: null,
    line: null,
    url: 'https://github.com/acme/api/pull/1#issuecomment-1',
  };
}
describe('queue digest signals', () => {
  it('summarizes the trusted current-head payload without resolved findings', () => {
    expect(queueDigest(ref, head, [comment(meta)])).toEqual({
      state: 'current',
      open: 2,
      needsReply: 1,
      approvedBy: ['alex'],
      approvals: 1,
      changesRequested: 0,
      partial: false,
      bots: [{ id: 'greptile', name: 'Greptile', verdict: 'clean', score: 5 }],
    });
  });
  it('rejects human impersonations, malformed payloads and unsupported publisher identities', () => {
    expect(queueDigest(ref, head, [comment(meta, 'human')])).toBeNull();
    expect(queueDigest({ ...ref, provider: 'gitlab' }, head, [comment(meta)])).toBeNull();
    expect(queueDigest(ref, head, [{ ...comment(meta), body: "<span title='geld:{broken}'></span>" }])).toBeNull();
  });
  it('marks the latest stale digest without carrying forward old approvals or scores', () => {
    expect(queueDigest(ref, 'b'.repeat(40), [comment(meta)])).toEqual({ state: 'stale' });
    const newer = { ...meta, headSha: 'b'.repeat(40), generatedAt: '2026-11-02T13:00:00Z' };
    expect(queueDigest(ref, head, [comment(meta), comment(newer)])).toEqual({ state: 'stale' });
  });
  it('suppresses a stale bot score even when the summary is current and marks partial counts', () => {
    expect(
      queueDigest(ref, head, [
        comment({ ...meta, truncated: true, bots: [{ ...meta.bots[0]!, reviewedSha: 'b'.repeat(40) }] }),
      ]),
    ).toMatchObject({ state: 'current', partial: true, bots: [{ verdict: 'earlier' }] });
    const digest = queueDigest(ref, head, [
      comment({ ...meta, bots: [{ ...meta.bots[0]!, reviewedSha: 'b'.repeat(40) }] }),
    ]);
    expect(digest?.state === 'current' && digest.bots[0]?.score).toBeUndefined();
  });
});
