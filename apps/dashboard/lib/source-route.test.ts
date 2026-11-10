import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./request-audit', () => ({ auditedRoute: (handler: (request: Request) => Promise<Response>) => handler }));
const state = vi.hoisted(() => ({
  signedIn: true,
  sha: 'a'.repeat(40),
  content: vi.fn(async () => ({ ok: true, value: '<script>example</script>\nline two' })),
}));
vi.mock('./session', () => ({ currentActor: async () => (state.signedIn ? { id: 'reviewer' } : null) }));
vi.mock('./providers', () => ({
  providerClient: async () => ({
    pull: async () => ({ ok: true, value: { headSha: state.sha, baseSha: 'b'.repeat(40) } }),
    fileContent: state.content,
  }),
}));
import { GET } from '../app/api/pull/file/route';
const request = (extra = {}) =>
  new Request(
    'https://app.geld.sh/api/pull/file?' +
      new URLSearchParams({
        provider: 'github',
        host: 'github.com',
        owner: 'acme',
        repo: 'repo',
        number: '1',
        revision: 'a'.repeat(40),
        path: 'src/a.ts',
        ...extra,
      }),
  );
beforeEach(() => {
  state.signedIn = true;
  state.content.mockClear();
});
describe('source context boundary', () => {
  it('requires authentication and a revision belonging to the current pull', async () => {
    state.signedIn = false;
    expect((await GET(request())).status).toBe(401);
    state.signedIn = true;
    expect((await GET(request({ revision: 'c'.repeat(40) }))).status).toBe(409);
    expect((await GET(request({ path: '../private' }))).status).toBe(400);
    expect(state.content).not.toHaveBeenCalled();
  });
  it('returns source as lines or inert non-cacheable plain text', async () => {
    expect(await (await GET(request())).json()).toMatchObject({
      lines: ['<script>example</script>', 'line two'],
    });
    const raw = await GET(request({ raw: 'true' }));
    expect(raw.headers.get('content-type')).toContain('text/plain');
    expect(raw.headers.get('cache-control')).toBe('private, no-store');
    expect(raw.headers.get('content-security-policy')).toContain('sandbox');
  });
});
