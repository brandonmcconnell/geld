import { describe, expect, it } from 'vitest';
import { relatedLinkOf, type RelatedLink } from '../related-links';
import { adfText, candidatesFor, contextText, hintsAfter, normalizeConnections, pruneCache, resolveLink, resolverFor, ttlFor, type Connection, type FetchLike } from './index';
import { base64 } from './http';

function linkOf(href: string, text = href): RelatedLink {
  const link = relatedLinkOf({ href, text }, { githubHosts: ['github.com', 'git.acme.dev'] });
  if (link === null) throw new Error(`not a related link: ${href}`);
  return link;
}

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function stub(answer: (url: string, init: RequestInit | undefined) => { status?: number; body?: unknown; headers?: Record<string, string> }): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = {}, headers = {} } = answer(url, init);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  };
  return { fetch, calls };
}

function connection(overrides: Partial<Connection> & Pick<Connection, 'id' | 'service'>): Connection {
  return { label: '', host: null, secret: 'secret', email: null, account: null, covers: [], use: { details: true, ai: false }, expiresAt: null, refresh: null, ...overrides };
}

const header = (call: Call | undefined, name: string): string | null => new Headers(call?.init?.headers).get(name);

describe('linear', () => {
  const resolver = resolverFor('linear');
  const link = linkOf('https://linear.app/acme/issue/ENG-12/fix-the-login-redirect');

  it('reads an issue by its key, with its state and team', async () => {
    const { fetch, calls } = stub(() => ({
      body: { data: { issue: { identifier: 'ENG-12', title: 'Fix the login redirect', description: 'It loops.', updatedAt: '2026-11-01T10:00:00.000Z', state: { name: 'In Progress', type: 'started' }, creator: { name: 'Ada' }, team: { name: 'Engineering' } } } },
    }));
    const result = await resolver?.resolve(link, connection({ id: 'l1', service: 'linear', secret: 'lin_api_abc' }), fetch);
    expect(result).toEqual({
      status: 'ok',
      details: { title: 'Fix the login redirect', state: 'In Progress', tone: 'open', author: 'Ada', updatedAt: '2026-11-01T10:00:00.000Z', where: 'ENG-12 · Engineering', body: 'It loops.', messages: [] },
    });
    expect(calls[0]?.url).toBe('https://api.linear.app/graphql');
    expect(header(calls[0], 'Authorization')).toBe('lin_api_abc');
    expect(JSON.parse(String(calls[0]?.init?.body)).variables).toEqual({ id: 'ENG-12' });
  });

  it('sends an OAuth token as a bearer token', async () => {
    const { fetch, calls } = stub(() => ({ body: { data: { issue: null } } }));
    await resolver?.resolve(link, connection({ id: 'l1', service: 'linear', secret: 'oauth-token' }), fetch);
    expect(header(calls[0], 'Authorization')).toBe('Bearer oauth-token');
  });

  it('reads a missing issue as no access and a refused key as unauthorized', async () => {
    const missing = stub(() => ({ status: 400, body: { errors: [{ message: 'Entity not found: Issue', extensions: { code: 'INVALID_INPUT' } }] } }));
    expect(await resolver?.resolve(link, connection({ id: 'l1', service: 'linear' }), missing.fetch)).toEqual({ status: 'no-access' });
    const refused = stub(() => ({ status: 400, body: { errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] } }));
    expect(await resolver?.resolve(link, connection({ id: 'l1', service: 'linear' }), refused.fetch)).toMatchObject({ status: 'failed', reason: 'unauthorized' });
  });

  it('learns the workspace a key opens', async () => {
    const { fetch } = stub(() => ({ body: { data: { viewer: { name: 'Ada', email: 'ada@acme.dev', organization: { name: 'Acme', urlKey: 'Acme' } } } } }));
    expect(await resolver?.identify({ service: 'linear', label: '', host: null, secret: 'lin_api_abc', email: null }, fetch)).toEqual({
      ok: true,
      identity: { account: 'ada@acme.dev', covers: ['acme'], suggestedLabel: 'Acme', host: null },
    });
  });

  it('reads a project by the id at the end of its slug', async () => {
    const { fetch, calls } = stub(() => ({ body: { data: { project: { name: 'Billing v2', description: null, updatedAt: null, state: 'started', creator: null } } } }));
    const project = linkOf('https://linear.app/acme/project/billing-v2-0123456789ab/overview');
    expect(await resolver?.resolve(project, connection({ id: 'l1', service: 'linear' }), fetch)).toMatchObject({ status: 'ok', details: { title: 'Billing v2', state: 'Started', tone: 'open' } });
    expect(JSON.parse(String(calls[0]?.init?.body)).variables).toEqual({ id: '0123456789ab' });
  });
});

