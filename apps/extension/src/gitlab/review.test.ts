// @vitest-environment happy-dom
import type { ProviderReviewSubject } from '@geld/review';
import type { ProviderReviewPage } from '../providers/types';
import { fetchGitLabReview, gitLabReviewCapabilities, parseGitLabDiscussions } from './review';

const SHA = 'a'.repeat(40);
const subject: ProviderReviewSubject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/subgroup/repo', id: '7', headSha: SHA };
const page: ProviderReviewPage = {
  provider: 'gitlab', repository: { provider: 'gitlab', origin: subject.origin, path: subject.repository }, number: '7',
  url: 'https://gitlab.com/group/subgroup/repo/-/merge_requests/7',
  diffPageUrl: 'https://gitlab.com/group/subgroup/repo/-/merge_requests/7/diffs',
  diffUrl: 'https://gitlab.com/group/subgroup/repo/-/merge_requests/7.diff', kind: 'overview', headSha: SHA, version: SHA,
};

function note(id: number, body = 'Could this fail?', extra: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    id: String(id), note: body, author: { id: 23, username: 'reviewer', bot: false, user_type: 'human' },
    created_at: '2026-10-29T16:52:16.580Z', updated_at: '2026-10-29T23:34:44.155Z', system: false,
    noteable_note_url: `${page.url}#note_${id}`, ...extra,
  };
}

function discussion(id: string, notes: readonly unknown[], extra: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return { id, notes, resolvable: true, resolved: false, diff_discussion: false, discussion_path: null, ...extra };
}

