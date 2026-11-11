import { describe, expect, it } from 'vitest';
import { coverageOf, digestDocumentIssues, digestFromMeta, digestFromProvider, knownEmpty } from './digest-document';
import type { DigestDocument } from './digest-document';
import type { GeldPrMeta } from './model';
import type { ProviderReviewInput, ProviderReviewThread } from './provider-review';

const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '42', headSha: 'a'.repeat(40) } as const;
const page = 'https://gitlab.com/group/project/-/merge_requests/42';

function thread(id: string, author = { id: '1', login: 'alice' }): ProviderReviewThread {
  return {
    id: id.repeat(40), anchor: `discussion_${id.repeat(40)}`, url: `${page}#discussion_${id.repeat(40)}`, resolved: false, outdated: false,
    comments: [{ id, anchor: `note_${id}`, url: `${page}#note_${id}`, author, body: 'Check for null first.', createdAt: '2026-11-01T12:00:00Z' }],
  };
}

function input(overrides: Partial<ProviderReviewInput> = {}): ProviderReviewInput {
  return {
    subject,
    threads: [thread('1')],
    reviewers: [
      { author: { id: '1', login: 'alice' }, state: 'approved', reviewRequest: 'not-pending' },
      { author: { id: '9', login: 'GitLabDuo', automated: true }, state: 'approved' },
    ],
    checks: [{ name: 'test', status: 'completed', conclusion: 'failure', sha: subject.headSha }, { name: 'deploy', status: 'manual', conclusion: null, sha: subject.headSha, nativeStatus: 'manual' }],
    checksCoverage: 'complete',
    ...overrides,
  };
}

describe('digest document', () => {
  it('fills a provider document with accounts told apart by the host marks, not their names', () => {
    const document = digestFromProvider({ input: input(), state: 'open', approvalsRequired: 2, approvalsLeft: 1, requirements: [{ id: 'all', label: 'All Members', state: 'pending' }] });
    expect(document.subject).toMatchObject({ provider: 'gitlab', state: 'open', url: page });
    expect(document.reviewers.map((reviewer) => [reviewer.account.login, reviewer.account.kind, reviewer.request])).toEqual([['alice', 'person', 'not-pending'], ['GitLabDuo', 'bot', 'unknown']]);
    expect(document.checks.map((check) => check.state)).toEqual(['failure', 'manual']);
    expect(document.items).toHaveLength(1);
    expect(document.requirement).toEqual({ approvalsRequired: 2, approvalsLeft: 1, rules: [{ id: 'all', label: 'All Members', state: 'pending' }] });
    expect(document.capabilities.dismissReviews).toBe(false);
  });

  it('marks an area it could not read and lists nothing from it, so no row reads as none', () => {
    const { reviewers: _read, ...unread } = input();
    const document = digestFromProvider({ input: unread, unavailable: [{ area: 'reviews', reason: 'HTTP 401' }], sourceCoverage: { comments: 'complete', threads: 'partial' } });
    expect(document.reviewers).toEqual([]);
    expect(coverageOf(document, 'reviews')).toEqual({ state: 'unavailable', reason: 'HTTP 401' });
    expect(knownEmpty(document, 'reviews', 0)).toBe(false);
    expect(coverageOf(document, 'threads').state).toBe('partial');
    expect(knownEmpty(document, 'checks', 0)).toBe(true);
    const half = digestFromProvider({ input: input(), unavailable: [{ area: 'reviews', reason: 'The reviewer endpoint returned 403.' }] });
    expect([coverageOf(half, 'reviews').state, half.reviewers.length]).toEqual(['partial', 2]);
  });

  it('keeps the worse coverage when an area is reported twice', () => {
    const document = digestFromProvider({ input: input({ checksCoverage: 'partial' }), unavailable: [{ area: 'checks', reason: 'HTTP 500' }] });
    expect(coverageOf(document, 'checks').state).toBe('unavailable');
    expect(document.checks).toEqual([]);
  });

  it('refuses an area name it does not know and drops counts that do not add up', () => {
    expect(() => digestFromProvider({ input: input(), unavailable: [{ area: 'approvals', reason: 'x' }] })).toThrow(/Unknown digest area/);
    const labelled = digestFromProvider({ input: input(), unavailable: [{ area: 'thread state', reason: 'a' }, { area: 'CI checks', reason: 'b' }, { area: 'approval requirements', reason: 'c' }] });
    expect([coverageOf(labelled, 'threads').state, coverageOf(labelled, 'checks').state, labelled.requirement]).toEqual(['partial', 'unavailable', null]);
    expect(digestFromProvider({ input: input(), approvalsRequired: 1, approvalsLeft: 2 }).requirement).toBeNull();
    expect(() => digestFromProvider({ input: input({ reviewers: [{ author: { id: '1', login: 'alice' }, state: 'approved' }, { author: { id: '1', login: 'alice' }, state: 'commented' }] }) })).toThrow(/listed twice/);
  });

  it('reports a list that coverage denies', () => {
    const document: DigestDocument = { ...digestFromProvider({ input: input() }), coverage: { checks: { state: 'unavailable' } } };
    expect(digestDocumentIssues(document)).toEqual(['checks are listed while checks are unavailable']);
  });

  it('lifts the Action payload and marks what it never carries as unavailable', () => {
    const meta: GeldPrMeta = {
      v: 1, generatedAt: '2026-11-01T12:00:00Z', headSha: 'b'.repeat(40), producer: { kind: 'action', version: '1', ai: false },
      items: [], bots: [{ id: 'greptile', login: 'greptile-apps[bot]', verdict: 'clean', reviewedSha: 'b'.repeat(40) }],
      reviewers: [{ login: 'alice', state: 'approved' }, { login: 'copilot-pull-request-reviewer[bot]', state: 'commented' }], fold: { comments: [], events: [] },
    };
    const document = digestFromMeta(meta, { provider: 'github', origin: 'https://github.com', repository: 'o/r', id: '7', state: 'open', url: 'https://github.com/o/r/pull/7' });
    expect(document.subject.headSha).toBe('b'.repeat(40));
    expect(document.reviewers.map((reviewer) => reviewer.account.kind)).toEqual(['person', 'bot']);
    expect(coverageOf(document, 'checks').state).toBe('unavailable');
    expect(knownEmpty(document, 'checks', 0)).toBe(false);
    expect(document.bots).toHaveLength(1);
  });
});
