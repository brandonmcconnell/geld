import { describe, expect, it } from 'vitest';
import { createProviderClient } from './client';
import type { Provider, PullRef } from '@geld/domain';
const sha = 'a'.repeat(40);
const hosts = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' };
function setup(provider: Provider, answer: (url: string) => Response) {
  const urls: string[] = [];
  const client = createProviderClient({
    provider,
    source: { get: async () => ({ status: 'ok', token: 'test-token', refreshed: false }) },
    fetch: async (url) => {
      urls.push(String(url));
      return answer(String(url));
    },
  });
  const ref: PullRef = { provider, host: hosts[provider], owner: 'acme', repo: 'repo', number: 12 };
  return { client, urls, ref };
}
describe('native review activity', () => {
  it('reads GitHub timeline events and preserves review state and commit identity', async () => {
    const { client, ref, urls } = setup('github', () =>
      Response.json([
        {
          event: 'reviewed',
          id: 4,
          user: { login: 'sam', avatar_url: 'https://avatars.test/sam' },
          state: 'APPROVED',
          commit_id: sha,
          body: 'Looks good',
          submitted_at: '2026-11-10T00:00:00Z',
        },
        {
          event: 'review_requested',
          id: 5,
          actor: { login: 'author' },
          requested_reviewer: { login: 'alex' },
        },
        {
          event: 'committed',
          sha,
          author: { name: 'Sam' },
          message: 'Fix restore',
          committer: { date: '2026-11-09T00:00:00Z' },
        },
      ]),
    );
    expect(await client.activity?.(ref)).toMatchObject({
      ok: true,
      value: {
        cursor: null,
        items: [
          { kind: 'review', actor: 'sam', state: 'approved', sha, body: 'Looks good' },
          { kind: 'event', title: 'requested a review from alex' },
          { kind: 'commit', actor: 'Sam', sha, body: 'Fix restore' },
        ],
      },
    });
    expect(urls[0]).toContain('/issues/12/timeline?per_page=100&page=1');
  });
  it('normalizes GitLab approvals and Bitbucket review events', async () => {
    const gl = setup('gitlab', () =>
      Response.json([
        {
          id: 3,
          system: true,
          body: 'approved this merge request',
          author: { username: 'sam' },
          created_at: '2026-11-10T00:00:00Z',
        },
      ]),
    );
    expect(await gl.client.activity?.(gl.ref)).toMatchObject({
      ok: true,
      value: { items: [{ kind: 'review', state: 'approved', actor: 'sam' }] },
    });
    const bb = setup('bitbucket', () =>
      Response.json({
        values: [{ approval: { user: { nickname: 'sam' }, date: '2026-11-10T00:00:00Z' } }],
        next: 'https://untrusted.example/next',
      }),
    );
    expect(await bb.client.activity?.(bb.ref)).toMatchObject({
      ok: true,
      value: { cursor: '2', items: [{ kind: 'review', state: 'approved', actor: 'sam' }] },
    });
    await bb.client.activity?.(bb.ref, '2');
    expect(bb.urls[1]).toContain(
      'https://api.bitbucket.org/2.0/repositories/acme/repo/pullrequests/12/activity?pagelen=100&page=2',
    );
  });
  it('uses raw page size for continuation and rejects external cursors and foreign references', async () => {
    const { client, ref, urls } = setup('github', () =>
      Response.json(Array.from({ length: 100 }, (_, id) => ({ id, event: 'labeled' }))),
    );
    expect(await client.activity?.(ref)).toMatchObject({ ok: true, value: { cursor: '2' } });
    expect(await client.activity?.(ref, 'https://other.test')).toMatchObject({ ok: false });
    expect(await client.activity?.({ ...ref, host: 'other.test' })).toMatchObject({ ok: false });
    expect(await client.checks?.(ref, 'main')).toMatchObject({ ok: false });
    expect(urls).toHaveLength(1);
  });
  it('merges GitHub check runs with the latest commit status for each context', async () => {
    const { client, ref } = setup('github', (url) =>
      Response.json(
        url.includes('check-runs')
          ? {
              check_runs: [
                { id: 1, name: 'test', status: 'completed', conclusion: 'success', head_sha: sha },
              ],
            }
          : [
              { id: 3, context: 'deploy', state: 'success' },
              { id: 2, context: 'deploy', state: 'pending' },
            ],
      ),
    );
    expect(await client.checks?.(ref, sha)).toMatchObject({
      ok: true,
      value: {
        capped: false,
        items: [
          { name: 'test', status: 'completed', conclusion: 'success', sha },
          { id: 'github:status:3', name: 'deploy', conclusion: 'success' },
        ],
      },
    });
  });
  it('marks partially available checks instead of silently claiming a complete result', async () => {
    const { client, ref } = setup('github', (url) =>
      url.includes('check-runs')
        ? new Response('', { status: 403 })
        : Response.json([{ id: 2, context: 'deploy', state: 'pending' }]),
    );
    expect(await client.checks?.(ref, sha)).toMatchObject({
      ok: true,
      value: { capped: true, items: [{ name: 'deploy', conclusion: null, status: 'in_progress' }] },
    });
  });
  it('normalizes GitLab and Bitbucket check outcomes', async () => {
    const gl = setup('gitlab', () => Response.json([{ id: 1, name: 'test', status: 'failed', sha }]));
    expect(await gl.client.checks?.(gl.ref, sha)).toMatchObject({
      ok: true,
      value: { items: [{ conclusion: 'failure' }] },
    });
    const bb = setup('bitbucket', () =>
      Response.json({
        values: [
          { key: 'test', state: 'INPROGRESS' },
          { key: 'build', state: 'SUCCESSFUL' },
        ],
      }),
    );
    expect(await bb.client.checks?.(bb.ref, sha)).toMatchObject({
      ok: true,
      value: {
        items: [
          { conclusion: null, status: 'in_progress' },
          { conclusion: 'success', status: 'completed' },
        ],
      },
    });
  });
});
