/**
 * User authorization for the Geld **GitHub App**.
 *
 * Geld never acts as the app itself (no private key, no installation tokens);
 * everything happens on behalf of a signed-in user with a *user access token*
 * (`ghu_…`). Two ways to get one, both implemented here without any Geld
 * server in the loop:
 *
 * - the **device flow** for the extension: no client secret, the user types a
 *   short code on github.com;
 * - the **web flow** for geld.sh: the site holds the client secret and
 *   exchanges the callback code in a route handler.
 *
 * Tokens expire after eight hours and come with a refresh token that lasts six
 * months and rotates on every use. `createTokenSource` keeps one token fresh
 * for one home: it refreshes shortly before expiry, serialises concurrent
 * callers so a rotated refresh token is never used twice, and tells the caller
 * apart "GitHub said no" (sign out) from "GitHub was unreachable" (try later).
 * Device-flow tokens refresh without the client secret; web-flow tokens need it.
 *
 * Nothing here touches `browser.*`, cookies or storage: each home supplies a
 * `TokenStore`, and `fetch` can be injected for tests.
 */

export const DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const API = 'https://api.github.com';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/** A user access token with its lifetime, as GitHub issued it. */
export interface TokenSet {
  readonly accessToken: string;
  /** Epoch ms; `null` when the App has token expiration switched off. */
  readonly expiresAt: number | null;
  readonly refreshToken: string | null;
  /** Epoch ms; `null` when there is no refresh token. */
  readonly refreshTokenExpiresAt: number | null;
}

/**
 * Which credential a stored token is. `ghu_` tokens come from the GitHub App;
 * `gho_` tokens from the OAuth App Geld used before it and still accepts
 * during the migration period (they keep working until revoked).
 */
export type TokenKind = 'app' | 'oauth';

export function tokenKind(token: string): TokenKind {
  return token.startsWith('ghu_') ? 'app' : 'oauth';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Read GitHub's token response (`access_token`, `expires_in`, `refresh_token`, `refresh_token_expires_in`). */
export function parseTokenResponse(body: unknown, now: number): TokenSet | null {
  if (!isRecord(body)) return null;
  const accessToken = str(body, 'access_token');
  if (accessToken === null) return null;
  const expiresIn = num(body, 'expires_in');
  const refreshToken = str(body, 'refresh_token');
  const refreshExpiresIn = num(body, 'refresh_token_expires_in');
  return {
    accessToken,
    expiresAt: expiresIn === null ? null : now + expiresIn * 1000,
    refreshToken,
    refreshTokenExpiresAt: refreshToken === null || refreshExpiresIn === null ? null : now + refreshExpiresIn * 1000,
  };
}

async function postForm(fetchImpl: FetchLike, url: string, fields: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body: isRecord(body) ? body : null };
}

/* ------------------------------------------------------------- device flow */

export interface DeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  /** Epoch ms after which the code is useless and the flow must restart. */
  readonly expiresAt: number;
  /** Minimum time between polls, as GitHub asked. */
  readonly intervalMs: number;
}

export interface DeviceFlowOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}

/** Step one: ask GitHub for the code the user will type at github.com/login/device. */
export async function requestDeviceCode(clientId: string, options: DeviceFlowOptions = {}): Promise<DeviceCode> {
  const fetchImpl = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  const { status, body } = await postForm(fetchImpl, DEVICE_CODE_URL, { client_id: clientId });
  if (body === null) throw new Error(`GitHub returned an unexpected response (${status}).`);
  const error = str(body, 'error');
  if (error !== null) {
    if (/not found/i.test(error) || /unauthorized_client/i.test(error)) {
      throw new Error('GitHub does not recognise this client id, or Device Flow is not enabled for the GitHub App.');
    }
    throw new Error(str(body, 'error_description') ?? error);
  }
  const deviceCode = str(body, 'device_code');
  const userCode = str(body, 'user_code');
  const verificationUri = str(body, 'verification_uri');
  const expiresIn = num(body, 'expires_in');
  const interval = num(body, 'interval') ?? 5;
  if (deviceCode === null || userCode === null || verificationUri === null || expiresIn === null) {
    throw new Error('GitHub did not return a device code. Is Device Flow enabled on the GitHub App?');
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresAt: now() + expiresIn * 1000,
    intervalMs: Math.max(5, interval) * 1000,
  };
}

export type DevicePoll =
  | { readonly status: 'pending'; readonly intervalMs: number }
  | { readonly status: 'authorized'; readonly tokens: TokenSet }
  | { readonly status: 'failed'; readonly message: string };

