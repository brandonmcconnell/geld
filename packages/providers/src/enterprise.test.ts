import { describe, expect, it } from 'vitest';
import { createProviderClient } from './client';
import { providerAction } from './actions';
const source = {
  get: async () =>
    ({
      status: 'ok',
      token: 'instance-only-test',
      refreshed: false,
    }) satisfies {
      status: 'ok';
      token: string;
      refreshed: boolean;
    },
};
describe('Enterprise host isolation', () => {
  it.each([
    {
      host: 'github.example.com',
      url: 'https://github.example.com/api/graphql',
    },
    { host: 'acme.ghe.com', url: 'https://api.acme.ghe.com/graphql' },
  ])('uses the correct GraphQL API for $host', async ({ host, url }) => {
    const seen: string[] = [];
    const client = createProviderClient({
      provider: 'github',
      host,
      source,
      fetch: async (target) => {
        seen.push(target);
        return Response.json({
          data: {
            repository: { pullRequest: { reviewThreads: { nodes: [] } } },
          },
        });
      },
    });
    expect(
      await client.threads({
        provider: 'github',
        host,
        owner: 'org',
        repo: 'repo',
        number: 1,
      }),
    ).toEqual({
      ok: true,
      value: [],
    });
    expect(seen).toEqual([url]);
  });
  it('keeps provider actions on the instance API', async () => {
    const seen: string[] = [];
    expect(
      await providerAction(
        {
          provider: 'github',
          source,
          fetch: async (target) => {
            seen.push(target);
            return Response.json({ merged: true });
          },
        },
        {
          provider: 'github',
          host: 'github.example.com',
          owner: 'org',
          repo: 'repo',
          number: 1,
        },
        { kind: 'merge', headSha: 'current', method: 'squash' },
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(seen).toEqual(['https://github.example.com/api/v3/repos/org/repo/pulls/1/merge']);
  });
});