function json(value: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('GitLab discussion normalization', () => {
  it('keeps resolvable ordinary discussions, top-level comments and system activity distinct', () => {
    const parsed = parseGitLabDiscussions([
      discussion('a'.repeat(40), [note(11), note(12, 'Yes, I will fix it.')]),
      discussion('b'.repeat(40), [note(13, 'General feedback')], { resolvable: false }),
      discussion('c'.repeat(40), [note(14, 'pushed 1 commit', { system: true, system_note_icon_name: 'commit' })], { resolvable: false }),
    ], subject);
    expect(parsed.threads).toHaveLength(1);
    expect(parsed.threads[0]).toMatchObject({ id: 'a'.repeat(40), anchor: `discussion_${'a'.repeat(40)}`, resolved: false, outdated: false });
    expect(parsed.threads[0]?.comments.map((entry) => entry.anchor)).toEqual(['note_11', 'note_12']);
    expect(parsed.comments.map((entry) => entry.anchor)).toEqual(['note_13']);
    expect(parsed.events).toMatchObject([{ id: '14', body: 'pushed 1 commit', icon: 'commit', kind: 'push' }]);
  });

  it('uses the native diff position and URL while keeping outdated separate from resolved', () => {
    const path = 'src/fix.ts';
    const parsed = parseGitLabDiscussions([discussion('a'.repeat(40), [note(11)], {
      diff_discussion: true, active: false, resolved: false, position: { old_path: 'src/old.ts', new_path: path, old_line: null, new_line: 42 },
      discussion_path: '/group/subgroup/repo/-/merge_requests/7/diffs#native-file-hash_0_42',
    })], subject);
    expect(parsed.threads[0]).toMatchObject({ path, line: 42, resolved: false, outdated: true, url: `${page.diffPageUrl}#native-file-hash_0_42` });
  });

  it('does not accept forged external permalinks or reinterpret GitHub-style bots', () => {
    const parsed = parseGitLabDiscussions([discussion('a'.repeat(40), [note(11, 'Review', {
      noteable_note_url: 'https://attacker.example/note_11', author: { id: 23, username: 'coderabbitai[bot]', bot: true, user_type: 'project_bot' },
    })])], subject);
    expect(parsed.threads[0]?.comments[0]).toMatchObject({ url: `${page.url}#note_11`, author: { id: '23', login: 'coderabbitai[bot]', automated: true } });
    expect(parsed.threads[0]?.comments[0]?.author).not.toHaveProperty('bot');
  });

  it('rejects invalid or duplicated records instead of silently dropping findings', () => {
    expect(() => parseGitLabDiscussions({ errors: 'unauthorized' }, subject)).toThrow('discussion list');
    expect(() => parseGitLabDiscussions([discussion('a'.repeat(40), [note(11), note(11)])], subject)).toThrow('duplicate note');
    expect(() => parseGitLabDiscussions([discussion('a'.repeat(40), [note(11, 'Body', { updated_at: 'not a date' })])], subject)).toThrow('timestamp');
  });

  it('requires every resolvable note permission for whole-thread resolution', () => {
    const parsed = parseGitLabDiscussions([discussion('a'.repeat(40), [
      note(11, 'Question', { resolvable: true, current_user: { can_edit: true, can_award_emoji: true, can_resolve: true, can_resolve_discussion: true } }),
      note(12, 'Reply', { resolvable: true, current_user: { can_resolve_discussion: false } }),
    ])], subject);
    expect(parsed.threadCapabilities.get('a'.repeat(40))).toMatchObject({
      canResolve: false,
      notes: [
        { noteId: '11', canEdit: true, canReact: true, canResolve: true, canResolveDiscussion: true },
        { noteId: '12', canEdit: false, canReact: false, canResolve: false, canResolveDiscussion: false },
      ],
    });
  });
});

describe('GitLab review acquisition', () => {
  it('uses the web discussion endpoint, follows pagination and keeps merge-pipeline provenance', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      if (url.pathname.endsWith('/approvals')) return json({ approved_by: [{ user: { id: 10, username: 'approver' } }], approvals_required: 2, approvals_left: 1, user_can_approve: false });
      if (url.pathname.endsWith('/reviewers')) return json([
        { user: { id: 10, username: 'approver' }, state: 'unreviewed' },
        { user: { id: 11, username: 'changes' }, state: 'requested_changes' },
      ]);
      if (url.pathname.endsWith('/discussions.json')) return url.searchParams.get('page') === '2'
        ? json([discussion('b'.repeat(40), [note(12)], { resolved: true })])
        : json([discussion('a'.repeat(40), [note(11)])], 200, { 'x-next-page': '2' });
      if (url.pathname.endsWith('/merge_requests/7/pipelines')) return json([{ id: 50, project_id: 1, sha: 'b'.repeat(40) }]);
      if (url.pathname.endsWith('/pipelines/50/jobs')) return json([{ id: 100, name: 'test', status: 'running', web_url: `${subject.origin}/group/subgroup/repo/-/jobs/100`, started_at: '2026-10-29T20:00:00Z' }]);
      return json({ iid: 7, sha: SHA, state: 'opened', project_id: 1, head_pipeline: { id: 50, sha: 'b'.repeat(40) } });
    });
    vi.stubGlobal('fetch', fetcher);
    const snapshot = await fetchGitLabReview(page, new AbortController().signal);
    expect(snapshot.input.threads).toHaveLength(2);
    expect(snapshot.sourceCoverage).toEqual({ comments: 'complete', threads: 'complete' });
    expect(snapshot.approvalsRequired).toBe(2);
    expect(snapshot.approvalsLeft).toBe(1);
    expect(snapshot.input.reviewers).toMatchObject([
      { author: { id: '10', login: 'approver' }, state: 'approved', reviewRequest: 'pending' },
      { author: { id: '11', login: 'changes' }, state: 'changes_requested', reviewRequest: 'not-pending' },
    ]);
    expect(snapshot.checks[0]).toMatchObject({ id: '100', pipelineId: '50', sha: 'b'.repeat(40), reviewHeadSha: SHA, nativeStatus: 'running', status: 'in_progress', conclusion: null });
    expect(snapshot.capabilities.signedIn).toBe(false);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.input.complete).toBe(true);
    expect(snapshot.input.closed).toBe(false);
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('/api/v4/projects/group%2Fsubgroup%2Frepo/merge_requests/7'))).toBe(true);
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('/merge_requests/7/discussions?'))).toBe(false);
  });

  it('reports optional forbidden sources as unavailable without calling them empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/approvals') || input.includes('/pipelines?')) return json({ error: 'Unauthorized' }, 401);
      if (input.includes('/reviewers?')) return json([]);
      if (input.includes('/discussions.json')) return json([]);
      return json({ iid: 7, sha: SHA, state: 'opened' });
    }));
    const snapshot = await fetchGitLabReview(page, new AbortController().signal);
    expect(snapshot.input.threads).toEqual([]);
    expect(snapshot.approvalsRequired).toBeNull();
    expect(snapshot.unavailable).toMatchObject([{ area: 'reviews' }, { area: 'checks' }]);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.input.complete).toBe(false);
    expect(snapshot.sourceCoverage).toEqual({ comments: 'complete', threads: 'complete' });
  });

  it('never assigns an unrelated older pipeline to the current merge request head', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/discussions.json') || input.includes('/reviewers?')) return json([]);
      if (input.includes('/pipelines?')) return json([{ id: 50, project_id: 1, sha: 'b'.repeat(40) }]);
      if (input.endsWith('/approvals')) return json({ approved_by: [] });
      return json({ iid: 7, sha: SHA, state: 'opened', project_id: 1, head_pipeline: null });
    });
    vi.stubGlobal('fetch', fetcher);
    const snapshot = await fetchGitLabReview(page, new AbortController().signal);
    expect(snapshot.checks).toEqual([]);
    expect(fetcher.mock.calls.some(([input]) => input.includes('/pipelines/50/jobs'))).toBe(false);
  });

  it('refuses a sign-in HTML response, hostile endpoint path or head change', async () => {
    document.body.innerHTML = `<div id="js-vue-mr-discussions" data-notes-data='{"discussionsPath":"https://attacker.example/steal"}'></div>`;
    const fetcher = vi.fn(async (input: string) => input.includes('/discussions.json')
      ? new Response('<form>Sign in</form>', { headers: { 'content-type': 'text/html' } })
      : json({ iid: 7, sha: SHA, state: 'opened' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchGitLabReview(page, new AbortController().signal)).rejects.toThrow('sign-in page');
    expect(fetcher.mock.calls.some(([input]) => input.includes('attacker.example'))).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => json({ iid: 7, sha: 'b'.repeat(40) })));
    await expect(fetchGitLabReview(page, new AbortController().signal)).rejects.toThrow('head changed');
  });

  it('rejects a changed head after discussions arrive', async () => {
    let snapshots = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('/discussions.json') || input.includes('/pipelines?') || input.includes('/reviewers?')) return json([]);
      if (input.endsWith('/approvals')) return json({ approved_by: [] });
      snapshots += 1;
      return json({ iid: 7, sha: snapshots === 1 ? SHA : 'b'.repeat(40), state: 'opened' });
    }));
    await expect(fetchGitLabReview(page, new AbortController().signal)).rejects.toThrow('changed while');
  });

  it('preserves rate-limit retry timing and rejects looping discussion pagination', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('/discussions.json')) return json({ error: 'Too many requests' }, 429, { 'retry-after': '12' });
      if (input.includes('/pipelines?') || input.includes('/reviewers?')) return json([]);
      if (input.endsWith('/approvals')) return json({ approved_by: [] });
      return json({ iid: 7, sha: SHA, state: 'opened' });
    }));
    await expect(fetchGitLabReview(page, new AbortController().signal)).rejects.toMatchObject({ status: 429, retryAfterMs: 12_000 });
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('/discussions.json')) return json([], 200, { 'x-next-page': '1' });
      if (input.includes('/pipelines?') || input.includes('/reviewers?')) return json([]);
      if (input.endsWith('/approvals')) return json({ approved_by: [] });
      return json({ iid: 7, sha: SHA, state: 'opened' });
    }));
    await expect(fetchGitLabReview(page, new AbortController().signal)).rejects.toThrow('pagination cursor');
  });

  it('reads every cursor-paginated discussion page, including late findings', async () => {
    const requested: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/discussions.json')) {
        requested.push(url);
        return url.searchParams.get('cursor') === 'opaque+/cursor='
          ? json([discussion('b'.repeat(40), [note(12, 'A late critical finding')])])
          : json([discussion('a'.repeat(40), [note(11)])], 200, { 'x-next-page-cursor': 'opaque+/cursor=' });
      }
      if (url.pathname.endsWith('/pipelines') || url.pathname.endsWith('/reviewers')) return json([]);
      if (url.pathname.endsWith('/approvals')) return json({ approved_by: [] });
      return json({ iid: 7, sha: SHA, state: 'opened' });
    }));
    const snapshot = await fetchGitLabReview(page, new AbortController().signal);
    expect(snapshot.input.threads).toHaveLength(2);
    expect(snapshot.input.threads[1]?.comments[0]?.body).toBe('A late critical finding');
    expect(requested).toHaveLength(2);
    expect(requested[0]?.searchParams.get('notes_filter')).toBe('0');
    expect(requested[0]?.searchParams.get('persist_filter')).toBe('false');
    expect(requested[1]?.searchParams.get('cursor')).toBe('opaque+/cursor=');
    expect(requested[1]?.searchParams.has('page')).toBe(false);
    expect(snapshot.complete).toBe(true);
  });

  it('does not accept a repeating opaque discussion cursor as a complete review', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('/discussions.json')) return json([], 200, { 'x-next-page-cursor': 'same-cursor' });
      if (input.includes('/pipelines?') || input.includes('/reviewers?')) return json([]);
      if (input.endsWith('/approvals')) return json({ approved_by: [] });
      return json({ iid: 7, sha: SHA, state: 'opened' });
    }));
    await expect(fetchGitLabReview(page, new AbortController().signal)).rejects.toThrow('pagination cursor');
  });
});

