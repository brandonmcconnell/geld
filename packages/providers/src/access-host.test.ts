import { expect, it } from 'vitest';
import type { RepositoryRef } from '@geld/domain';
import { githubAccessAdapter } from './actions';

it('rejects foreign provider and Enterprise references before using the github.com access adapter', async () => {
  let calls = 0;
  const adapter = githubAccessAdapter({
    source: { get: async () => { calls += 1; return { status: 'signed-out', reason: 'fixture' }; } },
    fetch: async () => { calls += 1; return new Response(null, { status: 204 }); },
  });
  const repositories = [
    { provider: 'github', host: 'github.company.example', owner: 'same', repo: 'name' },
    { provider: 'gitlab', host: 'gitlab.com', owner: 'same', repo: 'name' },
  ] satisfies RepositoryRef[];
  for (const ref of repositories) {
    expect(await adapter.grantCollaborator(ref, 'reader', 'write')).toEqual({ ok: false, reason: 'unsupported' });
    expect(await adapter.removeCollaborator(ref, 'reader')).toEqual({ ok: false, reason: 'unsupported' });
  }
  expect(calls).toBe(0);
});
