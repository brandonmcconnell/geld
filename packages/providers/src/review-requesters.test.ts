import { describe, expect, it } from 'vitest';
import { createProviderClient } from './client';
const ref = {
  provider: 'github',
  host: 'github.com',
  owner: 'acme',
  repo: 'platform',
  number: 128,
} satisfies Parameters<ReturnType<typeof createProviderClient>['pull']>[0];
const source = {
  get: async () =>
    ({ status: 'ok', token: 'synthetic', refreshed: false }) satisfies Awaited<
      ReturnType<import('@geld/github').TokenSource['get']>
    >,
};
describe('review request authors', () => {
  it('keeps the latest requester and removes cancelled requests across timeline pages', async () => {
    const calls: string[] = [];
    const client = createProviderClient({
      provider: 'github',
      source,
      fetch: async (url) => {
        calls.push(url);
        const events = url.endsWith('page=1')
          ? [
              { event: 'review_requested', actor: { login: 'alex' }, requested_reviewer: { login: 'sam' } },
              ...Array.from({ length: 99 }, () => ({ event: 'committed' })),
            ]
          : [
              { event: 'review_request_removed', actor: { login: 'alex' }, requested_reviewer: { login: 'sam' } },
              { event: 'review_requested', actor: { login: 'morgan' }, requested_reviewer: { login: 'sam' } },
              { event: 'review_requested', actor: { login: 'alex' }, requested_reviewer: { login: 'lee' } },
              { event: 'review_request_removed', actor: { login: 'alex' }, requested_reviewer: { login: 'lee' } },
            ];
        return Response.json(events);
      },
    });
    expect(await client.reviewRequesters?.(ref)).toEqual({
      ok: true,
      value: [{ reviewer: 'sam', requester: 'morgan' }],
    });
    expect(calls).toHaveLength(2);
    expect(
      calls.every((url) => url.startsWith('https://api.github.com/repos/acme/platform/issues/128/timeline?')),
    ).toBe(true);
  });
  it('does not infer no outgoing requests from incomplete or unsupported history', async () => {
    let calls = 0;
    const client = createProviderClient({
      provider: 'github',
      source,
      fetch: async () => {
        calls++;
        return Response.json(Array.from({ length: 100 }, () => ({ event: 'committed' })));
      },
    });
    expect(await client.reviewRequesters?.(ref)).toEqual({ ok: false, reason: 'unavailable' });
    expect(calls).toBe(5);
    const gitlab = createProviderClient({
      provider: 'gitlab',
      source,
      fetch: async () => {
        throw new Error('Unexpected read');
      },
    });
    expect(await gitlab.reviewRequesters?.({ ...ref, provider: 'gitlab', host: 'gitlab.com' })).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(await client.reviewRequesters?.({ ...ref, host: 'foreign.example' })).toEqual({
      ok: false,
      reason: 'invalid_response',
    });
  });
});
