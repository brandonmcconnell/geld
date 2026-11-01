import { describe, expect, it } from 'vitest';
import { parsePublishedSummaryBody, parseSummaryBody, SUMMARY_HEADING, SUMMARY_MARKER } from '@geld/review';
import type { ProviderReviewInput } from '@geld/review';
import { readProviderCiConfig } from './config';
import type { ProviderCiConfig } from './config';
import { ProviderHttp } from './http';
import { GitLabCiAdapter } from './gitlab';
import { BitbucketCiAdapter } from './bitbucket';
import { findOwnedSummary, produceProviderSummary, runProviderSummary } from './summary';
import type { ProviderCiAdapter, ProviderCiReview } from './types';

const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const DATE = '2026-11-01T10:00:00Z';
const TOKEN = 'fixture-secret-not-for-logs';
const SUMMARY_PREFIX = `${SUMMARY_MARKER}\n### ${SUMMARY_HEADING}\n`;

function json(value: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function config(provider: 'gitlab' | 'bitbucket'): ProviderCiConfig {
  return readProviderCiConfig({ GELD_PROVIDER: provider, GELD_REPOSITORY: provider === 'gitlab' ? 'group/subgroup/project' : 'workspace/project', GELD_REVIEW_NUMBER: '42', GELD_TOKEN: TOKEN });
}

interface RequestRecord {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
  readonly authorization: string | null;
}

function transport(handler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>): { readonly fetcher: typeof fetch; readonly requests: RequestRecord[] } {
  const requests: RequestRecord[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const raw = init?.body;
    const body: unknown = typeof raw === 'string' ? JSON.parse(raw) : null;
    requests.push({ url: url.href, method: init?.method ?? 'GET', body, authorization: new Headers(init?.headers).get('authorization') });
    return handler(url, init);
  };
  return { fetcher, requests };
}

describe('provider CI configuration', () => {
  it('requires explicit secrets and collision-safe native review identity', () => {
    expect(config('gitlab')).toMatchObject({ origin: 'https://gitlab.com', apiBase: 'https://gitlab.com/api/v4', repository: 'group/subgroup/project', number: '42' });
    expect(config('bitbucket')).toMatchObject({ origin: 'https://bitbucket.org', apiBase: 'https://api.bitbucket.org/2.0' });
    for (const overrides of [{ GELD_TOKEN: '' }, { GELD_REVIEW_NUMBER: '0' }, { GELD_REPOSITORY: 'group/../private' }, { GELD_PROVIDER_ORIGIN: 'http://gitlab.com' }, { GELD_PROVIDER_ORIGIN: 'https://user:password@gitlab.com' }, { GELD_API_BASE: 'https://example.com/api/v4' }]) {
      expect(() => readProviderCiConfig({ GELD_PROVIDER: 'gitlab', GELD_REPOSITORY: 'group/project', GELD_REVIEW_NUMBER: '1', GELD_TOKEN: TOKEN, ...overrides })).toThrow();
    }
  });

  it('keeps Basic token authentication explicit and separate from the provider origin', async () => {
    const basic = readProviderCiConfig({ GELD_PROVIDER: 'bitbucket', GELD_REPOSITORY: 'workspace/project', GELD_REVIEW_NUMBER: '42', GELD_TOKEN: TOKEN, GELD_TOKEN_TYPE: 'basic', GELD_BITBUCKET_USERNAME: 'person@example.com' });
    const t = transport(() => json({ uuid: '{user}' }));
    await new ProviderHttp(basic, t.fetcher).request('user');
    expect(t.requests[0]?.authorization).toBe(`Basic ${Buffer.from(`person@example.com:${TOKEN}`).toString('base64')}`);
    expect(() => readProviderCiConfig({ ...basic, GELD_PROVIDER: 'bitbucket', GELD_REPOSITORY: 'workspace/project', GELD_REVIEW_NUMBER: '42', GELD_TOKEN: TOKEN, GELD_TOKEN_TYPE: 'basic' })).toThrow('GELD_BITBUCKET_USERNAME');
  });
});

describe('authenticated provider API boundaries', () => {
  it('does not follow redirects or hostile pagination with the token', async () => {
    const redirect = transport(() => new Response(null, { status: 302, headers: { location: 'https://example.com/capture' } }));
    await expect(new ProviderHttp(config('gitlab'), redirect.fetcher).request('user')).rejects.toThrow('redirected');
    expect(redirect.requests).toHaveLength(1);
    const next = transport(() => json({ values: [], next: 'https://example.com/private' }));
    await expect(new ProviderHttp(config('bitbucket'), next.fetcher).bitbucketValues('repositories/workspace/project/pullrequests/42/comments')).rejects.toThrow('untrusted');
    expect(next.requests).toHaveLength(1);
    const changedResource = transport(() => json({ values: [], next: 'https://api.bitbucket.org/2.0/repositories/other/private/pullrequests/42/comments' }));
    await expect(new ProviderHttp(config('bitbucket'), changedResource.fetcher).bitbucketValues('repositories/workspace/project/pullrequests/42/comments')).rejects.toThrow('changed API resources');
    expect(changedResource.requests).toHaveLength(1);
  });

  it('paginates both API families and rejects incomplete or repeated collections', async () => {
    const gl = transport((url) => url.searchParams.get('page') === '1' ? json([1], 200, { 'x-next-page': '2', 'x-total': '2' }) : json([2], 200, { 'x-next-page': '', 'x-total': '2' }));
    expect(await new ProviderHttp(config('gitlab'), gl.fetcher).gitlabArray('projects/group%2Fproject/merge_requests/42/notes')).toEqual([1, 2]);
    const bb = transport((url) => url.searchParams.get('page') === '2' ? json({ values: [2], size: 2 }) : json({ values: [1], size: 2, next: 'https://api.bitbucket.org/2.0/repositories/workspace/project/pullrequests/42/comments?page=2' }));
    expect(await new ProviderHttp(config('bitbucket'), bb.fetcher).bitbucketValues('repositories/workspace/project/pullrequests/42/comments')).toEqual([1, 2]);
    const incomplete = transport(() => json({ values: [], size: 3 }));
    await expect(new ProviderHttp(config('bitbucket'), incomplete.fetcher).bitbucketValues('repositories/workspace/project/pullrequests/42/comments')).rejects.toThrow('incomplete');
    const repeated = transport(() => json([], 200, { 'x-next-page': '1' }));
    await expect(new ProviderHttp(config('gitlab'), repeated.fetcher).gitlabArray('projects/group%2Fproject/merge_requests/42/notes')).rejects.toThrow('did not finish');
  });

  it('keeps authentication failure and HTML distinct from empty data without logging response secrets', async () => {
    const failure = transport(() => json({ error: TOKEN }, 401));
    const request = new ProviderHttp(config('gitlab'), failure.fetcher).request('user');
    await expect(request).rejects.toThrow('HTTP 401');
    await expect(request).rejects.not.toThrow(TOKEN);
    const html = transport(() => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(new ProviderHttp(config('gitlab'), html.fetcher).request('user')).rejects.toThrow('did not return JSON');
  });
});

function input(): ProviderReviewInput {
  return {
    subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/subgroup/project', id: '42', headSha: HEAD },
    threads: [{
      id: '12345678', anchor: 'note_10', url: 'https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_10', resolved: false, outdated: false, stateKnown: true,
      comments: [{ id: '10', anchor: 'note_10', url: 'https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_10', author: { id: '8', login: 'reviewer' }, body: 'This crashes on empty input.', createdAt: DATE }],
    }],
  };
}

describe('provider summary ownership and determinism', () => {
  it('omits explicitly unknown pending requests from the legacy login-only payload without changing its schema', async () => {
    let body = '';
    const source: ProviderReviewInput = { ...input(), reviewers: [
      { author: { id: '1', login: 'approved' }, state: 'approved', reviewRequest: 'pending' },
      { author: { id: '2', login: 'requested' }, state: 'pending', reviewRequest: 'pending' },
      { author: { id: '3', login: 'assigned' }, state: 'pending', reviewRequest: 'unknown' },
      { author: { id: '4', login: 'legacy' }, state: 'pending' },
    ] };
    const adapter: ProviderCiAdapter = {
      identity: async () => 'owner', head: async () => HEAD,
      load: async () => ({ input: source, comments: [], notes: [] }),
      upsert: async (_id, value) => { body = value; },
    };
    expect(await produceProviderSummary(adapter, DATE)).toBe('created');
    const parsed = parsePublishedSummaryBody(body);
    if (!parsed.ok) throw new Error('Invalid fixture summary');
    expect(parsed.value.reviewers).toEqual([
      { login: 'approved', state: 'approved' }, { login: 'requested', state: 'pending' }, { login: 'legacy', state: 'pending' },
    ]);
    expect(body).not.toContain('@assigned pending');
    expect(source.reviewers?.[0]?.reviewRequest).toBe('pending');
  });
  it('rechecks durable ownership immediately before an update on both providers', async () => {
    for (const provider of ['gitlab', 'bitbucket'] as const) {
      const t = transport((url) => {
        if (url.pathname.endsWith('/user')) return json(provider === 'gitlab' ? { id: 7 } : { uuid: '{owner}' });
        return json(provider === 'gitlab' ? { id: 901, author: { id: 8, username: 'geld' }, body: SUMMARY_MARKER } : { id: 901, user: { uuid: '{attacker}', nickname: 'geld' }, content: { raw: SUMMARY_MARKER } });
      });
      const http = new ProviderHttp(config(provider), t.fetcher);
      const adapter = provider === 'gitlab' ? new GitLabCiAdapter(http) : new BitbucketCiAdapter(http);
      await expect(adapter.upsert('901', 'New summary')).rejects.toThrow('not owned by the token');
      expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
    }
  });

  it('does not select another author by marker or heading', () => {
    expect(findOwnedSummary([{ id: '1', authorId: 'attacker', body: SUMMARY_MARKER }, { id: '2', authorId: 'owner', body: '### Geld review summary' }], 'owner')).toBeNull();
    expect(findOwnedSummary([{ id: '1', authorId: 'attacker', body: SUMMARY_PREFIX }, { id: '2', authorId: 'owner', body: SUMMARY_PREFIX }], 'owner')?.id).toBe('2');
  });

  it('creates its machine comment without replacing the owner’s ordinary quoted mention', async () => {
    const comments = [{ id: '901', authorId: '7', body: `I found this documentation example: ${SUMMARY_MARKER}; please investigate.` }];
    expect(findOwnedSummary(comments, '7')).toBeNull();
    expect(findOwnedSummary([...comments, { id: '902', authorId: '7', body: `${SUMMARY_PREFIX}Invalid JSON cache` }], '7')?.id).toBe('902');
    let created = '';
    const adapter: ProviderCiAdapter = {
      identity: async () => '7', head: async () => HEAD,
      load: async () => ({ input: input(), comments, notes: [] }),
      upsert: async (id, body) => { expect(id).toBeNull(); created = body; },
    };
    expect(await produceProviderSummary(adapter, DATE)).toBe('created');
    expect(parsePublishedSummaryBody(created).ok).toBe(true);
    expect(comments[0]?.body).toContain('please investigate.');
  });

  it('allows both native APIs to repair an owned machine frame with damaged cached data', async () => {
    for (const provider of ['gitlab', 'bitbucket'] as const) {
      const broken = `${SUMMARY_PREFIX}\n\`\`\`geld\n{invalid}\n\`\`\``;
      expect(parsePublishedSummaryBody(broken).ok).toBe(false);
      const t = transport((url) => {
        if (url.pathname.endsWith('/user')) return json(provider === 'gitlab' ? { id: 7 } : { uuid: '{owner}' });
        return json(provider === 'gitlab' ? { id: 901, author: { id: 7, username: 'geld' }, body: broken } : { id: 901, user: { uuid: '{owner}', nickname: 'geld' }, content: { raw: broken } });
      });
      const http = new ProviderHttp(config(provider), t.fetcher);
      const adapter = provider === 'gitlab' ? new GitLabCiAdapter(http) : new BitbucketCiAdapter(http);
      await adapter.upsert('901', 'Corrected summary');
      expect(t.requests.map((request) => request.method)).toEqual(['GET', 'GET', 'PUT']);
      expect(t.requests[2]?.body).toEqual(provider === 'gitlab' ? { body: 'Corrected summary' } : { content: { raw: 'Corrected summary' } });
    }
  });

  it('aborts a previously selected summary when its owner changes the body to an ordinary reply', async () => {
    for (const provider of ['gitlab', 'bitbucket'] as const) {
      const owner = provider === 'gitlab' ? '7' : '{owner}';
      const selected = findOwnedSummary([{ id: '901', authorId: owner, body: `${SUMMARY_PREFIX}Damaged cached data` }], owner);
      expect(selected?.id).toBe('901');
      const changed = `The earlier comment was removed. Its marker was ${SUMMARY_MARKER}.`;
      const t = transport((url) => {
        if (url.pathname.endsWith('/user')) return json(provider === 'gitlab' ? { id: 7 } : { uuid: owner });
        return json(provider === 'gitlab' ? { id: 901, author: { id: 7, username: 'geld' }, body: changed } : { id: 901, user: { uuid: owner, nickname: 'geld' }, content: { raw: changed } });
      });
      const http = new ProviderHttp(config(provider), t.fetcher);
      const adapter = provider === 'gitlab' ? new GitLabCiAdapter(http) : new BitbucketCiAdapter(http);
      await expect(adapter.upsert(selected?.id ?? null, 'New summary')).rejects.toThrow('not owned by the token');
      expect(t.requests).toHaveLength(2);
      expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
    }
  });

  it('writes a validated native payload, then stops rewriting unchanged own summaries', async () => {
    let saved = '';
    let writes = 0;
    const adapter: ProviderCiAdapter = {
      identity: async () => '7', head: async () => HEAD,
      load: async (): Promise<ProviderCiReview> => ({ input: input(), notes: [], comments: saved === '' ? [{ id: '9', authorId: 'foreign', body: SUMMARY_MARKER }] : [{ id: '11', authorId: '7', body: saved }] }),
      upsert: async (id, body) => { expect(id).toBeNull(); saved = body; writes += 1; },
    };
    expect(await produceProviderSummary(adapter, DATE)).toBe('created');
    const meta = parseSummaryBody(saved);
    expect(meta.ok).toBe(true);
    if (!meta.ok) throw new Error('Invalid summary fixture');
    expect(meta.value.producer.ai).toBe(false);
    expect(meta.value.nativePublication?.subject).toEqual(input().subject);
    expect(meta.value.nativePublication?.items).toMatchObject([{ itemId: meta.value.items[0]?.id, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), sources: [{ id: '10', anchor: 'note_10', authorId: '8', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) }] }]);
    expect(meta.value.items[0]?.sources[0]).toMatchObject({ provider: 'gitlab', authorId: '8', anchor: 'note_10' });
    expect(saved).toContain('https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_10');
    expect(await produceProviderSummary(adapter, '2026-11-02T10:00:00Z')).toBe('unchanged');
    expect(writes).toBe(1);
  });

  it('keeps rich supplemental facts before the final footer and caches an unchanged rerun', async () => {
    let saved = '';
    let writes = 0;
    const source = input();
    const reviewInput = { ...source, checks: [{ name: 'CI', sha: HEAD, status: 'completed' as const, conclusion: 'success' as const }] };
    const adapter: ProviderCiAdapter = {
      identity: async () => '7', head: async () => HEAD,
      load: async () => ({ input: reviewInput, notes: ['Required approvals: 1', '**Tasks**', '- [ ] Task: inspect output'], comments: saved === '' ? [] : [{ id: '11', authorId: '7', body: saved }] }),
      upsert: async (_id, body) => { saved = body; writes += 1; },
    };
    expect(await produceProviderSummary(adapter, DATE)).toBe('created');
    expect(parsePublishedSummaryBody(saved).ok).toBe(true);
    expect(saved).toContain('Required approvals: 1\n**Tasks**\n- [ ] Task: inspect output\nCI checks: 1 passed, 0 failed, 0 running, 0 other\n\n<sub>');
    expect(saved.trimEnd()).toMatch(/<\/span><\/sub>$/);
    expect(await produceProviderSummary(adapter, '2026-11-02T10:00:00Z')).toBe('unchanged');
    expect(writes).toBe(1);
  });

  it('leaves an existing summary untouched when the head changes before writing', async () => {
    let writes = 0;
    const adapter: ProviderCiAdapter = { identity: async () => '7', head: async () => NEXT, load: async () => ({ input: input(), notes: [], comments: [] }), upsert: async () => { writes += 1; } };
    await expect(produceProviderSummary(adapter, DATE)).rejects.toThrow('head changed');
    expect(writes).toBe(0);
  });

  it('excludes only the owned summary note, retaining human replies and native thread state', async () => {
    const source = input();
    const original = source.threads[0];
    const human = original?.comments[0];
    if (original === undefined || human === undefined) throw new Error('Missing native fixture');
    const summary = { ...human, id: '11', anchor: 'note_11', url: human.url.replace('#note_10', '#note_11'), author: { id: '7', login: 'geld-ci' }, body: `${SUMMARY_PREFIX}Old summary` };
    const mixed = { ...original, path: 'src/cache.ts', line: 27, resolved: true, outdated: true, comments: [summary, human] };
    const summaryOnly = { ...original, id: '87654321', anchor: summary.anchor, url: summary.url, comments: [summary] };
    let saved = '';
    const adapter: ProviderCiAdapter = {
      identity: async () => '7', head: async () => HEAD,
      load: async () => ({ input: { ...source, threads: [mixed, summaryOnly] }, comments: [{ id: '11', authorId: '7', body: summary.body }], notes: [] }),
      upsert: async (id, body) => { expect(id).toBe('11'); saved = body; },
    };
    expect(await produceProviderSummary(adapter, DATE)).toBe('updated');
    const parsed = parsePublishedSummaryBody(saved);
    if (!parsed.ok) throw new Error('Invalid generated summary');
    expect(parsed.value.items).toHaveLength(1);
    expect(parsed.value.items[0]).toMatchObject({ path: 'src/cache.ts', line: 27, status: 'resolved', sources: [{ sourceId: human.id, authorId: human.author.id, anchor: human.anchor }] });
    expect(parsed.value.items[0]?.sources.some((entry) => entry.authorId === '7')).toBe(false);
    expect(source.threads[0]?.comments).toEqual([human]);
    expect(mixed.comments).toEqual([summary, human]);
  });


  it('publishes scoped metadata while omitting fingerprints for unknown thread state', async () => {
    const original = input();
    let saved = '';
    const adapter: ProviderCiAdapter = {
      identity: async () => '7', head: async () => HEAD,
      load: async () => ({ input: { ...original, threads: original.threads.map((thread) => ({ ...thread, stateKnown: false })) }, comments: [], notes: [] }),
      upsert: async (_id, body) => { saved = body; },
    };
    await produceProviderSummary(adapter, DATE);
    const parsed = parsePublishedSummaryBody(saved);
    if (!parsed.ok) throw new Error('Invalid generated summary');
    expect(parsed.value.items).toHaveLength(1);
    expect(parsed.value.nativePublication).toEqual({ v: 1, subject: original.subject, items: [] });
  });

  it('budgets native source fingerprints together with retained summary items', async () => {
    const original = input();
    const first = original.threads[0];
    const source = first?.comments[0];
    if (first === undefined || source === undefined) throw new Error('Missing source fixture');
    const threads = Array.from({ length: 100 }, (_, index) => {
      const id = String(index + 100);
      return { ...first, id: String(index + 10000000), path: `src/file-${index}.ts`, comments: [{ ...source, id, anchor: `note_${id}`, url: source.url.replace('#note_10', `#note_${id}`), body: `This crashes for input ${index}.` }] };
    });
    let saved = '';
    const adapter: ProviderCiAdapter = {
      identity: async () => '7', head: async () => HEAD,
      load: async () => ({ input: { ...original, threads }, comments: [], notes: [] }),
      upsert: async (_id, body) => { saved = body; },
    };
    await produceProviderSummary(adapter, DATE);
    const parsed = parsePublishedSummaryBody(saved);
    if (!parsed.ok) throw new Error('Invalid generated summary');
    expect(parsed.value.truncated).toBe(true);
    expect(parsed.value.items.length).toBeLessThan(100);
    expect(parsed.value.nativePublication?.items.map((entry) => entry.itemId)).toEqual(parsed.value.items.map((item) => item.id));
    expect(Buffer.byteLength(saved, 'utf8')).toBeLessThanOrEqual(30_000);
  });

  it('replaces a legacy or body-only cache with a correctly published footer', async () => {
    let saved = '';
    const adapter: ProviderCiAdapter = {
      identity: async () => '7', head: async () => HEAD,
      load: async () => ({ input: input(), comments: [{ id: '11', authorId: '7', body: `${SUMMARY_PREFIX}\n\`\`\`geld\n{}\n\`\`\`` }], notes: [] }),
      upsert: async (id, body) => { expect(id).toBe('11'); saved = body; },
    };
    expect(await produceProviderSummary(adapter, DATE)).toBe('updated');
    expect(parsePublishedSummaryBody(saved).ok).toBe(true);
  });
});

