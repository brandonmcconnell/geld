import { describe, expect, it, vi } from 'vitest';
import type { PullSummary, RepositorySummary } from '@geld/domain';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('./db', () => ({ database: () => null }));
vi.mock('./session', () => ({
  currentActor: async () => ({
    id: 'reviewer',
    name: 'Reviewer',
    email: 'reviewer@example.test',
  }),
  providerTokenSource: async () => ({
    get: async () => ({ status: 'ok', token: 'synthetic', refreshed: false }),
  }),
}));
const calls = vi.hoisted(() => {
  const values: { repo: string; page: string }[] = [];
  return values;
});
vi.mock('@geld/providers', async (original) => ({
  ...(await original<typeof import('@geld/providers')>()),
  createProviderClient: ({ provider }: { provider: 'github' | 'gitlab' | 'bitbucket' }) => ({
    provider,
    repositories: async () => ({
      ok: true,
      value: { items: provider === 'github' ? repositories : [], cursor: null },
    }),
    pulls: async (ref: RepositorySummary['ref'], page: string) => {
      calls.push({ repo: ref.repo, page });
      return {
        ok: true,
        value: {
          items:
            ref.repo === 'repo-0' ? [pull(page === '1' ? 1 : 2, ref)] : ref.repo === 'repo-8' ? [pull(3, ref)] : [],
          cursor: ref.repo === 'repo-0' && page === '1' ? '2' : null,
        },
      };
    },
  }),
}));
const repositories: RepositorySummary[] = Array.from({ length: 9 }, (_value, index) => ({
  id: String(index),
  ref: {
    provider: 'github',
    host: 'github.com',
    owner: 'org',
    repo: `repo-${index}`,
  },
  private: false,
  permission: 'read',
  url: `https://github.com/org/repo-${index}`,
}));
function pull(number: number, ref: RepositorySummary['ref']): PullSummary {
  return {
    ref: { ...ref, number },
    id: String(number),
    title: `Pull ${number}`,
    author: 'reviewer',
    authorAvatar: null,
    state: 'open',
    draft: false,
    updatedAt: '2026-11-01T00:00:00Z',
    url: `https://github.com/org/${ref.repo}/pull/${number}`,
    headSha: 'head',
    baseSha: 'base',
    additions: 1,
    deletions: 0,
    labels: [],
    reviewers: [],
  };
}
import { GET } from '../app/api/queue/route';
import { queueSchema } from './contracts';
describe('queue pagination through the route', () => {
  it('reads a busy repository’s later PR page before advancing the batch, while repository selection performs no PR reads', async () => {
    vi.stubEnv('GELD_DEMO_MODE', 'false');
    const request = (cursor: string) =>
      new Request(`https://dashboard.example/api/queue?${new URLSearchParams({ cursor })}`);
    const first = queueSchema.parse(await (await GET(request('1'))).json());
    expect(first.pulls.map((p) => p.ref.number)).toEqual([1]);
    if (!first.nextCursor) throw new Error('Missing next PR page');
    const second = queueSchema.parse(await (await GET(request(first.nextCursor))).json());
    expect(second.pulls.map((p) => p.ref.number)).toEqual([2]);
    if (!second.nextCursor) throw new Error('Missing repository batch');
    const third = queueSchema.parse(await (await GET(request(second.nextCursor))).json());
    expect(third.pulls.map((p) => p.ref.number)).toEqual([3]);
    expect(third.nextCursor).toBeNull();
    expect(calls.filter((call) => call.repo === 'repo-0').map((call) => call.page)).toEqual(['1', '2']);
    expect(calls.filter((call) => call.repo === 'repo-8').map((call) => call.page)).toEqual(['1']);
    calls.length = 0;
    const chooser = queueSchema.parse(
      await (await GET(new Request('https://dashboard.example/api/queue?repositoriesOnly=true'))).json(),
    );
    expect(chooser.repositories).toHaveLength(9);
    expect(chooser.pulls).toEqual([]);
    expect(calls).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});