describe('independent GitLab standing and current review request facts', () => {
  const user = { id: 10, username: 'reviewer', state: 'active' };
  function sources(approved: boolean, reviewers: readonly unknown[], status = 200): void {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/approvals')) return json({ approved_by: approved ? [{ user }] : [] });
      if (input.includes('/reviewers?')) return json(reviewers, status);
      if (input.includes('/discussions.json') || input.includes('/pipelines?')) return json([]);
      return json({ iid: 7, sha: SHA, state: 'opened' });
    }));
  }

  it.each([
    [true, 'unreviewed', 'approved', 'pending'],
    [true, 'reviewed', 'approved', 'not-pending'],
    [true, 'approved', 'approved', 'not-pending'],
    [false, 'unreviewed', 'pending', 'pending'],
    [false, 'reviewed', 'commented', 'not-pending'],
    [false, 'requested_changes', 'changes_requested', 'not-pending'],
  ] as const)('retains approval=%s with native reviewer %s as %s plus %s', async (approved, native, state, request) => {
    // Protocol cases, not a captured public approved-plus-unreviewed account.
    sources(approved, [{ user, state: native, created_at: '2020-01-01T00:00:00Z' }]);
    const snapshot = await fetchGitLabReview(page, new AbortController().signal);
    expect(snapshot.input.reviewers).toEqual([{ author: { id: '10', login: 'reviewer' }, state, reviewRequest: request }]);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.input.reviewers?.[0]).not.toHaveProperty('requestedAt');
  });

  it('keeps a known approval and explicitly unknown request when the reviewer source is forbidden or unfamiliar', async () => {
    sources(true, [], 403);
    const forbidden = await fetchGitLabReview(page, new AbortController().signal);
    expect(forbidden.input.reviewers).toEqual([{ author: { id: '10', login: 'reviewer' }, state: 'approved', reviewRequest: 'unknown' }]);
    expect(forbidden.complete).toBe(false);
    sources(true, [{ user, state: 'future-native-state' }]);
    const unknown = await fetchGitLabReview(page, new AbortController().signal);
    expect(unknown.input.reviewers).toEqual(forbidden.input.reviewers);
    expect(unknown.unavailable).toContainEqual(expect.objectContaining({ area: 'reviews' }));
    expect(unknown.complete).toBe(false);
  });

  it('joins paginated review requests by native account id rather than matching logins', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/approvals')) return json({ approved_by: [{ user }] });
      if (input.includes('/reviewers?')) {
        const url = new URL(input); requested.push(url.searchParams.get('page') ?? '1');
        return url.searchParams.get('page') === '2' ? json([{ user, state: 'unreviewed' }])
          : json([{ user: { ...user, id: 11 }, state: 'reviewed' }], 200, { 'x-next-page': '2' });
      }
      if (input.includes('/discussions.json') || input.includes('/pipelines?')) return json([]);
      return json({ iid: 7, sha: SHA, state: 'opened' });
    }));
    const snapshot = await fetchGitLabReview(page, new AbortController().signal);
    expect(requested).toEqual(['1', '2']);
    expect(snapshot.input.reviewers).toEqual([
      { author: { id: '10', login: 'reviewer' }, state: 'approved', reviewRequest: 'pending' },
      { author: { id: '11', login: 'reviewer' }, state: 'commented', reviewRequest: 'not-pending' },
    ]);
  });

  it('takes approval withdrawal from the new authoritative snapshot while retaining current request state', async () => {
    sources(true, [{ user, state: 'unreviewed' }]);
    expect((await fetchGitLabReview(page, new AbortController().signal)).input.reviewers?.[0]).toMatchObject({ state: 'approved', reviewRequest: 'pending' });
    sources(false, [{ user, state: 'unreviewed' }]);
    expect((await fetchGitLabReview(page, new AbortController().signal)).input.reviewers?.[0]).toMatchObject({ state: 'pending', reviewRequest: 'pending' });
  });
});