describe('GitLab authenticated protocol fixture', () => {
  it.each(['unreviewed', 'reviewed'] as const)('keeps a native approval beside its independent %s reviewer state in the typed producer input', async (state) => {
    const mr = '/api/v4/projects/group%2Fsubgroup%2Fproject/merge_requests/42';
    const user = { id: 8, username: 'reviewer' };
    const t = transport((url) => {
      if (url.pathname === mr) return json({ iid: 42, project_id: 1, sha: HEAD });
      if (url.pathname.endsWith('/approvals')) return json({ approved_by: [{ user }] });
      if (url.pathname.endsWith('/reviewers')) return json([{ user, state }]);
      return json([]);
    });
    const loaded = await new GitLabCiAdapter(new ProviderHttp(config('gitlab'), t.fetcher)).load();
    expect(loaded.input.reviewers).toEqual([{ author: { id: '8', login: 'reviewer' }, state: 'approved', reviewRequest: state === 'unreviewed' ? 'pending' : 'not-pending' }]);
    expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
  });
  it('reads the entire review and updates only a freshly verified owned note', async () => {
    const project = '/api/v4/projects/group%2Fsubgroup%2Fproject';
    const mr = `${project}/merge_requests/42`;
    const user = { id: 8, username: 'reviewer' };
    const owned = { id: 901, author: { id: 7, username: 'geld' }, body: `${SUMMARY_PREFIX}Old body` };
    const t = transport((url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(init?.redirect).toBe('manual');
      if (url.pathname === '/api/v4/user') return json({ id: 7 });
      if (url.pathname === mr) return json({ iid: 42, project_id: 1, sha: HEAD });
      if (url.pathname === `${mr}/discussions`) return json([{ id: '12345678', notes: [{ id: 10, author: user, body: 'This crashes.', created_at: DATE, updated_at: DATE, resolvable: true, resolved: false, position: { new_path: 'src/a.ts', new_line: 5 } }] }]);
      if (url.pathname === `${mr}/notes/901`) return json(owned);
      if (url.pathname === `${mr}/notes` && init?.method === 'PUT') throw new Error('Wrong update route');
      if (url.pathname === `${mr}/notes`) return json([{ id: 900, author: { id: 99, username: 'participant' }, body: SUMMARY_MARKER }, owned]);
      if (url.pathname === `${mr}/approvals`) return json({ approved_by: [{ user }], approvals_required: 1 });
      if (url.pathname === `${mr}/reviewers`) return json([{ user, state: 'approved' }]);
      if (url.pathname === `${mr}/pipelines`) return json([{ id: 20, project_id: 1, sha: HEAD }, { id: 19, project_id: 1, sha: HEAD }]);
      if (url.pathname === '/api/v4/projects/1/pipelines/20/jobs') return json([{ id: 10, name: 'CI', status: 'success', started_at: DATE, finished_at: DATE, web_url: 'https://gitlab.com/group/subgroup/project/-/jobs/10' }]);
      if (url.pathname === '/api/v4/projects/1/pipelines/19/jobs') return json([{ id: 9, name: 'CI', status: 'failed', started_at: DATE, finished_at: DATE, web_url: 'https://gitlab.com/group/subgroup/project/-/jobs/9' }]);
      throw new Error(`Unexpected fixture route ${url.pathname}`);
    });
    expect(await runProviderSummary(config('gitlab'), t.fetcher, DATE)).toBe('updated');
    const writes = t.requests.filter((request) => request.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: 'PUT', url: `https://gitlab.com${mr}/notes/901`, body: { body: expect.stringContaining('CI checks: 1 passed') } });
    expect(t.requests.some((request) => request.url.includes('/reviewers'))).toBe(true);
  });
});

