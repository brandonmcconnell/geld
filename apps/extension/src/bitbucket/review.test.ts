import { describe, expect, it } from 'vitest';
import { buildProviderReviewItems } from '@geld/review';
import type { ProviderReviewPage } from '../providers/types';
import { BitbucketClient } from './api';
import { describeBitbucketPage } from './page';
import { fetchBitbucketReview } from './review';

const ROOT = '/2.0/repositories/acme/widgets/pullrequests/42';
const DATE = '2026-11-01T12:00:00Z';
const LATER = '2026-11-01T13:00:00Z';
const HEAD = 'b'.repeat(40);
const BASE = 'a'.repeat(40);
const USER = { uuid: '{reviewer-uuid}', nickname: 'coderabbitai', display_name: 'A reviewer' };
const REPLY = { uuid: '{author-uuid}', nickname: 'author', display_name: 'Author' };
const PR = {
  id: 42, title: 'A review', state: 'OPEN', source: { commit: { hash: HEAD } }, destination: { commit: { hash: BASE } }, author: REPLY,
  participants: [
    { user: USER, role: 'REVIEWER', approved: true, state: 'approved' },
    { user: REPLY, role: 'REVIEWER', approved: false, state: 'changes_requested' },
  ],
};

function comment(id: number, parent: number | null = null): Record<string, unknown> {
  return {
    id, parent: parent === null ? null : { id: parent }, user: parent === null ? USER : REPLY, content: { raw: parent === null ? 'This crashes on empty input.' : 'Fixed in the new commit.' },
    created_on: parent === null ? DATE : LATER, updated_on: LATER, deleted: false, resolution: null,
    inline: parent === null ? { path: 'src/a.ts', to: 5, from: null, outdated: true } : null,
    links: { html: { href: `https://bitbucket.org/acme/widgets/pull-requests/42/_/diff#comment-${id}` } },
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function setup(overrides: Readonly<Record<string, unknown>> = {}, failure: string | null = null): { page: ProviderReviewPage; client: BitbucketClient; reads: () => number } {
  const page = describeBitbucketPage(new URL('https://bitbucket.org/acme/widgets/pull-requests/42'));
  if (page === null) throw new Error('Invalid fixture');
  let reads = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const resource = url.pathname.slice(ROOT.length + 1);
    if (url.pathname === ROOT) {
      reads += 1;
      return json(overrides.pr ?? PR);
    }
    if (resource === failure) return json({ error: { message: 'Unauthorized' } }, 401);
    const fallback = resource === 'comments' ? [comment(11, 10), comment(10)] : [];
    return json({ values: overrides[resource] ?? fallback });
  };
  return { page, client: new BitbucketClient(page, fetcher), reads: () => reads };
}

describe('Bitbucket review normalization from documented API fixtures', () => {
  it('groups replies by native parent with stable identity, native permalinks and reviewer standing', async () => {
    const { page, client, reads } = setup();
    const snapshot = await fetchBitbucketReview(page, new AbortController().signal, client);
    expect(reads()).toBe(2);
    expect(snapshot.input.subject).toEqual({ provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'acme/widgets', id: '42', headSha: HEAD });
    expect(snapshot.input.threads).toHaveLength(1);
    expect(snapshot.input.threads[0]).toMatchObject({ id: '10', anchor: 'comment-10', path: 'src/a.ts', line: 5, resolved: false, outdated: true });
    expect(snapshot.input.threads[0]?.comments.map((source) => source.id)).toEqual(['10', '11']);
    expect(snapshot.input.threads[0]?.comments[0]).toMatchObject({ url: 'https://bitbucket.org/acme/widgets/pull-requests/42/_/diff#comment-10', author: { id: USER.uuid, login: USER.nickname } });
    expect(snapshot.input.reviewers?.map((reviewer) => reviewer.state)).toEqual(['approved', 'changes_requested']);
    expect(snapshot.input.bots).toEqual([]);
    expect(buildProviderReviewItems(snapshot.input)[0]?.sources[0]?.bot).toBeUndefined();
    expect(snapshot.actions).toEqual([]);
    expect(snapshot.approvalsRequired).toBeNull();
    expect(snapshot.complete).toBe(false);
    expect(snapshot.input.complete).toBe(false);
    expect(snapshot.unavailable).toContainEqual(expect.objectContaining({ area: 'approval requirements' }));
  });

  it('keeps resolved threads distinct from open tasks and regular standalone comments', async () => {
    const standalone = { ...comment(20), inline: null };
    const { page, client } = setup({
      comments: [{ ...comment(10), resolution: { resolved_on: LATER } }, comment(11, 10), standalone],
      tasks: [{ id: 7, content: { raw: 'Add coverage' }, state: 'OPEN', comment: { id: 10 }, creator: USER, created_on: DATE }],
    });
    const snapshot = await fetchBitbucketReview(page, new AbortController().signal, client);
    expect(snapshot.input.threads.find((thread) => thread.id === '10')?.resolved).toBe(true);
    expect(snapshot.tasks[0]?.state).toBe('OPEN');
    expect(snapshot.events).toContainEqual(expect.objectContaining({ id: 'task-7', body: 'Task open: Add coverage' }));
    // An explicit resolution field makes a standalone native-resolvable comment a thread too.
    expect(snapshot.input.threads.some((thread) => thread.id === '20')).toBe(true);
    const regular = setup({ comments: [{ ...standalone, resolution: undefined }] });
    const regularSnapshot = await fetchBitbucketReview(regular.page, new AbortController().signal, regular.client);
    expect(regularSnapshot.comments.map((source) => source.id)).toEqual(['20']);
    expect(regularSnapshot.input.threads).toEqual([]);
  });

  it('does not turn 401 into a complete empty task list', async () => {
    const { page, client } = setup({}, 'tasks');
    const snapshot = await fetchBitbucketReview(page, new AbortController().signal, client);
    expect(snapshot.input.threads).toHaveLength(1);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.unavailable).toContainEqual(expect.objectContaining({ area: 'tasks', reason: expect.stringContaining('Sign in') }));
  });

  it('rejects missing, foreign, wrong-review and mismatched comment permalinks without fabricating source anchors', async () => {
    const urls = [undefined, 'https://example.com/acme/widgets/pull-requests/42#comment-10', 'https://bitbucket.org/acme/widgets/pull-requests/43#comment-10', 'https://bitbucket.org/acme/widgets/pull-requests/42#comment-99', 'javascript:alert(1)'];
    for (const href of urls) {
      const { page, client } = setup({ comments: [{ ...comment(10), links: href === undefined ? {} : { html: { href } } }] });
      const snapshot = await fetchBitbucketReview(page, new AbortController().signal, client);
      expect(snapshot.input.threads).toEqual([]);
      expect(snapshot.unavailable).toContainEqual(expect.objectContaining({ area: 'comments' }));
    }
  });

  it('keeps only explicitly current-head statuses and reports missing provenance', async () => {
    const status = { key: 'ci', name: 'CI', state: 'SUCCESSFUL', created_on: DATE, updated_on: LATER, url: 'https://builds.example.com/1' };
    const { page, client } = setup({ statuses: [
      { ...status, links: { self: { href: `https://api.bitbucket.org/2.0/repositories/acme/widgets/commit/${HEAD}/statuses/build/ci` } } },
      { ...status, name: 'Old CI', links: { self: { href: `https://api.bitbucket.org/2.0/repositories/acme/widgets/commit/${BASE}/statuses/build/ci` } } },
      { ...status, name: 'Unknown CI' },
      { ...status, name: 'Forged CI', links: { self: { href: `https://example.com/commit/${HEAD}/statuses/build/ci` } } },
    ] });
    const snapshot = await fetchBitbucketReview(page, new AbortController().signal, client);
    expect(snapshot.input.checks).toEqual([expect.objectContaining({ name: 'CI', sha: HEAD, status: 'completed', conclusion: 'success', startedAt: DATE, completedAt: LATER })]);
    expect(snapshot.unavailable.filter((item) => item.area === 'CI checks')).toHaveLength(2);
  });

  it('renders only explicit source and state changes as timeline events', async () => {
    const { page, client } = setup({ activity: [
      { update: { date: DATE, author: USER, changes: { source: { old: { commit: { hash: BASE } }, new: { commit: { hash: HEAD } } } } } },
      { update: { date: LATER, author: USER, changes: { state: { old: 'OPEN', new: 'MERGED' } }, source: { commit: { hash: HEAD } } } },
      { update: { date: LATER, author: USER, state: 'MERGED', source: { commit: { hash: HEAD } } } },
    ] });
    const snapshot = await fetchBitbucketReview(page, new AbortController().signal, client);
    expect(snapshot.events.map((event) => event.body)).toEqual([`Pushed ${HEAD.slice(0, 8)}`, 'Merged the pull request', 'Updated the pull request']);
  });

  it('rejects mixed conversation snapshots after a push and preserves aborts', async () => {
    const { page } = setup();
    let reads = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      return url.pathname === ROOT ? json(++reads === 1 ? PR : { ...PR, source: { commit: { hash: 'c'.repeat(40) } } }) : json({ values: [] });
    };
    await expect(fetchBitbucketReview(page, new AbortController().signal, new BitbucketClient(page, fetcher))).rejects.toMatchObject({ reason: 'changed' });
    const controller = new AbortController();
    const ready = setup();
    controller.abort();
    await expect(fetchBitbucketReview(ready.page, controller.signal, ready.client)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not loop or duplicate a thread when the API returns a parent cycle', async () => {
    const { page, client } = setup({ comments: [comment(10, 11), comment(11, 10)] });
    const snapshot = await fetchBitbucketReview(page, new AbortController().signal, client);
    expect(snapshot.input.threads).toEqual([]);
    expect(snapshot.unavailable.filter((item) => item.area === 'comments')).toHaveLength(2);
  });
});


describe('Bitbucket source state and completeness', () => {
  it.each([
    ['OPEN', false], ['DECLINED', true], ['MERGED', true], ['SUPERSEDED', true],
  ])('derives closed from native PR state %s', async (state, closed) => {
    const { page, client } = setup({ pr: { ...PR, state } });
    const snapshot = await fetchBitbucketReview(page, new AbortController().signal, client);
    expect(snapshot.input.closed).toBe(closed);
    expect(snapshot.input.complete).toBe(snapshot.complete);
    expect(snapshot.input.complete).toBe(false);
  });

  it('uses the final state after a merge with the same head', async () => {
    const { page } = setup();
    let reads = 0;
    const fetcher: typeof fetch = async (input) => new URL(String(input)).pathname === ROOT
      ? json({ ...PR, state: ++reads === 1 ? 'OPEN' : 'MERGED' })
      : json({ values: [] });
    const snapshot = await fetchBitbucketReview(page, new AbortController().signal, new BitbucketClient(page, fetcher));
    expect(snapshot.input.closed).toBe(true);
    expect(snapshot.input.complete).toBe(false);
  });
});
