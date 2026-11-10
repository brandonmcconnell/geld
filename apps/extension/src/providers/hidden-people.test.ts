import { describe, expect, it } from 'vitest';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { projectProviderPeople } from './hidden-people';

const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/repo', id: '1', headSha: 'a'.repeat(40) } as const;
function comment(id: string, authorId: string, login: string): ProviderReviewComment {
  return { id, anchor: `note_${id}`, url: `https://gitlab.com/group/repo/-/merge_requests/1#note_${id}`, author: { id: authorId, login }, body: `Concern ${id}`, createdAt: '2026-11-01T00:00:00Z' };
}
const hidden = comment('1', 'a', 'alice'), visible = comment('2', 'b', 'bob'), reply = comment('3', 'c', 'carol');
const input: ProviderReviewInput = {
  subject, threads: [
    { id: 'first', anchor: hidden.anchor, url: hidden.url, resolved: false, outdated: false, comments: [hidden, visible] },
    { id: 'second', anchor: reply.anchor, url: reply.url, resolved: false, outdated: false, comments: [reply, hidden] },
  ],
  reviewers: [{ author: hidden.author, state: 'changes_requested' }, { author: visible.author, state: 'approved' }],
  bots: [{ id: 'reviewer', authorId: hidden.author.id, login: hidden.author.login }],
  checks: [{ name: 'Review', sha: subject.headSha, status: 'completed', conclusion: 'success', authorId: hidden.author.id }],
};

describe('provider hidden people projection', () => {
  it('excludes starter-owned threads, hidden replies and attributed verdicts without mutating source evidence', () => {
    const before = JSON.stringify(input);
    const event = { id: 'event', url: hidden.url, author: hidden.author, body: 'Approved', createdAt: hidden.createdAt };
    const result = projectProviderPeople(input, [hidden, visible], [event], ['ALICE'], new Set());
    expect(result.input.threads).toHaveLength(1);
    expect(result.input.threads[0]?.comments).toEqual([reply]);
    expect(result.comments).toEqual([]);
    expect(result.input.reviewers).toEqual([input.reviewers?.[1]]);
    expect(result.input.bots).toEqual([]);expect(result.input.checks).toEqual([]);expect(result.events).toEqual([]);
    expect(result.hiddenAnchors.get(visible.anchor)).toBe(hidden.author.id);
    expect(result.hiddenCommentAnchors.get(hidden.anchor)).toBe(hidden.author.id);
    expect(result.hiddenCommentAnchors.has(visible.anchor)).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('scopes qualified rules to their provider and peeks by native account ID', () => {
    expect(projectProviderPeople(input, [], [], ['bitbucket:alice'], new Set()).people).toEqual([]);
    const result = projectProviderPeople(input, [], [], ['gitlab:ALICE'], new Set(['a']));
    expect(result.input.threads).toEqual(input.threads);
    expect(result.people).toEqual([{ id: 'a', login: 'alice', ruleIdentity: 'alice', shown: true, exactRules: ['gitlab:ALICE'] }]);
    expect(result.hiddenAnchors.size).toBe(0);
    expect(result.hiddenCommentAnchors.size).toBe(0);
  });

  it('does not offer to remove a wildcard as though it were a per-person preference', () => {
    const result = projectProviderPeople(input, [], [], ['a*'], new Set());
    expect(result.people[0]?.exactRules).toEqual([]);
  });
});


it('uses the same canonical Bitbucket UUID rule for comments, reviewers, bots and activity', () => {
  const uuid = '7177c565-3bb4-44d3-b17b-e791dfb8fed8';
  const identity = `bitbucket.org/uuid/${uuid}`;
  const author = { id: `{${uuid.toUpperCase()}}`, login: 'display-nickname' };
  const item = { ...hidden, author };
  const source: ProviderReviewInput = {
    subject: { ...subject, provider: 'bitbucket', origin: 'https://bitbucket.org' },
    threads: [{ id: 'thread', anchor: item.anchor, url: item.url, comments: [item], resolved: false, outdated: false }],
    reviewers: [{ author, state: 'approved' }], bots: [{ id: 'bot', authorId: author.id, login: author.login }],
    checks: [{ name: 'Review', sha: subject.headSha, status: 'completed', conclusion: 'success', authorId: author.id }],
  };
  const event = { id: 'event', author, url: item.url, body: 'Approved', createdAt: item.createdAt };
  for (const rule of [identity.toUpperCase(), `bitbucket:${identity}`, 'bitbucket.org/uuid/7177*']) {
    const result = projectProviderPeople(source, [item], [event], [rule], new Set());
    expect(result.input.threads).toEqual([]);expect(result.comments).toEqual([]);expect(result.events).toEqual([]);
    expect(result.input.reviewers).toEqual([]);expect(result.input.bots).toEqual([]);expect(result.input.checks).toEqual([]);
    expect(result.people).toEqual([{ id: author.id, login: author.login, ruleIdentity: identity, shown: false, exactRules: rule.includes('*') ? [] : [rule] }]);
    const peek = projectProviderPeople(source, [item], [event], [rule], new Set([author.id]));
    expect(peek.input.threads).toEqual(source.threads);expect(peek.comments).toEqual([item]);expect(peek.events).toEqual([event]);
  }
  expect(projectProviderPeople(source, [item], [event], ['display-nickname'], new Set()).people).toEqual([]);
  expect(projectProviderPeople({ ...source, threads: [], reviewers: [{ author: { id: 'invalid', login: identity }, state: 'approved' }], bots: [] }, [], [], [identity], new Set()).people).toEqual([]);
});
