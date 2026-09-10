import type { FetchLike, RefreshResult, TokenSet } from './auth';
import {
  ACCESS_TOKEN_URL,
  authorizeUrl,
  createTokenSource,
  DEVICE_CODE_URL,
  exchangeCode,
  expiresWithin,
  parseTokenResponse,
  pollDeviceCode,
  refreshTokens,
  requestDeviceCode,
  revokeToken,
  tokenKind,
} from './auth';

const NOW = 1_700_000_000_000;
const now = (): number => NOW;

interface Call {
  readonly url: string;
  readonly method: string | undefined;
  readonly fields: URLSearchParams;
  readonly headers: Record<string, string>;
}

/** A fetch that answers from a queue and records what it was asked. */
function fakeFetch(responses: ReadonlyArray<{ status?: number; body: unknown }>): { fetch: FetchLike; calls: Call[] } {
  const queue = [...responses];
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    if (init?.headers !== undefined && !(init.headers instanceof Headers) && !Array.isArray(init.headers)) Object.assign(headers, init.headers);
    calls.push({ url, method: init?.method, fields: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''), headers });
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected request');
    const status = next.status ?? 200;
    // 204 and friends may not carry a body, exactly as in the real Response.
    return new Response(next.body === null || status === 204 ? null : JSON.stringify(next.body), { status });
  };
  return { fetch, calls };
}

const GITHUB_TOKEN_BODY = {
  access_token: 'ghu_access',
  expires_in: 28800,
  refresh_token: 'ghr_refresh',
  refresh_token_expires_in: 15897600,
  token_type: 'bearer',
  scope: '',
};

describe('tokenKind', () => {
  it('tells App tokens from OAuth App tokens by prefix', () => {
    expect(tokenKind('ghu_abc')).toBe('app');
    expect(tokenKind('gho_abc')).toBe('oauth');
    expect(tokenKind('ghp_abc')).toBe('oauth');
  });
});

describe('parseTokenResponse', () => {
  it('reads an expiring token pair with absolute times', () => {
    expect(parseTokenResponse(GITHUB_TOKEN_BODY, NOW)).toEqual<TokenSet>({
      accessToken: 'ghu_access',
      expiresAt: NOW + 28800 * 1000,
      refreshToken: 'ghr_refresh',
      refreshTokenExpiresAt: NOW + 15897600 * 1000,
    });
  });

  it('reads a non-expiring token (expiration switched off on the App)', () => {
    expect(parseTokenResponse({ access_token: 'ghu_x', token_type: 'bearer' }, NOW)).toEqual<TokenSet>({
      accessToken: 'ghu_x',
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    });
  });

  it('rejects bodies without a token', () => {
    expect(parseTokenResponse({ error: 'authorization_pending' }, NOW)).toBeNull();
    expect(parseTokenResponse({ access_token: '' }, NOW)).toBeNull();
    expect(parseTokenResponse('nope', NOW)).toBeNull();
  });
});

