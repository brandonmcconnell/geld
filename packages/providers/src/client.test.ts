import { describe, expect, it } from 'vitest';
import type { Provider } from '@geld/domain';
import { createApiTransport, createTokenSource } from '@geld/github';
import type { FetchLike, TokenSource } from '@geld/github';
import { createProviderClient } from './client';
import { bitbucket, github, gitlab } from './__fixtures__/pulls';

const source: TokenSource = { get: async () => ({ status: 'ok', token: crypto.randomUUID(), refreshed: false }) };
const fixtures = [{ provider: 'github', host: 'github.com', fixture: github, number: 2544 }, { provider: 'gitlab', host: 'gitlab.com', fixture: gitlab, number: 1 }, { provider: 'bitbucket', host: 'bitbucket.org', fixture: bitbucket, number: 1 }];
function providerOf(value: string): Provider {
  if (value === 'github' || value === 'gitlab' || value === 'bitbucket') return value;
  throw new Error('Unknown provider');
}
describe('provider contracts', () => {
  for (const item of fixtures) {
    it(`normalizes ${item.provider} details without trusting extra response fields`, async () => {
      const provider = providerOf(item.provider);
      const client = createProviderClient({ provider, source, fetch: async () => Response.json(item.fixture) });
      const result = await client.pull({ provider, host: item.host, owner: 'owner', repo: 'repo', number: item.number });
      expect(result).toMatchObject({ ok: true, value: { ref: { provider }, title: item.fixture.title } });
    });
  }
  it('returns the permission header as structured data without leaking provider bodies', async () => {
    const client = createProviderClient({ provider: 'github', source, fetch: async () => new Response('sensitive provider response', { status: 403, headers: { 'X-Accepted-GitHub-Permissions': 'pull_requests=write' } }) });
    expect(await client.review({ provider: 'github', host: 'github.com', owner: 'o', repo: 'r', number: 1 }, { event: 'approve', body: '', headSha: 'head' })).toEqual({ ok: false, reason: 'permission', required: 'pull_requests=write', url: null });
  });
  it('rejects malformed successful data and foreign host references', async () => {
    let calls = 0;
    const client = createProviderClient({ provider: 'github', source, fetch: async () => { calls += 1; return Response.json({}); } });
    expect(await client.pull({ provider: 'github', host: 'github.com', owner: 'o', repo: 'r', number: 1 })).toMatchObject({ ok: false, reason: 'invalid_response' });
    expect(await client.diff({ provider: 'github', host: 'elsewhere.example', owner: 'o', repo: 'r', number: 1 })).toMatchObject({ ok: false });
    expect(calls).toBe(2);
  });
  it('keeps direct provider write requests tied to the reviewed head', async () => {
    const bodies: unknown[] = [];
    const client = createProviderClient({ provider: 'github', source, fetch: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ id: 7 }); } });
    await client.review({ provider: 'github', host: 'github.com', owner: 'o', repo: 'r', number: 1 }, { event: 'request_changes', body: 'Please add a guard', headSha: 'reviewed-head' });
    expect(bodies).toEqual([{ event: 'REQUEST_CHANGES', body: 'Please add a guard', commit_id: 'reviewed-head' }]);
  });
});
describe('transport credential boundaries', () => {
  it('refreshes once after a 401', async () => {
    let token: string = crypto.randomUUID();
    let refreshes = 0;
    const tokens = createTokenSource({ store: { load: async () => ({ accessToken: token, refreshToken: crypto.randomUUID(), expiresAt: Date.now() + 600000, refreshTokenExpiresAt: null }), save: async (value) => { token = value.accessToken; } }, refresh: async () => { refreshes += 1; return { status: 'refreshed', tokens: { accessToken: crypto.randomUUID(), refreshToken: crypto.randomUUID(), expiresAt: Date.now() + 600000, refreshTokenExpiresAt: null } }; } });
    let calls = 0;
    const transport = createApiTransport({ baseUrl: 'https://api.github.com/', source: tokens, fetch: async () => ++calls === 1 ? new Response(null, { status: 401 }) : Response.json({ id: 1 }) });
    expect(await transport.request('user')).toEqual({ ok: true, value: { id: 1 } });
    expect(refreshes).toBe(1);
    expect(calls).toBe(2);
  });
  it('never forwards credentials outside its configured API or follows redirects', async () => {
    const requests: RequestInit[] = [];
    const f: FetchLike = async (_url, init) => { if (init) requests.push(init); return Response.json({}); };
    const transport = createApiTransport({ baseUrl: 'https://enterprise.example/api/v3/', source, fetch: f });
    expect(await transport.request('https://other.example/user')).toMatchObject({ ok: false });
    expect(await transport.request('../user')).toMatchObject({ ok: false });
    expect(requests).toHaveLength(0);
    await transport.request('user');
    expect(requests[0]?.redirect).toBe('error');
  });
  it('reports rate limits and suppresses exception text', async () => {
    const limited = createApiTransport({ baseUrl: 'https://api.github.com/', source, now: () => 1000, fetch: async () => new Response(null, { status: 429, headers: { 'retry-after': '5' } }) });
    expect(await limited.request('user')).toEqual({ ok: false, reason: 'rate_limit', retryAt: 6000 });
    const failed = createApiTransport({ baseUrl: 'https://api.github.com/', source, fetch: async () => { throw new Error('do not expose this'); } });
    expect(await failed.request('user')).toEqual({ ok: false, reason: 'unavailable' });
  });
});
