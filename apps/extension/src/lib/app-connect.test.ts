import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted((): { store: Map<string, unknown> } => ({ store: new Map() }));
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: async () => true } } }));
vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: (key: string, options: { fallback: unknown }) => ({
      getValue: async () => (state.store.has(key) ? state.store.get(key) : options.fallback),
      setValue: async (value: unknown) => void state.store.set(key, value),
      watch: () => () => undefined,
    }),
  },
}));

import type { Connection } from '@geld/review/link-resolvers/index';
import { proxyTokens, tokenEndpointFor } from './app-connect';
import { withFreshTokens } from './connections';
import { TEAMS_REDIRECT, teamsAuthorizeUrl } from './teams-connect';

const teams = (expiresAt: number | null): Connection => ({
  id: 't',
  service: 'teams',
  label: 'Contoso',
  host: null,
  secret: 'old',
  email: null,
  account: 'ada@contoso.com',
  covers: ['tenant'],
  use: { details: true, ai: false },
  expiresAt,
  refresh: 'refresh-1',
});

beforeEach(() => {
  state.store = new Map();
});

describe('Connect Microsoft Teams', () => {
  it('asks for the delegated scopes with a challenge, back to geld.sh', () => {
    const url = new URL(teamsAuthorizeUrl('app-id', 'st', 'ch'));
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toBe('offline_access User.Read ChannelMessage.Read.All Channel.ReadBasic.All Team.ReadBasic.All');
    expect(url.searchParams.get('redirect_uri')).toBe(TEAMS_REDIRECT);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_mode')).toBe('query');
  });

  it('reads the proxy’s tokens and its refusal', async () => {
    const ok = async (): Promise<Response> => new Response(JSON.stringify({ ok: true, accessToken: 'a', refreshToken: 'r', expiresIn: 3600 }));
    const tokens = await proxyTokens(ok, 'teams', { grant: 'code', code: 'c', verifier: 'v' });
    expect(tokens).toMatchObject({ accessToken: 'a', refreshToken: 'r' });
    const refused = async (): Promise<Response> => new Response(JSON.stringify({ ok: false, error: 'AADSTS65001: The user or administrator has not consented.' }), { status: 400 });
    expect(await proxyTokens(refused, 'teams', { grant: 'refresh', refresh: 'r' })).toEqual({ message: 'AADSTS65001: The user or administrator has not consented.' });
  });
});

describe('withFreshTokens', () => {
  it('renews an access about to expire through the proxy and stores it, leaving fresh ones alone', async () => {
    const now = 1_000_000_000_000;
    const asked: string[] = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      asked.push(`${url} ${String(init?.body)}`);
      return new Response(JSON.stringify({ ok: true, accessToken: 'new', refreshToken: 'refresh-2', expiresIn: 3600 }));
    };
    const fresh = teams(now + 30 * 60_000);
    expect(await withFreshTokens([fresh], fetch, now)).toEqual([fresh]);
    expect(asked).toEqual([]);
    const [renewed] = await withFreshTokens([teams(now + 60_000)], fetch, now);
    expect(asked).toEqual([`${tokenEndpointFor('teams')} {"grant":"refresh","refresh":"refresh-1"}`]);
    expect(renewed).toMatchObject({ secret: 'new', refresh: 'refresh-2' });
    expect(state.store.get('local:connections')).toEqual([renewed]);
  });

  it('keeps a connection the proxy cannot renew as it is', async () => {
    const stale = teams(0);
    const fetch = async (): Promise<Response> => new Response(JSON.stringify({ ok: false, error: 'invalid_grant' }), { status: 400 });
    expect(await withFreshTokens([stale], fetch, 1)).toEqual([stale]);
    expect(state.store.has('local:connections')).toBe(false);
  });
});
