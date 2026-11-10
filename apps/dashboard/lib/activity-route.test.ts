import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./request-audit', () => ({
  auditedRoute: (handler: (request: Request) => Promise<Response>) => handler,
}));
const state = vi.hoisted(() => ({
  signedIn: true,
  allowed: true,
  activity: vi.fn(async () => ({ ok: true, value: { items: [], cursor: null, total: null, capped: false } })),
  checks: vi.fn(async () => ({ ok: true, value: { items: [], cursor: null, total: null, capped: false } })),
}));
vi.mock('./session', () => ({ currentActor: async () => (state.signedIn ? { id: 'reviewer' } : null) }));
vi.mock('./providers', () => ({
  providerClient: async () => ({
    pull: async () =>
      state.allowed ? { ok: true, value: { headSha: 'a'.repeat(40) } } : { ok: false, reason: 'permission' },
    activity: state.activity,
    checks: state.checks,
  }),
}));
import { GET } from '../app/api/pull/activity/route';
function request(extra = {}) {
  return new Request(
    'https://app.geld.sh/api/pull/activity?' +
      new URLSearchParams({
        provider: 'github',
        host: 'github.com',
        owner: 'acme',
        repo: 'repo',
        number: '12',
        revision: 'a'.repeat(40),
        section: 'activity',
        ...extra,
      }),
  );
}
beforeEach(() => {
  state.signedIn = true;
  state.allowed = true;
  vi.clearAllMocks();
});
describe('private revision-bound review feed', () => {
  it('requires an authenticated actor and permission on the pull request', async () => {
    state.signedIn = false;
    expect((await GET(request())).status).toBe(401);
    state.signedIn = true;
    state.allowed = false;
    expect((await GET(request())).status).toBe(403);
    expect(state.activity).not.toHaveBeenCalled();
  });
  it('rejects stale revisions and arbitrary cursors before fetching activity', async () => {
    expect((await GET(request({ revision: 'b'.repeat(40) }))).status).toBe(409);
    expect((await GET(request({ cursor: 'https://attacker.test' }))).status).toBe(400);
    expect(state.activity).not.toHaveBeenCalled();
  });
  it('returns private non-cacheable pages, bound to the requested head', async () => {
    const response = await GET(request({ section: 'checks', cursor: '2' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ headSha: 'a'.repeat(40), page: { items: [] } });
    expect(state.checks).toHaveBeenCalledWith(expect.objectContaining({ number: 12 }), 'a'.repeat(40), '2');
  });
});