describe('jira', () => {
  const resolver = resolverFor('jira');
  const link = linkOf('https://acme.atlassian.net/browse/OPS-7');

  it('reads a Cloud issue with an email and token, its description from Atlassian Document Format', async () => {
    const { fetch, calls } = stub(() => ({
      body: {
        fields: {
          summary: 'Rotate the signing key',
          status: { name: 'Done', statusCategory: { key: 'done' } },
          reporter: { displayName: 'Grace' },
          updated: '2026-10-30T09:00:00.000+0000',
          project: { name: 'Operations' },
          description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before ' }, { type: 'mention', attrs: { text: '@Ada' } }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Friday.' }] }] },
        },
      },
    }));
    const result = await resolver?.resolve(link, connection({ id: 'j1', service: 'jira', host: 'acme.atlassian.net', email: 'ada@acme.dev', secret: 'tok' }), fetch);
    expect(result).toMatchObject({ status: 'ok', details: { title: 'Rotate the signing key', state: 'Done', tone: 'done', author: 'Grace', where: 'OPS-7 · Operations', body: 'Before @Ada\nFriday.' } });
    expect(calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/issue/OPS-7?fields=summary,status,reporter,updated,description,project');
    expect(header(calls[0], 'Authorization')).toBe(`Basic ${base64('ada@acme.dev:tok')}`);
  });

  it('uses a personal access token and API 2 on a self-hosted Jira', async () => {
    const { fetch, calls } = stub(() => ({ status: 404 }));
    const selfHosted = linkOf('https://jira.acme.dev/browse/OPS-7');
    expect(await resolver?.resolve(selfHosted, connection({ id: 'j2', service: 'jira', host: 'jira.acme.dev' }), fetch)).toEqual({ status: 'no-access' });
    expect(calls[0]?.url).toMatch(/^https:\/\/jira\.acme\.dev\/rest\/api\/2\/issue\/OPS-7/);
    expect(header(calls[0], 'Authorization')).toBe('Bearer secret');
  });

  it('asks for the email Jira Cloud tokens need, and keeps the site it was given', async () => {
    const { fetch } = stub(() => ({ body: { emailAddress: 'ada@acme.dev', displayName: 'Ada' } }));
    expect(await resolver?.identify({ service: 'jira', label: '', host: 'https://Acme.atlassian.net/jira', secret: 'tok', email: null }, fetch)).toMatchObject({ ok: false });
    expect(await resolver?.identify({ service: 'jira', label: '', host: 'https://Acme.atlassian.net/jira', secret: 'tok', email: 'ada@acme.dev' }, fetch)).toEqual({
      ok: true,
      identity: { account: 'ada@acme.dev', covers: ['acme.atlassian.net'], suggestedLabel: 'acme', host: 'acme.atlassian.net' },
    });
  });

  it('reads nested blocks as lines', () => {
    expect(adfText({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] }] })).toBe('one\n\n');
  });
});

describe('github', () => {
  const resolver = resolverFor('github');

  it('reads a merged pull request', async () => {
    const { fetch, calls } = stub(() => ({ body: { title: 'Add caching', state: 'closed', user: { login: 'ada' }, updated_at: '2026-11-02T00:00:00Z', body: 'Caches it.', pull_request: { url: 'x', merged_at: '2026-11-02T00:00:00Z' } } }));
    const result = await resolver?.resolve(linkOf('https://github.com/acme/web/pull/42'), connection({ id: 'g1', service: 'github', secret: 'ghp_x' }), fetch);
    expect(result).toMatchObject({ status: 'ok', details: { title: 'Add caching', state: 'Merged', tone: 'done', author: 'ada', where: 'acme/web#42' } });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/web/issues/42');
    expect(header(calls[0], 'Authorization')).toBe('Bearer ghp_x');
  });

  it('reads an issue closed as not planned, and an Enterprise host through its own API', async () => {
    const { fetch, calls } = stub(() => ({ body: { title: 'Old idea', state: 'closed', state_reason: 'not_planned', user: { login: 'ada' } } }));
    const result = await resolver?.resolve(linkOf('https://git.acme.dev/acme/web/issues/3'), connection({ id: 'g2', service: 'github', host: 'git.acme.dev' }), fetch);
    expect(result).toMatchObject({ status: 'ok', details: { state: 'Closed as not planned', tone: 'closed' } });
    expect(calls[0]?.url).toBe('https://git.acme.dev/api/v3/repos/acme/web/issues/3');
  });

  it('leaves a link on another host to a connection for that host', async () => {
    const { fetch, calls } = stub(() => ({}));
    expect(await resolver?.resolve(linkOf('https://github.com/acme/web/issues/3'), connection({ id: 'g2', service: 'github', host: 'git.acme.dev' }), fetch)).toEqual({ status: 'unsupported' });
    expect(calls).toHaveLength(0);
  });

  it('reads a discussion through GraphQL', async () => {
    const { fetch, calls } = stub(() => ({ body: { data: { repository: { discussion: { title: 'RFC: plugins', body: 'Thoughts?', updatedAt: null, closed: false, answerChosenAt: null, author: { login: 'grace' }, category: { name: 'Ideas' } } } } } }));
    const result = await resolver?.resolve(linkOf('https://github.com/acme/web/discussions/9'), connection({ id: 'g1', service: 'github' }), fetch);
    expect(result).toMatchObject({ status: 'ok', details: { title: 'RFC: plugins', where: 'acme/web · Ideas', author: 'grace' } });
    expect(calls[0]?.url).toBe('https://api.github.com/graphql');
  });

  it('reports the rate limit with when it resets', async () => {
    const reset = Math.ceil(Date.now() / 1000) + 30;
    const { fetch } = stub(() => ({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }));
    const result = await resolver?.resolve(linkOf('https://github.com/acme/web/issues/3'), connection({ id: 'g1', service: 'github' }), fetch);
    expect(result).toMatchObject({ status: 'failed', reason: 'rate-limited' });
    expect(result?.status === 'failed' ? result.retryAfterMs : null).toBeGreaterThan(20_000);
  });
});

