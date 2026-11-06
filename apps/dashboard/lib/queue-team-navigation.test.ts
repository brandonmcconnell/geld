import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryRef } from '@geld/domain';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
const state = vi.hoisted(() => {
  const reads: string[] = [];
  return { member: true, reads };
});
vi.mock('./session', () => ({
  currentActor: async () => ({ id: 'viewer', name: 'Viewer', email: 'viewer@example.test' }),
  providerTokenSource: vi.fn(),
}));
vi.mock('./workspaces', () => ({ teamMembership: async () => state.member }));
vi.mock('./request-audit', () => ({ auditedRoute: (handler: (request: Request) => Promise<Response>) => handler }));
vi.mock('./db', () => ({ database: () => ({ query: async () => ({ rows: repositories }) }) }));
vi.mock('./providers', () => ({
  providerClient: () => {
    throw new Error('Navigation must not request pull data');
  },
}));
vi.mock('./team-access', async (original) => ({
  ...(await original<typeof import('./team-access')>()),
  accessAdapter: async () => ({
    repository: async (ref: RepositoryRef) => {
      state.reads.push(ref.repo);
      return {
        ok: true,
        value: {
          id: ref.repo,
          ref,
          private: true,
          permission: ref.repo === 'repo-1' ? 'none' : 'read',
          url: `https://github.com/${ref.owner}/${ref.repo}`,
        },
      };
    },
  }),
}));
const repositories = Array.from({ length: 33 }, (_, index) => ({
  id: `repo-${index}`,
  team_id: 'team-1',
  provider: 'github',
  host: 'github.com',
  owner: 'acme',
  name: `repo-${index}`,
  external_id: String(index),
  approved: true,
  removed_at: null,
  settings: {},
}));
import { GET } from '../app/api/queue/route';
import { queueSchema } from './contracts';
beforeEach(() => {
  state.member = true;
  state.reads.length = 0;
});
describe('team repository navigation', () => {
  it('paginates repository metadata, excludes inaccessible repositories and makes no pull requests', async () => {
    const first = queueSchema.parse(
      await (await GET(new Request('https://dashboard.example/api/queue?team=team-1&repositoriesOnly=true'))).json(),
    );
    expect(first.pulls).toEqual([]);
    expect(first.repositories).toHaveLength(31);
    expect(first.repositories.some((repo) => repo.ref.repo === 'repo-1')).toBe(false);
    expect(first.nextCursor).toBe('2');
    expect(state.reads).toHaveLength(32);
    const next = queueSchema.parse(
      await (
        await GET(new Request('https://dashboard.example/api/queue?team=team-1&repositoriesOnly=true&cursor=2'))
      ).json(),
    );
    expect(next.repositories.map((repo) => repo.ref.repo)).toEqual(['repo-32']);
    expect(next.nextCursor).toBeNull();
    expect(next.pulls).toEqual([]);
  });
  it('refuses another team before checking its repositories', async () => {
    state.member = false;
    const response = await GET(new Request('https://dashboard.example/api/queue?team=team-1&repositoriesOnly=true'));
    expect(response.status).toBe(404);
    expect(state.reads).toHaveLength(0);
  });
});
