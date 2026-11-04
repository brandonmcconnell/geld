import { describe, expect, it } from 'vitest';
import { createProviderClient } from '@geld/providers';
import { submitProviderReview } from './review-write';
const ref = {
  provider: 'github',
  host: 'github.com',
  owner: 'org',
  repo: 'repo',
  number: 1,
};
const payload = {
  id: 1,
  number: 1,
  title: 'A change',
  body: '',
  user: { login: 'author' },
  state: 'open',
  updated_at: '2026-11-01T00:00:00Z',
  html_url: 'https://github.com/org/repo/pull/1',
  head: { sha: 'current' },
  base: { sha: 'base' },
};
describe('review submission safety', () => {
  it('does not submit a review after a push or on the author’s own PR', async () => {
    const requests: string[] = [];
    const client = createProviderClient({
      provider: 'github',
      source: {
        get: async () => ({
          status: 'ok',
          token: crypto.randomUUID(),
          refreshed: false,
        }),
      },
      fetch: async (url, init) => {
        requests.push(init?.method ?? 'GET');
        return Response.json(
          url.endsWith('/pulls/1')
            ? payload
            : {
                id: 1,
                name: 'repo',
                owner: { login: 'org' },
                private: false,
                html_url: 'https://github.com/org/repo',
                permissions: { push: true },
              },
        );
      },
    });
    expect(
      await submitProviderReview({
        client,
        ref: { ...ref, provider: 'github' },
        review: { event: 'approve', body: '', headSha: 'old' },
        viewer: 'reviewer',
      }),
    ).toEqual({ ok: false, reason: 'stale' });
    expect(
      await submitProviderReview({
        client,
        ref: { ...ref, provider: 'github' },
        review: { event: 'approve', body: '', headSha: 'current' },
        viewer: 'author',
      }),
    ).toEqual({ ok: false, reason: 'own_review' });
    expect(requests.every((method) => method === 'GET')).toBe(true);
  });
});
