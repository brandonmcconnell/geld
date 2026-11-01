import { describe, expect, it } from 'vitest';
import { parseSummaryBody, SUMMARY_MARKER } from '@geld/review';
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
      id: '12345678', anchor: 'note_10', url: 'https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_10', resolved: false, outdated: false,
      comments: [{ id: '10', anchor: 'note_10', url: 'https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_10', author: { id: '8', login: 'reviewer' }, body: 'This crashes on empty input.', createdAt: DATE }],
    }],
  };
}

describe('provider summary ownership and determinism', () => {
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
    expect(findOwnedSummary([{ id: '1', authorId: 'attacker', body: SUMMARY_MARKER }, { id: '2', authorId: 'owner', body: SUMMARY_MARKER }], 'owner')?.id).toBe('2');
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
    expect(meta.value.items[0]?.sources[0]).toMatchObject({ provider: 'gitlab', authorId: '8', anchor: 'note_10' });
    expect(saved).toContain('https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_10');
    expect(await produceProviderSummary(adapter, '2026-11-02T10:00:00Z')).toBe('unchanged');
    expect(writes).toBe(1);
  });

  it('leaves an existing summary untouched when the head changes before writing', async () => {
    let writes = 0;
    const adapter: ProviderCiAdapter = { identity: async () => '7', head: async () => NEXT, load: async () => ({ input: input(), notes: [], comments: [] }), upsert: async () => { writes += 1; } };
    await expect(produceProviderSummary(adapter, DATE)).rejects.toThrow('head changed');
    expect(writes).toBe(0);
  });
});

describe('GitLab authenticated protocol fixture', () => {
  it('reads the entire review and updates only a freshly verified owned note', async () => {
    const project = '/api/v4/projects/group%2Fsubgroup%2Fproject';
    const mr = `${project}/merge_requests/42`;
    const user = { id: 8, username: 'reviewer' };
    const owned = { id: 901, author: { id: 7, username: 'geld' }, body: `${SUMMARY_MARKER}\nOld body` };
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