describe('gitlab', () => {
  const resolver = resolverFor('gitlab');

  it('reads a merge request on a self-hosted GitLab by its project path', async () => {
    const { fetch, calls } = stub(() => ({ body: { title: 'Speed up CI', state: 'opened', draft: true, author: { username: 'ada' }, updated_at: null, description: null, references: { full: 'platform/api!17' } } }));
    const result = await resolver?.resolve(linkOf('https://gitlab.acme.dev/platform/api/-/merge_requests/17'), connection({ id: 'gl', service: 'gitlab', host: 'gitlab.acme.dev', secret: 'glpat' }), fetch);
    expect(result).toMatchObject({ status: 'ok', details: { title: 'Speed up CI', state: 'Draft', tone: 'draft', where: 'platform/api!17' } });
    expect(calls[0]?.url).toBe('https://gitlab.acme.dev/api/v4/projects/platform%2Fapi/merge_requests/17');
    expect(header(calls[0], 'PRIVATE-TOKEN')).toBe('glpat');
  });

  it('reads a work item as an issue', async () => {
    const { fetch, calls } = stub(() => ({ body: { title: 'Bug', state: 'closed' } }));
    await resolver?.resolve(linkOf('https://gitlab.com/acme/web/-/work_items/5'), connection({ id: 'gl', service: 'gitlab' }), fetch);
    expect(calls[0]?.url).toBe('https://gitlab.com/api/v4/projects/acme%2Fweb/issues/5');
  });
});

describe('bitbucket', () => {
  const resolver = resolverFor('bitbucket');

  it('reads a pull request with an Atlassian API token and email', async () => {
    const { fetch, calls } = stub(() => ({ body: { title: 'Bump deps', state: 'DECLINED', author: { display_name: 'Ada' }, updated_on: null, description: 'Not now.' } }));
    const result = await resolver?.resolve(linkOf('https://bitbucket.org/acme/web/pull-requests/8'), connection({ id: 'b1', service: 'bitbucket', email: 'ada@acme.dev', secret: 'tok' }), fetch);
    expect(result).toMatchObject({ status: 'ok', details: { title: 'Bump deps', state: 'Declined', tone: 'closed', author: 'Ada', body: 'Not now.' } });
    expect(calls[0]?.url).toBe('https://api.bitbucket.org/2.0/repositories/acme/web/pullrequests/8');
    expect(header(calls[0], 'Authorization')).toBe(`Basic ${base64('ada@acme.dev:tok')}`);
  });

  it('reads an issue’s content', async () => {
    const { fetch } = stub(() => ({ body: { title: 'Crash on save', state: 'resolved', reporter: { display_name: 'Grace' }, content: { raw: 'Steps…' } } }));
    expect(await resolver?.resolve(linkOf('https://bitbucket.org/acme/web/issues/2'), connection({ id: 'b1', service: 'bitbucket' }), fetch)).toMatchObject({
      status: 'ok',
      details: { state: 'Resolved', tone: 'done', author: 'Grace', body: 'Steps…' },
    });
  });
});