/** Step two, repeated: has the user approved yet? */
export async function pollDeviceCode(clientId: string, device: DeviceCode, options: DeviceFlowOptions = {}): Promise<DevicePoll> {
  const fetchImpl = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  const { status, body } = await postForm(fetchImpl, ACCESS_TOKEN_URL, {
    client_id: clientId,
    device_code: device.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (body === null) return { status: 'failed', message: `GitHub returned an unexpected response (${status}).` };
  const tokens = parseTokenResponse(body, now());
  if (tokens !== null) return { status: 'authorized', tokens };
  switch (str(body, 'error')) {
    case 'authorization_pending':
      return { status: 'pending', intervalMs: device.intervalMs };
    case 'slow_down':
      return { status: 'pending', intervalMs: device.intervalMs + 5000 };
    case 'expired_token':
      return { status: 'failed', message: 'The code expired before it was entered. Please start again.' };
    case 'access_denied':
      return { status: 'failed', message: 'Access was declined on GitHub.' };
    default:
      return { status: 'failed', message: str(body, 'error_description') ?? 'GitHub rejected the request.' };
  }
}

/* ---------------------------------------------------------------- web flow */

export interface AuthorizeParams {
  readonly clientId: string;
  /** Must match one of the callback URLs registered on the App, byte for byte. */
  readonly redirectUri: string;
  readonly state: string;
}

/**
 * Where to send the browser to start the web flow. GitHub Apps take no
 * `scope`: what the token may do is the App's permission set, accepted by the
 * user on this screen.
 */
export function authorizeUrl(params: AuthorizeParams): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  return url.toString();
}

export interface CodeExchangeParams {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
}

export type CodeExchange = { readonly ok: true; readonly tokens: TokenSet } | { readonly ok: false; readonly error: string };

/** Web-flow step two, server side: trade the callback `code` for tokens. */
export async function exchangeCode(params: CodeExchangeParams, options: DeviceFlowOptions = {}): Promise<CodeExchange> {
  const fetchImpl = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  const { status, body } = await postForm(fetchImpl, ACCESS_TOKEN_URL, {
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  if (body === null) return { ok: false, error: `GitHub answered ${status} without a body` };
  const error = str(body, 'error');
  if (error !== null) return { ok: false, error };
  const tokens = parseTokenResponse(body, now());
  return tokens === null ? { ok: false, error: 'no_token' } : { ok: true, tokens };
}

/* ----------------------------------------------------------------- refresh */

export interface RefreshParams {
  readonly clientId: string;
  /** Required for tokens issued by the web flow; device-flow tokens refresh without it. */
  readonly clientSecret?: string;
  readonly refreshToken: string;
}

export type RefreshResult =
  /** New pair; the old refresh token is now dead. */
  | { readonly status: 'refreshed'; readonly tokens: TokenSet }
  /** GitHub refused the refresh token (expired, revoked or already used): the sign-in is over. */
  | { readonly status: 'rejected'; readonly error: string }
  /** Could not reach GitHub, or GitHub is misconfigured/unavailable: keep what we have and retry later. */
  | { readonly status: 'unavailable'; readonly message: string };

export async function refreshTokens(params: RefreshParams, options: DeviceFlowOptions = {}): Promise<RefreshResult> {
  const fetchImpl = options.fetch ?? defaultFetch;
  const now = options.now ?? Date.now;
  const fields: Record<string, string> = {
    client_id: params.clientId,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  };
  if (params.clientSecret !== undefined) fields.client_secret = params.clientSecret;
  let response;
  try {
    response = await postForm(fetchImpl, ACCESS_TOKEN_URL, fields);
  } catch (error) {
    return { status: 'unavailable', message: error instanceof Error ? error.message : 'GitHub could not be reached.' };
  }
  const { status, body } = response;
  if (body === null) return { status: 'unavailable', message: `GitHub answered ${status} without a body.` };
  const tokens = parseTokenResponse(body, now());
  if (tokens !== null) return { status: 'refreshed', tokens };
  const error = str(body, 'error') ?? 'unknown_error';
  // Only a refused refresh token ends the session; a misconfigured client id
  // or secret is Geld's problem, not the user's, and must not sign them out.
  if (error === 'bad_refresh_token') return { status: 'rejected', error };
  return { status: 'unavailable', message: str(body, 'error_description') ?? error };
}

/* ------------------------------------------------------------------ revoke */

export interface RevokeParams {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly token: string;
}

/**
 * Invalidate a token at GitHub (sign-out, or retiring an OAuth App token after
 * the user reconnected through the App). Needs the client secret, so only the
 * site can do it; the extension just forgets its copy. Best effort: `false`
 * means GitHub did not confirm, which is not worth surfacing.
 */
export async function revokeToken(params: RevokeParams, options: DeviceFlowOptions = {}): Promise<boolean> {
  const fetchImpl = options.fetch ?? defaultFetch;
  const basic = btoa(`${params.clientId}:${params.clientSecret}`);
  try {
    const response = await fetchImpl(`${API}/applications/${encodeURIComponent(params.clientId)}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ access_token: params.token }),
    });
    return response.status === 204;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ token source */

/** Refresh this long before expiry so a token never dies mid-request. */
export const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;

export function expiresWithin(tokens: TokenSet, now: number, skewMs: number = DEFAULT_REFRESH_SKEW_MS): boolean {
  return tokens.expiresAt !== null && tokens.expiresAt - now <= skewMs;
}

export function isExpired(tokens: TokenSet, now: number): boolean {
  return tokens.expiresAt !== null && tokens.expiresAt <= now;
}

/** Where a home keeps its tokens (`storage.local`, an encrypted cookie…). */
export interface TokenStore {
  load(): Promise<TokenSet | null>;
  save(tokens: TokenSet): Promise<void>;
}

export interface TokenSourceOptions {
  readonly store: TokenStore;
  readonly refresh: (refreshToken: string) => Promise<RefreshResult>;
  readonly now?: () => number;
  readonly skewMs?: number;
}

export type TokenAccess =
  | { readonly status: 'ok'; readonly token: string; readonly refreshed: boolean }
  /** No usable token and no way to get one: the user must sign in again. */
  | { readonly status: 'signed-out'; readonly reason: string }
  /** The token is expired and GitHub could not be reached to refresh it; try again later. */
  | { readonly status: 'unavailable'; readonly message: string };

export interface TokenSource {
  /** A token good for at least `skewMs`, refreshing if needed. `force` refreshes even a fresh-looking token (after a 401). */
  get(options?: { readonly force?: boolean }): Promise<TokenAccess>;
}

/**
 * The single owner of a home's token. Every caller goes through `get`, and
 * concurrent refreshes collapse into one request: GitHub rotates the refresh
 * token on use, so two parallel refreshes would invalidate each other and sign
 * the user out for no reason.
 */
export function createTokenSource(options: TokenSourceOptions): TokenSource {
  const now = options.now ?? Date.now;
  const skewMs = options.skewMs ?? DEFAULT_REFRESH_SKEW_MS;
  let inflight: Promise<TokenAccess> | null = null;

  async function refresh(current: TokenSet): Promise<TokenAccess> {
    if (current.refreshToken === null) {
      return isExpired(current, now())
        ? { status: 'signed-out', reason: 'The sign-in expired and cannot be renewed.' }
        : { status: 'ok', token: current.accessToken, refreshed: false };
    }
    if (current.refreshTokenExpiresAt !== null && current.refreshTokenExpiresAt <= now()) {
      return { status: 'signed-out', reason: 'The sign-in expired after six months without use.' };
    }
    const result = await options.refresh(current.refreshToken);
    switch (result.status) {
      case 'refreshed':
        await options.store.save(result.tokens);
        return { status: 'ok', token: result.tokens.accessToken, refreshed: true };
      case 'rejected':
        return { status: 'signed-out', reason: 'GitHub no longer accepts this sign-in.' };
      case 'unavailable':
        // A token that has not actually expired yet is still good; only a dead one blocks.
        return isExpired(current, now())
          ? { status: 'unavailable', message: result.message }
          : { status: 'ok', token: current.accessToken, refreshed: false };
    }
  }

  return {
    async get(getOptions = {}) {
      const current = await options.store.load();
      if (current === null) return { status: 'signed-out', reason: 'Not signed in.' };
      const force = getOptions.force === true;
      if (!force && !expiresWithin(current, now(), skewMs)) return { status: 'ok', token: current.accessToken, refreshed: false };
      if (force && current.refreshToken === null) {
        // Nothing to refresh with: the caller's 401 was final.
        return { status: 'signed-out', reason: 'GitHub no longer accepts this sign-in.' };
      }
      if (inflight === null) {
        inflight = refresh(current).finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}

/* --------------------------------------------------- OAuth App migration */

/**
 * Shown wherever settings appear (popup, options page, geld.sh) to people
 * whose sign-in still comes from the retired OAuth App. It cannot be
 * dismissed: the old token keeps working, but only the App can be refreshed,
 * receive new permissions, and be used by the dashboard.
 */
export const RECONNECT_COPY = {
  title: 'Sign in again to keep syncing',
  body: 'Geld now connects to GitHub through the Geld GitHub App instead of the older OAuth app. Your settings and gist are unchanged; signing in again just replaces the token. You can then revoke the old "Geld" OAuth app from your GitHub settings.',
  action: 'Sign in again',
} as const;
