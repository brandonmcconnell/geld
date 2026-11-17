import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  billed: true,
  fallback: false,
  custom: true,
  card: true,
  cap: 5000,
  approved: true,
  key: true,
}));
vi.mock('server-only', () => ({}));
vi.mock('./db', () => ({
  database: () => ({
    query: async (sql: string) => ({
      rows: sql.includes('subscriptions')
        ? [{ card_on_file: state.card, safety_net: state.approved, cap_cents: state.cap }]
        : [
            {
              id: 'geld',
              provider: 'geld',
              base_url: null,
              encrypted_key: null,
              relay_channel: null,
              settings: { billed: state.billed, safetyNet: state.fallback },
            },
            ...(state.custom
              ? [
                  {
                    id: 'custom',
                    provider: 'openai',
                    base_url: 'https://api.openai.com',
                    encrypted_key: state.key ? 'stored' : null,
                    relay_channel: null,
                    settings: { models: ['custom-model'] },
                  },
                ]
              : []),
          ],
    }),
  }),
}));
vi.mock('./crypto', () => ({ decryptCredential: async () => 'synthetic-key' }));
vi.mock('./companion', () => ({ companionEndpoint: async () => null, companionFetch: vi.fn() }));
import { aiConfigurations } from './ai-config';
beforeEach(() => {
  Object.assign(state, {
    billed: true,
    fallback: false,
    custom: true,
    card: true,
    cap: 5000,
    approved: true,
    key: true,
  });
  vi.stubEnv('AI_GATEWAY_API_KEY', 'synthetic-geld-key');
  vi.stubEnv('AI_GATEWAY_MODEL', 'geld-model');
});
afterEach(() => vi.unstubAllEnvs());
describe('independent Geld fallback', () => {
  it('uses custom providers without paid fallback even when Geld is enabled', async () => {
    expect((await aiConfigurations('user', 'team')).map(({ id, fallback }) => ({ id, fallback }))).toEqual([
      { id: 'custom', fallback: false },
    ]);
    state.key = false;
    expect(await aiConfigurations('user', 'team')).toEqual([]);
  });
  it('appends an opted-in fallback with or without Geld enabled as a normal provider', async () => {
    state.fallback = true;
    for (const billed of [true, false]) {
      state.billed = billed;
      expect((await aiConfigurations('user', 'team')).map(({ id, fallback }) => ({ id, fallback }))).toEqual([
        { id: 'custom', fallback: false },
        { id: 'geld', fallback: true },
      ]);
    }
  });
  it('requires team consent, card and a positive cap before offering paid fallback', async () => {
    state.fallback = true;
    expect((await aiConfigurations('user')).map(({ id }) => id)).toEqual(['custom']);
    for (const change of [{ card: false }, { cap: 0 }, { approved: false }]) {
      Object.assign(state, { card: true, cap: 5000, approved: true }, change);
      expect((await aiConfigurations('user', 'team')).map(({ id }) => id)).toEqual(['custom']);
    }
  });
  it('keeps Geld available on its own and lists enabled Geld for model discovery without duplicates', async () => {
    expect((await aiConfigurations('user', undefined, true)).map(({ id }) => id)).toEqual(['geld', 'custom']);
    state.custom = false;
    expect((await aiConfigurations('user', 'team')).map(({ id, fallback }) => ({ id, fallback }))).toEqual([
      { id: 'geld', fallback: false },
    ]);
    state.billed = false;
    expect(await aiConfigurations('user', 'team')).toEqual([]);
  });
});