describe('Bitbucket authenticated protocol fixture', () => {
  it('keeps native participant standing with explicitly unknown independent review requests', async () => {
    const root = '/2.0/repositories/workspace/project/pullrequests/42';
    const t = transport((url) => url.pathname === root ? json({ id: 42, source: { commit: { hash: HEAD } }, destination: { commit: { hash: NEXT } }, participants: [
      { user: { uuid: '{approved}', nickname: 'approved' }, role: 'REVIEWER', approved: true },
      { user: { uuid: '{assigned}', nickname: 'assigned' }, role: 'REVIEWER', approved: false },
    ] }) : json({ values: [] }));
    const loaded = await new BitbucketCiAdapter(new ProviderHttp(config('bitbucket'), t.fetcher)).load();
    expect(loaded.input.reviewers).toEqual([
      { author: { id: '{approved}', login: 'approved' }, state: 'approved', reviewRequest: 'unknown' },
      { author: { id: '{assigned}', login: 'assigned' }, state: 'pending', reviewRequest: 'unknown' },
    ]);
    expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
  });
  it('keeps visible replies when a deleted root has no remaining author, body or permalink', async () => {
    const root = '/2.0/repositories/workspace/project/pullrequests/42';
    const review = 'https://bitbucket.org/workspace/project/pull-requests/42';
    const t = transport((url, init) => {
      if (url.pathname === '/2.0/user') return json({ uuid: '{owner}' });
      if (url.pathname === root) return json({ id: 42, source: { commit: { hash: HEAD } }, destination: { commit: { hash: NEXT } }, participants: [] });
      if (url.pathname === `${root}/comments` && init?.method === 'POST') return json({ id: 100 }, 201);
      if (url.pathname === `${root}/comments`) return json({ values: [
        { id: 10, deleted: true, parent: null, inline: { path: 'src/a.ts', to: 5 }, resolution: null },
        { id: 11, deleted: false, parent: { id: 10 }, inline: null, user: { uuid: '{reviewer}', nickname: 'reviewer' }, content: { raw: 'This still crashes.' }, created_on: DATE, updated_on: DATE, links: { html: { href: `${review}/_/diff#comment-11` } } },
      ] });
      return json({ values: [] });
    });
    expect(await runProviderSummary(config('bitbucket'), t.fetcher, DATE)).toBe('created');
    const write = t.requests.find((request) => request.method === 'POST');
    const payload = write?.body;
    if (typeof payload !== 'object' || payload === null || !('content' in payload) || typeof payload.content !== 'object' || payload.content === null || !('raw' in payload.content) || typeof payload.content.raw !== 'string') throw new Error('Missing fixture summary');
    const meta = parseSummaryBody(payload.content.raw);
    if (!meta.ok) throw new Error('Invalid fixture summary');
    expect(meta.value.items[0]).toMatchObject({ path: 'src/a.ts', status: 'open', sources: [{ sourceId: '11', anchor: 'comment-11' }] });
  });

  it('creates an owned comment without adopting a participant marker and keeps tasks separate', async () => {
    const root = '/2.0/repositories/workspace/project/pullrequests/42';
    const review = 'https://bitbucket.org/workspace/project/pull-requests/42';
    const user = { uuid: '{reviewer}', nickname: 'coderabbitai' };
    const source = { id: 10, user, content: { raw: 'This crashes.' }, created_on: DATE, updated_on: DATE, parent: null, deleted: false, inline: { path: 'src/a.ts', to: 5 }, links: { html: { href: `${review}/_/diff#comment-10` } } };
    const t = transport((url, init) => {
      if (url.pathname === '/2.0/user') return json({ uuid: '{token-user}' });
      if (url.pathname === root) return json({ id: 42, source: { commit: { hash: HEAD } }, destination: { commit: { hash: NEXT } }, participants: [{ user, role: 'REVIEWER', approved: true }] });
      if (url.pathname === `${root}/comments` && init?.method === 'POST') return json({ id: 100 }, 201);
      if (url.pathname === `${root}/comments`) return json({ values: [source, { ...source, id: 11, parent: { id: 10 }, content: { raw: SUMMARY_MARKER }, links: { html: { href: `${review}/_/diff#comment-11` } } }] });
      if (url.pathname === `${root}/tasks`) return json({ values: [{ id: 20, content: { raw: 'Follow up' }, state: 'OPEN', comment: { id: 10 } }] });
      if (url.pathname === `${root}/activity`) return json({ values: [{ approval: { user, date: DATE } }] });
      if (url.pathname === `${root}/statuses`) return json({ values: [{ key: 'ci', name: 'CI', state: 'SUCCESSFUL', created_on: DATE, updated_on: DATE, links: { self: { href: `https://api.bitbucket.org/2.0/repositories/workspace/project/commit/${HEAD}/statuses/build/ci` } } }] });
      throw new Error(`Unexpected fixture route ${url.pathname}`);
    });
    expect(await runProviderSummary(config('bitbucket'), t.fetcher, DATE)).toBe('created');
    const writes = t.requests.filter((request) => request.method !== 'GET');
    expect(writes).toHaveLength(1);
    const payload = writes[0]?.body;
    expect(payload).toMatchObject({ content: { raw: expect.stringContaining('Task: Follow up') } });
    const raw = typeof payload === 'object' && payload !== null && 'content' in payload && typeof payload.content === 'object' && payload.content !== null && 'raw' in payload.content ? payload.content.raw : null;
    if (typeof raw !== 'string') throw new Error('Missing summary body');
    const meta = parseSummaryBody(raw);
    if (!meta.ok) throw new Error('Invalid payload');
    expect(meta.value.items[0]?.status).toBe('open');
    expect(meta.value.items[0]?.sources[0]?.bot).toBeUndefined();
    expect(meta.value.items[0]?.sources[0]?.provider).toBe('bitbucket');
  });

  it('does not post a misleading empty summary when a required source is unauthorized', async () => {
    const root = '/2.0/repositories/workspace/project/pullrequests/42';
    const t = transport((url) => {
      if (url.pathname === '/2.0/user') return json({ uuid: '{owner}' });
      if (url.pathname === root) return json({ id: 42, source: { commit: { hash: HEAD } }, destination: { commit: { hash: NEXT } }, participants: [] });
      return url.pathname.endsWith('/tasks') ? json({ error: TOKEN }, 401) : json({ values: [] });
    });
    await expect(runProviderSummary(config('bitbucket'), t.fetcher, DATE)).rejects.toThrow('HTTP 401');
    expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
  });
});