describe('choosing connections', () => {
  const link = linkOf('https://linear.app/acme/issue/ENG-12');

  it('asks only the accounts for the link’s workspace, then those that do not say', () => {
    const connections = [
      connection({ id: 'other', service: 'linear', covers: ['globex'] }),
      connection({ id: 'unknown', service: 'linear' }),
      connection({ id: 'acme', service: 'linear', covers: ['acme'] }),
      connection({ id: 'off', service: 'linear', covers: ['acme'], use: { details: false, ai: false } }),
      connection({ id: 'jira', service: 'jira' }),
    ];
    expect(candidatesFor(link, connections).map((candidate) => candidate.id)).toEqual(['acme', 'unknown']);
  });

  it('tries the GitHub account that last opened the repository first', () => {
    const repo = linkOf('https://github.com/acme/web/issues/3');
    const connections = [connection({ id: 'personal', service: 'github', covers: ['github.com'] }), connection({ id: 'work', service: 'github', covers: ['github.com'] })];
    expect(candidatesFor(repo, connections).map((candidate) => candidate.id)).toEqual(['personal', 'work']);
    const hints = hintsAfter(repo, 'work', {});
    expect(hints).toEqual({ 'github/github.com/acme/web': 'work', 'github/github.com/acme': 'work' });
    expect(candidatesFor(linkOf('https://github.com/acme/api/pull/1'), connections, hints).map((candidate) => candidate.id)).toEqual(['work', 'personal']);
  });

  it('moves on to the next account when one cannot open the link', async () => {
    const repo = linkOf('https://github.com/acme/web/issues/3');
    const { fetch } = stub((_url, init) => (new Headers(init?.headers).get('Authorization') === 'Bearer work' ? { body: { title: 'Found', state: 'open' } } : { status: 404 }));
    const answer = await resolveLink(repo, [connection({ id: 'personal', service: 'github', secret: 'personal' }), connection({ id: 'work', service: 'github', secret: 'work' })], fetch);
    expect(answer).toMatchObject({ connectionId: 'work', resolution: { status: 'ok', details: { title: 'Found' } } });
  });

  it('reports a failure only when no account opened it', async () => {
    const repo = linkOf('https://github.com/acme/web/issues/3');
    const { fetch } = stub((_url, init) => (new Headers(init?.headers).get('Authorization') === 'Bearer bad' ? { status: 401 } : { status: 404 }));
    const answer = await resolveLink(repo, [connection({ id: 'ok', service: 'github' }), connection({ id: 'bad', service: 'github', secret: 'bad' })], fetch);
    expect(answer).toMatchObject({ connectionId: 'bad', resolution: { status: 'failed', reason: 'unauthorized' } });
  });

  it('turns a network error into a failure', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await resolveLink(link, [connection({ id: 'a', service: 'linear' })], fetch)).toMatchObject({ resolution: { status: 'failed', reason: 'unavailable', message: 'Failed to fetch' } });
  });
});

describe('storage and cache', () => {
  it('drops malformed connections and keeps AI context off unless it was turned on', () => {
    expect(normalizeConnections([{ id: 'a', service: 'linear', secret: 's', use: {} }, { id: 'b', service: 'myspace', secret: 's' }, 'nope'])).toEqual([
      { id: 'a', service: 'linear', label: '', host: null, secret: 's', email: null, account: null, covers: [], use: { details: true, ai: false }, expiresAt: null, refresh: null },
    ]);
  });

  it('keeps an answer for as long as it means something', () => {
    const ok = { resolution: { status: 'ok' as const, details: { title: 't', state: null, tone: null, author: null, updatedAt: null, where: null, body: null, messages: [] } }, connectionId: 'a' };
    expect(ttlFor(ok, 'linear')).toBe(6 * 3600_000);
    expect(ttlFor(ok, 'slack')).toBe(24 * 3600_000);
    expect(ttlFor({ resolution: { status: 'no-access' }, connectionId: 'a' }, 'linear')).toBe(3600_000);
    expect(ttlFor({ resolution: { status: 'failed', reason: 'rate-limited', retryAfterMs: 1234, message: null }, connectionId: 'a' }, 'linear')).toBe(1234);
    const cache = { a: { at: 1, answer: ok }, b: { at: 3, answer: ok }, c: { at: 2, answer: ok } };
    expect(Object.keys(pruneCache(cache, 2))).toEqual(['b', 'c']);
  });

  it('writes a linked thread for a prompt, capped', () => {
    const link = linkOf('https://acme.slack.com/archives/C0123456789/p1793123214352139');
    const details = { title: 'Login loops', state: null, tone: null, author: 'ada', updatedAt: null, where: '#eng', body: null, messages: [{ author: 'ada', at: null, text: 'Login loops' }, { author: 'grace', at: null, text: 'Fixed in #42' }] };
    expect(contextText(link, details)).toBe('Slack message: Login loops\nWhere: #eng\n\nada: Login loops\ngrace: Fixed in #42');
    expect(contextText(link, details, 20)).toHaveLength(20);
  });
});