describe('GitLab native review capabilities', () => {
  it('never grants actions from mounts alone or an anonymous approval response', () => {
    document.body.innerHTML = '<div id="js-submit-review-button"></div><div id="js-review-drawer"></div>';
    expect(gitLabReviewCapabilities(document, { user_can_approve: true })).toEqual({ signedIn: false, canApprove: false, canComment: false, canReview: false, requestChanges: 'unavailable' });
  });
});


describe('GitLab source state and completeness', () => {
  it.each([
    ['opened', false], ['locked', false], ['closed', true], ['merged', true],
  ])('derives closed from final native state %s', async (state, closed) => {
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('/discussions.json') || input.includes('/pipelines?') || input.includes('/reviewers?')) return json([]);
      if (input.endsWith('/approvals')) return json({ approved_by: [], approvals_required: 0, approvals_left: 0 });
      reads += 1;
      return json({ iid: 7, sha: SHA, state: reads === 1 ? 'opened' : state });
    }));
    const snapshot = await fetchGitLabReview(page, new AbortController().signal);
    expect(snapshot.state).toBe(state);
    expect(snapshot.input.closed).toBe(closed);
    expect(snapshot.input.complete).toBe(snapshot.complete);
    expect(snapshot.complete).toBe(true);
  });

  it('does not silently call an unknown merge request state open', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.includes('/discussions.json') || input.includes('/pipelines?') || input.includes('/reviewers?')) return json([]);
      if (input.endsWith('/approvals')) return json({ approved_by: [] });
      return json({ iid: 7, sha: SHA, state: 'UNKNOWN_FUTURE_STATE' });
    }));
    await expect(fetchGitLabReview(page, new AbortController().signal)).rejects.toThrow('invalid merge request state');
  });
});


