import { describe, expect, it } from 'vitest';
import { createProviderClient } from './client';
describe('review thread writes', () => {
  it('checks a thread belongs to the requested pull before resolving it', async () => {
    const requests: unknown[] = [];
    const client = createProviderClient({ provider: 'github', source: { get: async () => ({ status: 'ok', token: crypto.randomUUID(), refreshed: false }) }, fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }); } });
    expect(await client.resolve({ provider: 'github', host: 'github.com', owner: 'o', repo: 'r', number: 1 }, 'foreign-thread', true)).toEqual({ ok: false, reason: 'not_found' });
    expect(requests).toHaveLength(1);
  });
  it('preserves a review summary when approving a GitLab merge request', async () => {
    const requests: { path: string; body: unknown }[] = [];
    const client = createProviderClient({ provider: 'gitlab', source: { get: async () => ({ status: 'ok', token: crypto.randomUUID(), refreshed: false }) }, fetch: async (url, init) => { requests.push({ path: new URL(url).pathname, body: JSON.parse(String(init?.body)) }); return Response.json({ id: 1 }); } });
    await client.review({ provider: 'gitlab', host: 'gitlab.com', owner: 'o', repo: 'r', number: 1 }, { event: 'approve', body: 'Reviewed the retry path.', headSha: 'head' });
    expect(requests.map((request) => request.body)).toEqual([{ sha: 'head' }, { body: 'Reviewed the retry path.' }]);
  });
});
