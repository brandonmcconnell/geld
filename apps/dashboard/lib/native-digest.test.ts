import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nativeDigest } from './native-digest';
import { reviewContextSchema } from './review-contracts';
import { emptyFeed } from './review-feed';
import type { ProviderActivity, ProviderCheck } from '@geld/domain';
const fixture = reviewContextSchema.parse(
  JSON.parse(readFileSync(new URL('../../../docs/dashboard/design/fixtures.json', import.meta.url), 'utf8'))
    .review,
);
const data = { ...fixture, comments: [], pull: { ...fixture.pull, reviewers: ['sam'] } };
const event: ProviderActivity = {
  id: 'review:1',
  kind: 'review',
  actor: 'sam',
  avatar: null,
  at: '2026-11-01T00:00:00Z',
  title: 'reviewed the changes',
  body: 'Looks good',
  state: 'approved',
  sha: data.pull.headSha,
};
const check: ProviderCheck = {
  id: 'github:check:1',
  name: 'build',
  status: 'completed',
  conclusion: 'success',
  sha: data.pull.headSha,
  description: '',
  startedAt: '2026-11-01T01:00:00Z',
  completedAt: null,
};
describe('native digest', () => {
  it('builds reviews, checks, unresolved threads and timeline without a Geld summary', () => {
    const result = nativeDigest(
      { ...data, pull: { ...data.pull, reviewers: [] } },
      { ...emptyFeed, activity: [event], checks: [check] },
    );
    expect(result.meta).toBeUndefined();
    expect(result.reviewers).toEqual([expect.objectContaining({ login: 'sam', state: 'approved' })]);
    expect(result.checks).toHaveLength(1);
    expect(result.timeline).toHaveLength(1);
    expect(result.openThreads).toEqual(data.threads.filter((thread) => !thread.resolved));
  });
  it('shows a fresh GitHub review request over a previous approval, preserving other provider approvals', () => {
    expect(nativeDigest(data, { ...emptyFeed, activity: [event] }).reviewers[0]?.state).toBe('requested');
    const gl = { ...data, pull: { ...data.pull, ref: { ...data.pull.ref, provider: 'gitlab' as const } } };
    expect(nativeDigest(gl, { ...emptyFeed, activity: [event] }).reviewers[0]?.state).toBe('approved');
  });
  it('deduplicates timeline comments and check retries, ignoring checks from another head', () => {
    const comments = [
      { id: 'node', databaseId: 9, author: 'sam', body: 'old', path: null, line: null, url: '' },
    ];
    const result = nativeDigest(
      { ...data, comments },
      {
        ...emptyFeed,
        activity: [{ ...event, id: 'comment:9', kind: 'comment', body: 'updated' }],
        checks: [
          check,
          { ...check, id: 'github:check:2', conclusion: 'failure', startedAt: '2026-11-01T02:00:00Z' },
          { ...check, name: 'other', sha: 'b'.repeat(40) },
        ],
      },
    );
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.body).toBe('updated');
    expect(result.checks).toHaveLength(1);
    expect(result.failedChecks[0]?.id).toBe('github:check:2');
  });
  it('keeps an approval through a comment-only review and handles its dismissal', () => {
    const approved = { ...data, pull: { ...data.pull, reviewers: [] } };
    const comment = { ...event, id: 'review:2', state: 'commented', at: '2026-11-02T00:00:00Z' };
    expect(nativeDigest(approved, { ...emptyFeed, activity: [event, comment] }).reviewers[0]?.state).toBe(
      'approved',
    );
    const dismissed = {
      ...event,
      id: 'event:dismiss',
      kind: 'event' as const,
      actor: 'maintainer',
      targetId: event.id,
      state: 'dismissed',
      at: '2026-11-03T00:00:00Z',
    };
    expect(
      nativeDigest(approved, { ...emptyFeed, activity: [event, comment, dismissed] }).reviewers[0]?.state,
    ).toBe('dismissed');
  });
  it('keeps the complete timeline while folding automation out of the human discussion', () => {
    const result = nativeDigest(fixture, emptyFeed);
    expect(result.timeline.some((event) => event.id === 'comment:geld-summary')).toBe(true);
    expect(result.discussion.some((event) => event.id === 'comment:geld-summary')).toBe(false);
    expect(result.discussion.every((event) => !event.actor.endsWith('[bot]'))).toBe(true);
  });
  it('does not invent a reviewed revision for a standalone bot comment', () => {
    const bot = {
      ...event,
      id: 'comment:bot',
      actor: 'greptile-apps[bot]',
      kind: 'comment' as const,
      sha: null,
      state: null,
      body: '### Confidence Score: 5/5\n\nNo actionable issues found.',
    };
    const result = nativeDigest(data, { ...emptyFeed, activity: [bot] });
    expect(result.bots[0]).toMatchObject({ id: 'greptile', score: 5, reviewedSha: '0'.repeat(40) });
  });
});
