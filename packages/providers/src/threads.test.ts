import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createProviderClient } from './client';
describe('review thread writes', () => {
  it('checks a thread belongs to the requested pull before resolving it', async () => {
    const requests: unknown[] = [];
    const client = createProviderClient({
      provider: 'github',
      source: {
        get: async () => ({
          status: 'ok',
          token: crypto.randomUUID(),
          refreshed: false,
        }),
      },
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({
          data: {
            repository: { pullRequest: { reviewThreads: { nodes: [] } } },
          },
        });
      },
    });
    expect(
      await client.resolve(
        {
          provider: 'github',
          host: 'github.com',
          owner: 'o',
          repo: 'r',
          number: 1,
        },
        'foreign-thread',
        true,
      ),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(requests).toHaveLength(1);
  });
  it('preserves a review summary when approving a GitLab merge request', async () => {
    const requests: { path: string; body: unknown }[] = [];
    const client = createProviderClient({
      provider: 'gitlab',
      source: {
        get: async () => ({
          status: 'ok',
          token: crypto.randomUUID(),
          refreshed: false,
        }),
      },
      fetch: async (url, init) => {
        requests.push({
          path: new URL(url).pathname,
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ id: 1 });
      },
    });
    await client.review(
      {
        provider: 'gitlab',
        host: 'gitlab.com',
        owner: 'o',
        repo: 'r',
        number: 1,
      },
      { event: 'approve', body: 'Reviewed the retry path.', headSha: 'head' },
    );
    expect(requests.map((request) => request.body)).toEqual([{ sha: 'head' }, { body: 'Reviewed the retry path.' }]);
  });
});

it('loads later GitHub threads and nested comment pages before exposing resolution targets', async () => {
  const seen: unknown[] = [];
  const thread = (id: string, next = false) => ({
    id,
    path: 'src/file.ts',
    line: 1,
    isResolved: false,
    isOutdated: false,
    comments: {
      nodes: [
        {
          id: `comment-${id}`,
          databaseId: id === 'one' ? 1 : 3,
          createdAt: '2026-11-01T00:00:00Z',
          body: 'Finding',
          url: 'https://github.com/o/r/pull/1',
          author: { login: 'cursor[bot]' },
        },
      ],
      pageInfo: { hasNextPage: next, endCursor: next ? 'more-comments' : null },
    },
  });
  const client = createProviderClient({
    provider: 'github',
    source: {
      get: async () => ({
        status: 'ok',
        token: 'synthetic-token',
        refreshed: false,
      }),
    },
    fetch: async (_url, init) => {
      const value: unknown = JSON.parse(String(init?.body));
      seen.push(value);
      const input = z
        .object({
          variables: z.object({
            id: z.string().optional(),
            after: z.string().nullable().optional(),
          }),
        })
        .parse(value);
      if (input.variables.id)
        return Response.json({
          data: {
            node: {
              comments: {
                nodes: [
                  {
                    id: 'reply',
                    databaseId: 2,
                    createdAt: '2026-11-01T00:01:00Z',
                    body: 'Reply',
                    url: 'https://github.com/o/r/pull/1',
                    author: { login: 'human' },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      return Response.json({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [thread(input.variables.after ? 'two' : 'one', !input.variables.after)],
                pageInfo: {
                  hasNextPage: !input.variables.after,
                  endCursor: input.variables.after ? null : 'next-threads',
                },
              },
            },
          },
        },
      });
    },
  });
  const result = await client.threads({
    provider: 'github',
    host: 'github.com',
    owner: 'o',
    repo: 'r',
    number: 1,
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.map((t) => t.id)).toEqual(['one', 'two']);
    expect(result.value[0]?.comments.map((c) => c.databaseId)).toEqual([1, 2]);
  }
  expect(seen).toHaveLength(3);
});
