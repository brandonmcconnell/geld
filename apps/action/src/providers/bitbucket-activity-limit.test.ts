import { expect, it } from 'vitest';
import { readProviderCiConfig } from './config';
import { runProviderSummary } from './summary';

const head = 'a'.repeat(40);
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const config = (provider: 'gitlab' | 'bitbucket') => readProviderCiConfig({ GELD_PROVIDER: provider, GELD_REPOSITORY: 'owner/repo', GELD_REVIEW_NUMBER: '42', GELD_TOKEN: 'fixture-token' });

it('uses the activity-specific Bitbucket page limit throughout a full summary run', async () => {
  let body = '';
  const pages: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/user')) return json({ uuid: '{owner}' });
    if (url.pathname.endsWith('/pullrequests/42')) return json({ id: 42, source: { commit: { hash: head } }, destination: { commit: { hash: 'b'.repeat(40) } }, participants: [] });
    if (init?.method === 'POST') { body = String(init.body); return json({ id: 1 }, 201); }
    if (url.pathname.endsWith('/activity')) {
      pages.push(url.searchParams.get('page') ?? '1');
      if (url.searchParams.get('pagelen') !== '50') return json({ error: 'Invalid pagelen' }, 400);
      return json({ values: [], ...(pages.length === 1 ? { next: `${url.origin}${url.pathname}?pagelen=50&page=2` } : {}) });
    }
    expect(url.searchParams.get('pagelen')).toBe('100');
    return json({ values: [] });
  };
  expect(await runProviderSummary(config('bitbucket'), fetcher)).toBe('created');
  expect(pages).toEqual(['1', '2']);
  expect(body).toContain('Geld review summary');
});

