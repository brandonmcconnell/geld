import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('./request-audit', () => ({
  auditedRoute: <T extends unknown[]>(handler: (request: Request, ...rest: T) => Promise<Response>) => handler,
}));
vi.mock('./session', () => ({ currentActor: async () => ({ id: 'u' }) }));
const state = vi.hoisted(() => ({ fail: true, empty: false, claude: false, reject: false }));
vi.mock('./ai-config', () => ({
  aiConfigurations: async () =>
    ['working', 'failed'].map((id) => ({
      id,
      provider: state.claude && id === 'failed' ? 'claude' : 'openai',
      baseUrl: `https://${id}.example.test`,
      apiKey: 'synthetic',
    })),
}));
vi.mock('@geld/review/ai-client', () => ({
  listModels: async (_fetch: unknown, url: string) => {
    if (url.includes('failed') && state.reject) throw new Error('Network unavailable');
    return url.includes('failed') && state.fail
      ? { ok: false, reason: 'http' }
      : { ok: true, models: state.empty ? [] : [{ id: 'model', name: 'Fixture' }] };
  },
}));
import { GET } from '../app/api/ai/models/route';
beforeEach(() => {
  state.fail = true;
  state.empty = false;
  state.claude = false;
  state.reject = false;
});
afterEach(() => vi.unstubAllGlobals());
describe('partial model catalog failures', () => {
  it('retains working catalogs and reports a fulfilled provider failure', async () => {
    const result = await (await GET(new Request('https://app.geld.sh/api/ai/models'))).json();
    expect(result.someUnavailable).toBe(true);
    expect(result.models).toEqual([{ id: 'model', name: 'Fixture', instance: 'working', provider: 'openai' }]);
  });
  it('reports a rejected catalog alongside working models', async () => {
    state.reject = true;
    const result = await (await GET(new Request('https://app.geld.sh/api/ai/models'))).json();
    expect(result.someUnavailable).toBe(true);
    expect(result.models).toHaveLength(1);
  });
  it('does not warn for successful empty catalogs', async () => {
    state.fail = false;
    state.empty = true;
    const result = await (await GET(new Request('https://app.geld.sh/api/ai/models'))).json();
    expect(result.someUnavailable).toBe(false);
    expect(result.models).toEqual([]);
  });
  it('reports a Claude HTTP failure even when its body has a model-shaped response', async () => {
    state.claude = true;
    vi.stubGlobal('fetch', async () =>
      Response.json({ data: [{ id: 'wrong', display_name: 'Do not use' }] }, { status: 403 }),
    );
    const result = await (await GET(new Request('https://app.geld.sh/api/ai/models'))).json();
    expect(result.someUnavailable).toBe(true);
    expect(result.models).toHaveLength(1);
  });
});