it('keeps fully read GitLab comments separate from unknown native diff-thread state', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.includes('/discussions.json')) return json([discussion('a'.repeat(40), [note(11)], { diff_discussion: true, position: { new_path: 'src/a.ts', new_line: 5 } })]);
    if (input.includes('/pipelines?') || input.includes('/reviewers?')) return json([]);
    if (input.endsWith('/approvals')) return json({ approved_by: [] });
    return json({ iid: 7, sha: SHA, state: 'opened' });
  }));
  const snapshot = await fetchGitLabReview(page, new AbortController().signal);
  expect(snapshot.sourceCoverage).toEqual({ comments: 'complete', threads: 'partial' });
  expect(snapshot.input.threads[0]?.stateKnown).toBe(false);
  expect(snapshot.unavailable).toContainEqual(expect.objectContaining({ area: 'thread state' }));
  expect(snapshot.complete).toBe(false);
});

it('matches a real CI adapter publication against web-normalized GitLab discussion facts', async () => {
  // Protocol fixtures only: REST body/resolvable-note states and web note/aggregate
  // states model the documented API families, with no provider requests or writes.
  const { readProviderCiConfig } = await import('../../../action/src/providers/config');
  const { ProviderHttp } = await import('../../../action/src/providers/http');
  const { GitLabCiAdapter } = await import('../../../action/src/providers/gitlab');
  const { produceProviderSummary } = await import('../../../action/src/providers/summary');
  const { parsePublishedSummaryBody, readProviderPublication } = await import('@geld/review');
  const nativeNotes = [note(11, 'This crashes.', { resolvable: true, resolved: true, type: 'DiscussionNote' }), note(12, 'Still reproduces.', { resolvable: true, resolved: false, type: 'DiscussionNote' })];
  const discussionId = 'a'.repeat(40);
  let saved = '';
  let discussionReads = 0;
  const config = readProviderCiConfig({ GELD_PROVIDER: 'gitlab', GELD_REPOSITORY: subject.repository, GELD_REVIEW_NUMBER: subject.id, GELD_TOKEN: 'local-protocol-fixture' });
  const ciFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith('/user')) return json({ id: 7 });
    if (url.pathname.endsWith('/discussions')) {
      discussionReads += 1;
      return json([{ id: discussionId, notes: nativeNotes.map((entry) => ({ ...entry, body: entry.note })) }]);
    }
    if (url.pathname.endsWith('/notes')) {
      if (init?.method === 'POST' && typeof init.body === 'string') {
        const body: unknown = JSON.parse(init.body);
        if (typeof body !== 'object' || body === null || !('body' in body) || typeof body.body !== 'string') throw new Error('Missing generated summary');
        saved = body.body;
        return json({ id: 901 });
      }
      return json([]);
    }
    if (url.pathname.endsWith('/approvals')) return json({ approved_by: [] });
    if (url.pathname.endsWith('/reviewers') || url.pathname.endsWith('/pipelines')) return json([]);
    return json({ iid: 7, sha: SHA, state: 'opened' });
  };
  expect(await produceProviderSummary(new GitLabCiAdapter(new ProviderHttp(config, ciFetch)))).toBe('created');
  expect(discussionReads).toBe(1);
  const publication = parsePublishedSummaryBody(saved);
  if (!publication.ok) throw new Error('Invalid CI publication');
  expect(publication.value.nativePublication?.items).toHaveLength(1);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.includes('/discussions.json')) return json([
      discussion(discussionId, nativeNotes, { resolved: false }),
      discussion('b'.repeat(40), [note(901, saved, { author: { id: 7, username: 'geld-ci' } })], { resolvable: false }),
    ]);
    if (input.endsWith('/approvals')) return json({ error: 'Not available' }, 403);
    if (input.includes('/reviewers?') || input.includes('/pipelines?')) return json([]);
    return json({ iid: 7, sha: SHA, state: 'opened' });
  }));
  const snapshot = await fetchGitLabReview(page, new AbortController().signal);
  expect(snapshot.complete).toBe(false);
  expect(snapshot.sourceCoverage).toEqual({ comments: 'complete', threads: 'complete' });
  expect(snapshot.input.threads[0]).toMatchObject({ id: discussionId, anchor: `discussion_${discussionId}`, resolved: false, stateKnown: true });
  const { createNativePublication, buildProviderReviewItems } = await import('@geld/review');
  const actualProof = await createNativePublication(snapshot.input, buildProviderReviewItems(snapshot.input));
  expect(actualProof).toEqual(publication.value.nativePublication);
  const read = await readProviderPublication({ input: snapshot.input, comments: snapshot.comments, sourceCoverage: snapshot.sourceCoverage, trustedPublisherIds: ['7'] });
  expect(read.issues).toEqual([]);
  expect(read.status).toBe('current');
  expect(read.matchedItemIds.size).toBe(1);
  expect(read.comments).toEqual([]);
  expect(read.input.threads[0]?.comments).toHaveLength(2);
});
