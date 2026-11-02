import { describe, expect, it, vi } from 'vitest';
import { createApiTransport } from './client';
describe('provider path confinement before URL normalization', () => {
  it.each(['https://api.github.com/', 'https://api.bitbucket.org/2.0/', 'https://git.example.test/api/v3/'])(
    'rejects raw and encoded dot segments without reading credentials or making a request on %s', async baseUrl => {
      const get = vi.fn(async () => ({ status: 'ok', token: 'synthetic', refreshed: false } satisfies Awaited<ReturnType<import('./auth').TokenSource['get']>>));
      const request = vi.fn(async () => Response.json({}));
      const api = createApiTransport({ baseUrl, source: { get }, fetch: request });
      for (const path of ['repos/../user', 'repos/./user', 'repos/%2e/user', 'repos/%2E%2e/user', 'repos/.%2e/user', 'repos/%2e./user', '../user']) {
        expect(await api.request(path)).toEqual({ ok: false, reason: 'invalid_response' });
      }
      expect(get).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
      expect(await api.request('repos/org/repo.name?q=..')).toEqual({ ok: true, value: {} });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
});
