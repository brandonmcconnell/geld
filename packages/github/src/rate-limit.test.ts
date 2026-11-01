import { expect, it } from 'vitest';
import { createApiTransport } from './client';

it('preserves secondary rate-limit retry timing when primary quota remains', async () => {
  const api = createApiTransport({
    baseUrl: 'https://api.github.com/',
    source: { get: async () => ({ status: 'signed-out', reason: 'fixture' }) },
    anonymousReads: true,
    now: () => 1000,
    fetch: async () => new Response(null, { status: 403, headers: { 'retry-after': '12', 'x-ratelimit-remaining': '42' } }),
  });
  expect(await api.request('repos/org/repo')).toEqual({ ok: false, reason: 'rate_limit', retryAt: 13000 });
});