describe('Bitbucket authoritative abbreviated commit resolution', () => {
  const repository = 'workspace/project';
  const root = '/2.0/repositories/workspace/project/pullrequests/42';

  function reference(hash: string, fullName = repository): Record<string, unknown> {
    return { commit: { hash, type: 'commit', links: { self: { href: `https://api.bitbucket.org/2.0/repositories/${fullName}/commit/${hash}` } } }, repository: { full_name: fullName } };
  }

  it('resolves the observed public PR27 short hashes to full immutable SHAs at every snapshot', async () => {
    const repo = 'atlassian/bitbucket-upload-file';
    const shortHead = '9777bca47119';
    const shortBase = 'c522201d16c0';
    const fullHead = '9777bca47119a91758bde1209ac14e6076ffbf23';
    const fullBase = 'c522201d16c0142bd10bf7e606e72851d9669eb0';
    const path = `/2.0/repositories/${repo}/pullrequests/27`;
    const pr = { id: 27, source: reference(shortHead, repo), destination: reference(shortBase, repo), participants: [] };
    const t = transport((url, init) => {
      if (url.pathname === '/2.0/user') return json({ uuid: '{owner}' });
      if (url.pathname === path) return json(pr);
      if (url.pathname === `/2.0/repositories/${repo}/commit/${shortHead}` || url.pathname === `/2.0/repositories/${repo}/commit/${shortBase}`) {
        expect(url.searchParams.get('fields')).toBe('hash');
        return json({ hash: url.pathname.endsWith(shortHead) ? fullHead : fullBase });
      }
      if (url.pathname === `${path}/statuses`) return json({ values: [{ key: 'ci', name: 'CI', state: 'SUCCESSFUL', created_on: DATE, updated_on: DATE, links: { self: { href: `https://api.bitbucket.org/2.0/repositories/${repo}/commit/${shortHead}/statuses/build/ci` } } }] });
      if (url.pathname === `${path}/comments` && init?.method === 'POST') return json({ id: 100 }, 201);
      return json({ values: [] });
    });
    const cfg = readProviderCiConfig({ GELD_PROVIDER: 'bitbucket', GELD_REPOSITORY: repo, GELD_REVIEW_NUMBER: '27', GELD_TOKEN: TOKEN });
    expect(await runProviderSummary(cfg, t.fetcher, DATE)).toBe('created');
    expect(t.requests.filter((request) => new URL(request.url).pathname === `/2.0/repositories/${repo}/commit/${shortBase}`)).toHaveLength(3);
    expect(t.requests.filter((request) => new URL(request.url).pathname === `/2.0/repositories/${repo}/commit/${shortHead}`)).toHaveLength(4);
    const write = t.requests.find((request) => request.method === 'POST');
    const payload = write?.body;
    if (!payload || typeof payload !== 'object' || !('content' in payload) || !payload.content || typeof payload.content !== 'object' || !('raw' in payload.content) || typeof payload.content.raw !== 'string') throw new Error('Missing fixture summary');
    const parsed = parseSummaryBody(payload.content.raw);
    if (!parsed.ok) throw new Error('Invalid fixture summary');
    expect(parsed.value.headSha).toBe(fullHead);
    expect(payload.content.raw).toContain('CI checks: 1 passed');
  });

  it('resolves equal short prefixes in a source fork and target repository independently', async () => {
    const short = HEAD.slice(0, 12);
    const fullBase = 'a'.repeat(39) + 'b';
    const fork = 'contributor/project';
    const t = transport((url, init) => {
      if (url.pathname === '/2.0/user') return json({ uuid: '{owner}' });
      if (url.pathname === root) return json({ id: 42, source: reference(short, fork), destination: reference(short), participants: [] });
      if (url.pathname === `/2.0/repositories/${fork}/commit/${short}`) return json({ hash: HEAD, repository: { full_name: fork } });
      if (url.pathname === `/2.0/repositories/${repository}/commit/${short}`) return json({ hash: fullBase, repository: { full_name: repository } });
      if (url.pathname === `${root}/statuses`) return json({ values: [{ key: 'ci', name: 'CI', state: 'SUCCESSFUL', created_on: DATE, updated_on: DATE, links: { self: { href: `https://api.bitbucket.org/2.0/repositories/${fork}/commit/${short}/statuses/build/ci` } } }] });
      if (url.pathname === `${root}/comments` && init?.method === 'POST') return json({ id: 100 }, 201);
      return json({ values: [] });
    });
    expect(await runProviderSummary(config('bitbucket'), t.fetcher, DATE)).toBe('created');
    expect(t.requests.filter((request) => new URL(request.url).pathname === `/2.0/repositories/${fork}/commit/${short}`)).toHaveLength(4);
    expect(t.requests.filter((request) => new URL(request.url).pathname === `/2.0/repositories/${repository}/commit/${short}`)).toHaveLength(3);
  });

  it('rejects ambiguous, partial, wrong-prefix and mismatched-repository resolutions before writing', async () => {
    const short = HEAD.slice(0, 12);
    for (const result of [
      () => json({ error: 'ambiguous reference' }, 409),
      () => json({ hash: short }),
      () => json({ hash: NEXT }),
      () => json({ hash: HEAD, repository: { full_name: 'other/project' } }),
      () => json({ hash: HEAD, type: 'branch' }),
      () => json({ hash: HEAD, links: { self: { href: `https://api.bitbucket.org/2.0/repositories/${repository}/commit/${NEXT}` } } }),
    ]) {
      const t = transport((url) => {
        if (url.pathname === '/2.0/user') return json({ uuid: '{owner}' });
        if (url.pathname === root) return json({ id: 42, source: reference(short), destination: reference(NEXT), participants: [] });
        if (url.pathname === `/2.0/repositories/${repository}/commit/${short}`) return result();
        return json({ values: [] });
      });
      await expect(runProviderSummary(config('bitbucket'), t.fetcher, DATE)).rejects.toThrow();
      expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
    }
  });

  it('refuses missing or untrusted repository metadata and never follows a hostile commit self link', async () => {
    const short = HEAD.slice(0, 12);
    for (const source of [
      { commit: { hash: short } },
      reference(short, 'workspace/../../private'),
      { ...reference(short), commit: { hash: short, links: { self: { href: `https://example.com/commit/${short}` } } } },
      { ...reference(short), commit: { hash: short, links: { self: { href: `https://api.bitbucket.org/2.0/repositories/other/project/commit/${short}` } } } },
    ]) {
      const t = transport((url) => url.pathname === '/2.0/user' ? json({ uuid: '{owner}' }) : json({ id: 42, source, destination: reference(NEXT), participants: [] }));
      await expect(runProviderSummary(config('bitbucket'), t.fetcher, DATE)).rejects.toThrow();
      expect(t.requests).toHaveLength(2);
      expect(t.requests.every((request) => new URL(request.url).origin === 'https://api.bitbucket.org' && request.method === 'GET')).toBe(true);
    }
    const wrongTarget = transport((url) => url.pathname === '/2.0/user' ? json({ uuid: '{owner}' }) : json({ id: 42, source: reference(HEAD), destination: reference(NEXT, 'other/project'), participants: [] }));
    await expect(runProviderSummary(config('bitbucket'), wrongTarget.fetcher, DATE)).rejects.toThrow('different destination repository');
    expect(wrongTarget.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('rejects a same-prefix commit change during acquisition and during the final pre-write recheck', async () => {
    const short = HEAD.slice(0, 12);
    const changed = 'a'.repeat(39) + 'c';
    for (const changeAt of [2, 3]) {
      let resolutions = 0;
      const t = transport((url) => {
        if (url.pathname === '/2.0/user') return json({ uuid: '{owner}' });
        if (url.pathname === root) return json({ id: 42, source: reference(short), destination: reference(NEXT), participants: [] });
        if (url.pathname === `/2.0/repositories/${repository}/commit/${short}`) return json({ hash: ++resolutions >= changeAt ? changed : HEAD });
        return json({ values: [] });
      });
      await expect(runProviderSummary(config('bitbucket'), t.fetcher, DATE)).rejects.toThrow('changed');
      expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
      expect(resolutions).toBe(changeAt);
    }
  });

  it('rechecks the base and source repository as well as the head immediately before writing', async () => {
    for (const change of ['base', 'fork']) {
      let prReads = 0;
      const t = transport((url) => {
        if (url.pathname === '/2.0/user') return json({ uuid: '{owner}' });
        if (url.pathname === root) {
          const changed = ++prReads >= 3;
          return json({
            id: 42, source: reference(HEAD, changed && change === 'fork' ? 'other-fork/project' : 'contributor/project'),
            destination: reference(changed && change === 'base' ? 'c'.repeat(40) : NEXT), participants: [],
          });
        }
        return json({ values: [] });
      });
      await expect(runProviderSummary(config('bitbucket'), t.fetcher, DATE)).rejects.toThrow('before the summary could be written');
      expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
      expect(prReads).toBe(3);
    }
  });
});

describe('native publication normalization coverage', () => {
  it('keeps REST GitLab diff state unknown when the API omits active/outdated facts', async () => {
    const root = '/api/v4/projects/group%2Fsubgroup%2Fproject/merge_requests/42';
    const t = transport((url) => {
      if (url.pathname === root) return json({ iid: 42, sha: HEAD });
      if (url.pathname === `${root}/discussions`) return json([{ id: '12345678', notes: [
        { id: 10, author: { id: 8, username: 'reviewer' }, body: 'This crashes.', created_at: DATE, updated_at: DATE, type: 'DiffNote', resolvable: true, resolved: false, position: { new_path: 'src/a.ts', new_line: 5, head_sha: HEAD } },
      ] }]);
      if (url.pathname === `${root}/approvals`) return json({ approved_by: [] });
      return json([]);
    });
    const review = await new GitLabCiAdapter(new ProviderHttp(config('gitlab'), t.fetcher)).load();
    expect(review.input.threads[0]).toMatchObject({ id: '12345678', anchor: 'discussion_12345678', stateKnown: false });
    expect(review.sourceCoverage).toEqual({ comments: 'complete', threads: 'partial' });
    expect(review.notes).toContain('Native resolution or outdated state is unavailable for some review discussions.');
    expect(t.requests.filter((request) => request.url.includes('/discussions'))).toHaveLength(1);
    expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it.each(['known', 'resolution', 'outdated'])('preserves Bitbucket %s thread-state evidence without assuming absent fields are false', async (missing) => {
    const root = '/2.0/repositories/workspace/project/pullrequests/42';
    const source = {
      id: 10, deleted: false, parent: null,
      user: { uuid: '{80000000-0000-4000-8000-000000000008}', nickname: 'reviewer' },
      content: { raw: 'This crashes.' }, created_on: DATE, updated_on: DATE,
      inline: missing === 'outdated' ? { path: 'src/a.ts', to: 5 } : { path: 'src/a.ts', to: 5, outdated: false },
      ...(missing === 'resolution' ? {} : { resolution: null }),
      links: { html: { href: 'https://bitbucket.org/workspace/project/pull-requests/42/_/diff#comment-10' } },
    };
    const t = transport((url) => {
      if (url.pathname === root) return json({ id: 42, source: { commit: { hash: HEAD } }, destination: { commit: { hash: NEXT } }, participants: [] });
      return json({ values: url.pathname === `${root}/comments` ? [source] : [] });
    });
    const review = await new BitbucketCiAdapter(new ProviderHttp(config('bitbucket'), t.fetcher)).load();
    expect(review.input.threads[0]?.stateKnown).toBe(missing === 'known');
    expect(review.sourceCoverage).toEqual({ comments: 'complete', threads: missing === 'known' ? 'complete' : 'partial' });
    const { buildProviderReviewItems, createNativePublication } = await import('@geld/review');
    const publication = await createNativePublication(review.input, buildProviderReviewItems(review.input));
    expect(publication.items).toHaveLength(missing === 'known' ? 1 : 0);
    expect(t.requests.filter((request) => request.url.includes('/comments'))).toHaveLength(1);
    expect(t.requests.every((request) => request.method === 'GET')).toBe(true);
  });
});
