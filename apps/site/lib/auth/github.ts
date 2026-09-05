import 'server-only';

import type { AuthConfig } from './config';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';

const HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'geld.sh' };

export function authorizeUrl(config: AuthConfig, redirectUri: string, state: string, scope: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

export type TokenExchange = { readonly ok: true; readonly token: string; readonly scope: string } | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Web-flow step two: trade the callback `code` for an access token. */
export async function exchangeCode(config: AuthConfig, code: string, redirectUri: string): Promise<TokenExchange> {
  const response = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }),
    cache: 'no-store',
  });
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) return { ok: false, error: `GitHub answered ${response.status} without a body` };
  if (typeof body.error === 'string') return { ok: false, error: body.error };
  const token = body.access_token;
  if (typeof token !== 'string' || token === '') return { ok: false, error: 'no_token' };
  return { ok: true, token, scope: typeof body.scope === 'string' ? body.scope : '' };
}

/** Best-effort revocation on sign-out; failures are ignored (the cookie is gone either way). */
export async function revokeToken(config: AuthConfig, token: string): Promise<void> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  try {
    await fetch(`${API}/applications/${encodeURIComponent(config.clientId)}/token`, {
      method: 'DELETE',
      headers: { ...HEADERS, Accept: 'application/vnd.github+json', Authorization: `Basic ${basic}`, 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ access_token: token }),
      cache: 'no-store',
    });
  } catch {
    // Network failure while signing out is not worth surfacing.
  }
}