describe('device flow', () => {
  it('requests a code without a scope and reports the interval in ms', async () => {
    const { fetch, calls } = fakeFetch([
      { body: { device_code: 'dev', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 } },
    ]);
    const code = await requestDeviceCode('Iv1.test', { fetch, now });
    expect(code).toEqual({ deviceCode: 'dev', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresAt: NOW + 900_000, intervalMs: 5000 });
    expect(calls[0]?.url).toBe(DEVICE_CODE_URL);
    expect(calls[0]?.fields.get('client_id')).toBe('Iv1.test');
    expect(calls[0]?.fields.has('scope')).toBe(false);
  });

  it('explains an unknown client id or disabled device flow', async () => {
    const { fetch } = fakeFetch([{ status: 404, body: { error: 'Not Found' } }]);
    await expect(requestDeviceCode('Iv1.test', { fetch, now })).rejects.toThrow(/Device Flow/);
  });

  it('maps GitHub poll answers', async () => {
    const device = { deviceCode: 'dev', userCode: 'X', verificationUri: 'u', expiresAt: NOW + 900_000, intervalMs: 5000 };
    const { fetch, calls } = fakeFetch([
      { body: { error: 'authorization_pending' } },
      { body: { error: 'slow_down' } },
      { body: { error: 'access_denied' } },
      { body: GITHUB_TOKEN_BODY },
    ]);
    expect(await pollDeviceCode('Iv1.test', device, { fetch, now })).toEqual({ status: 'pending', intervalMs: 5000 });
    expect(await pollDeviceCode('Iv1.test', device, { fetch, now })).toEqual({ status: 'pending', intervalMs: 10000 });
    expect(await pollDeviceCode('Iv1.test', device, { fetch, now })).toMatchObject({ status: 'failed' });
    const authorized = await pollDeviceCode('Iv1.test', device, { fetch, now });
    expect(authorized.status).toBe('authorized');
    if (authorized.status === 'authorized') expect(authorized.tokens.accessToken).toBe('ghu_access');
    expect(calls[0]?.url).toBe(ACCESS_TOKEN_URL);
    expect(calls[0]?.fields.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
  });
});

describe('web flow', () => {
  it('builds the authorize URL without a scope', () => {
    const url = new URL(authorizeUrl({ clientId: 'Iv1.test', redirectUri: 'https://www.geld.sh/auth', state: 's' }));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('Iv1.test');
    expect(url.searchParams.get('redirect_uri')).toBe('https://www.geld.sh/auth');
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('exchanges the code with the client secret', async () => {
    const { fetch, calls } = fakeFetch([{ body: GITHUB_TOKEN_BODY }]);
    const result = await exchangeCode({ clientId: 'Iv1.test', clientSecret: 'secret', code: 'code', redirectUri: 'https://www.geld.sh/auth' }, { fetch, now });
    expect(result.ok).toBe(true);
    expect(calls[0]?.fields.get('client_secret')).toBe('secret');
    expect(calls[0]?.fields.get('redirect_uri')).toBe('https://www.geld.sh/auth');
  });

  it('reports GitHub errors by code', async () => {
    const { fetch } = fakeFetch([{ body: { error: 'bad_verification_code' } }]);
    expect(await exchangeCode({ clientId: 'a', clientSecret: 'b', code: 'c', redirectUri: 'd' }, { fetch, now })).toEqual({ ok: false, error: 'bad_verification_code' });
  });
});

describe('refreshTokens', () => {
  it('omits the client secret for device-flow tokens and sends it when given', async () => {
    const { fetch, calls } = fakeFetch([{ body: GITHUB_TOKEN_BODY }, { body: GITHUB_TOKEN_BODY }]);
    await refreshTokens({ clientId: 'Iv1.test', refreshToken: 'ghr_old' }, { fetch, now });
    await refreshTokens({ clientId: 'Iv1.test', clientSecret: 'secret', refreshToken: 'ghr_old' }, { fetch, now });
    expect(calls[0]?.fields.get('grant_type')).toBe('refresh_token');
    expect(calls[0]?.fields.get('refresh_token')).toBe('ghr_old');
    expect(calls[0]?.fields.has('client_secret')).toBe(false);
    expect(calls[1]?.fields.get('client_secret')).toBe('secret');
  });

  it('only a refused refresh token ends the session; other failures are retried later', async () => {
    const { fetch } = fakeFetch([
      { body: { error: 'bad_refresh_token' } },
      { body: { error: 'incorrect_client_credentials', error_description: 'The client_id and/or client_secret passed are incorrect.' } },
      { status: 502, body: null },
    ]);
    expect(await refreshTokens({ clientId: 'a', refreshToken: 'r' }, { fetch, now })).toEqual({ status: 'rejected', error: 'bad_refresh_token' });
    expect(await refreshTokens({ clientId: 'a', refreshToken: 'r' }, { fetch, now })).toMatchObject({ status: 'unavailable' });
    expect(await refreshTokens({ clientId: 'a', refreshToken: 'r' }, { fetch, now })).toMatchObject({ status: 'unavailable' });
  });

  it('treats a network failure as unavailable, not as a sign-out', async () => {
    const fetch: FetchLike = () => Promise.reject(new Error('offline'));
    expect(await refreshTokens({ clientId: 'a', refreshToken: 'r' }, { fetch, now })).toEqual({ status: 'unavailable', message: 'offline' });
  });
});

describe('revokeToken', () => {
  it('uses Basic auth with the client credentials', async () => {
    const { fetch, calls } = fakeFetch([{ status: 204, body: null }]);
    expect(await revokeToken({ clientId: 'Iv1.test', clientSecret: 'secret', token: 'ghu_x' }, { fetch })).toBe(true);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('https://api.github.com/applications/Iv1.test/token');
    expect(calls[0]?.headers.Authorization).toBe(`Basic ${btoa('Iv1.test:secret')}`);
  });
});

describe('createTokenSource', () => {
  const fresh: TokenSet = { accessToken: 'ghu_fresh', expiresAt: NOW + 3_600_000, refreshToken: 'ghr_1', refreshTokenExpiresAt: NOW + 10_000_000_000 };
  const expiring: TokenSet = { ...fresh, accessToken: 'ghu_old', expiresAt: NOW + 60_000 };
  const expired: TokenSet = { ...fresh, accessToken: 'ghu_dead', expiresAt: NOW - 1 };
  const renewed: TokenSet = { accessToken: 'ghu_new', expiresAt: NOW + 28_800_000, refreshToken: 'ghr_2', refreshTokenExpiresAt: NOW + 10_000_000_000 };

  function store(initial: TokenSet | null): { load(): Promise<TokenSet | null>; save(tokens: TokenSet): Promise<void>; saved: TokenSet[] } {
    let current = initial;
    const saved: TokenSet[] = [];
    return {
      load: () => Promise.resolve(current),
      save: (tokens) => {
        current = tokens;
        saved.push(tokens);
        return Promise.resolve();
      },
      saved,
    };
  }

  it('returns a fresh token without refreshing', async () => {
    const refresh = vi.fn<(token: string) => Promise<RefreshResult>>();
    const source = createTokenSource({ store: store(fresh), refresh, now });
    expect(await source.get()).toEqual({ status: 'ok', token: 'ghu_fresh', refreshed: false });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes ahead of expiry and saves the rotated pair', async () => {
    const s = store(expiring);
    const refresh = vi.fn<(token: string) => Promise<RefreshResult>>().mockResolvedValue({ status: 'refreshed', tokens: renewed });
    const source = createTokenSource({ store: s, refresh, now });
    expect(await source.get()).toEqual({ status: 'ok', token: 'ghu_new', refreshed: true });
    expect(refresh).toHaveBeenCalledWith('ghr_1');
    expect(s.saved).toEqual([renewed]);
    expect(expiresWithin(renewed, NOW)).toBe(false);
  });

  it('collapses concurrent callers into one refresh', async () => {
    const s = store(expiring);
    let release: (value: RefreshResult) => void = () => undefined;
    const refresh = vi.fn<(token: string) => Promise<RefreshResult>>().mockImplementation(
      () =>
        new Promise<RefreshResult>((resolve) => {
          release = resolve;
        }),
    );
    const source = createTokenSource({ store: s, refresh, now });
    const a = source.get();
    const b = source.get();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    release({ status: 'refreshed', tokens: renewed });
    expect(await Promise.all([a, b])).toEqual([
      { status: 'ok', token: 'ghu_new', refreshed: true },
      { status: 'ok', token: 'ghu_new', refreshed: true },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('signs out when GitHub refuses the refresh token', async () => {
    const source = createTokenSource({ store: store(expiring), refresh: () => Promise.resolve({ status: 'rejected', error: 'bad_refresh_token' }), now });
    expect(await source.get()).toMatchObject({ status: 'signed-out' });
  });

  it('keeps a still-valid token when GitHub is unreachable, and blocks only once it is dead', async () => {
    const unavailable = (): Promise<RefreshResult> => Promise.resolve({ status: 'unavailable', message: 'offline' });
    expect(await createTokenSource({ store: store(expiring), refresh: unavailable, now }).get()).toEqual({ status: 'ok', token: 'ghu_old', refreshed: false });
    expect(await createTokenSource({ store: store(expired), refresh: unavailable, now }).get()).toEqual({ status: 'unavailable', message: 'offline' });
  });

  it('never refreshes non-expiring tokens and signs out an expired one without a refresh token', async () => {
    const refresh = vi.fn<(token: string) => Promise<RefreshResult>>();
    const legacy: TokenSet = { accessToken: 'gho_x', expiresAt: null, refreshToken: null, refreshTokenExpiresAt: null };
    expect(await createTokenSource({ store: store(legacy), refresh, now }).get()).toEqual({ status: 'ok', token: 'gho_x', refreshed: false });
    expect(await createTokenSource({ store: store({ ...expired, refreshToken: null }), refresh, now }).get()).toMatchObject({ status: 'signed-out' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('force refreshes after a 401, and ends the session when there is nothing to refresh with', async () => {
    const s = store(fresh);
    const refresh = vi.fn<(token: string) => Promise<RefreshResult>>().mockResolvedValue({ status: 'refreshed', tokens: renewed });
    expect(await createTokenSource({ store: s, refresh, now }).get({ force: true })).toEqual({ status: 'ok', token: 'ghu_new', refreshed: true });
    const legacy: TokenSet = { accessToken: 'gho_x', expiresAt: null, refreshToken: null, refreshTokenExpiresAt: null };
    expect(await createTokenSource({ store: store(legacy), refresh, now }).get({ force: true })).toMatchObject({ status: 'signed-out' });
  });

  it('reports a missing account as signed out', async () => {
    expect(await createTokenSource({ store: store(null), refresh: vi.fn(), now }).get()).toMatchObject({ status: 'signed-out' });
  });
});
