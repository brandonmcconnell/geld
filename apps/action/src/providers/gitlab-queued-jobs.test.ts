import { expect, it } from 'vitest';
import { readProviderCiConfig } from './config';
import { runProviderSummary } from './summary';

const head = 'a'.repeat(40);
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const config = (provider: 'gitlab' | 'bitbucket') => readProviderCiConfig({ GELD_PROVIDER: provider, GELD_REPOSITORY: 'owner/repo', GELD_REVIEW_NUMBER: '42', GELD_TOKEN: 'fixture-token' });

it('preserves queued GitLab jobs as waiting in the published CI totals', async () => {
  let body = '';
  const states = ['created', 'pending', 'waiting_for_resource', 'preparing', 'scheduled', 'manual', 'running', 'success', 'failed'];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/user')) return json({ id: 7 });
    if (url.pathname.endsWith('/merge_requests/42')) return json({ iid: 42, project_id: 1, sha: head });
    if (url.pathname.endsWith('/approvals')) return json({ approved_by: [] });
    if (url.pathname.endsWith('/pipelines')) return json([{ id: 8, project_id: 1, sha: head }]);
    if (url.pathname.endsWith('/jobs')) return json(states.map((status, index) => ({ id: index + 1, name: status, status })));
    if (init?.method === 'POST') { body = String(init.body); return json({ id: 1 }, 201); }
    return json([]);
  };
  expect(await runProviderSummary(config('gitlab'), fetcher)).toBe('created');
  expect(body).toContain('CI checks: 1 passed, 1 failed, 1 running, 6 waiting, 0 other');
});
