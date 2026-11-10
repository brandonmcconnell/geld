import { describe, expect, it } from 'vitest';
import type { Provider, RepositoryRef } from '@geld/domain';
import { createProviderClient } from './client';

const revision = 'a'.repeat(40);
const cases: { provider: Provider; host: string; endpoint: string }[] = [
  {
    provider: 'github',
    host: 'github.com',
    endpoint: `/repos/acme/repo/contents/src/a%20b.ts?ref=${revision}`,
  },
  {
    provider: 'gitlab',
    host: 'gitlab.com',
    endpoint: `/api/v4/projects/acme%2Frepo/repository/files/src%2Fa%20b.ts/raw?ref=${revision}`,
  },
  {
    provider: 'bitbucket',
    host: 'bitbucket.org',
    endpoint: `/2.0/repositories/acme/repo/src/${revision}/src/a%20b.ts`,
  },
];

describe('revision-bound source content', () => {
  for (const item of cases) {
    it(`reads ${item.provider} source as text at an encoded revision-specific URL`, async () => {
      const requests: string[] = [];
      const client = createProviderClient({
        provider: item.provider,
        source: { get: async () => ({ status: 'ok', token: 'test-token', refreshed: false }) },
        fetch: async (url) => {
          requests.push(String(url));
          return new Response('const ready = true;');
        },
      });
      const ref: RepositoryRef = { provider: item.provider, host: item.host, owner: 'acme', repo: 'repo' };
      expect(await client.fileContent?.(ref, 'src/a b.ts', revision)).toEqual({
        ok: true,
        value: 'const ready = true;',
      });
      expect(requests).toHaveLength(1);
      const requested = new URL(requests[0]!);
      expect(requested.pathname + requested.search).toBe(item.endpoint);
      for (const path of ['../secret', '/absolute', 'src/../secret', 'src\\secret', 'src//secret']) {
        expect(await client.fileContent?.(ref, path, revision)).toMatchObject({ ok: false });
      }
      expect(await client.fileContent?.(ref, 'src/a.ts', 'main')).toMatchObject({ ok: false });
      expect(requests).toHaveLength(1);
    });
  }
  it('does not return binary or oversized source to the renderer', async () => {
    let content = '\0binary';
    const client = createProviderClient({
      provider: 'github',
      source: { get: async () => ({ status: 'ok', token: 'test-token', refreshed: false }) },
      fetch: async () => new Response(content),
    });
    const ref: RepositoryRef = { provider: 'github', host: 'github.com', owner: 'acme', repo: 'repo' };
    expect(await client.fileContent?.(ref, 'file', revision)).toMatchObject({
      ok: false,
      reason: 'unsupported',
    });
    content = 'x'.repeat(1_000_001);
    expect(await client.fileContent?.(ref, 'file', revision)).toMatchObject({
      ok: false,
      reason: 'unsupported',
    });
  });
});
