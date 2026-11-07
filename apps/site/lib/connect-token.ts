import { TEAMS_SCOPES } from '@geld/review/link-resolvers/index';

import { SITE_URL } from './site';

/**
 * Geld's token proxy for connected services whose token exchange needs Geld's client secret: it adds the secret to
 * a code (with the reader's PKCE verifier) or a refresh token, asks the provider, and hands the tokens back. Nothing
 * is stored or logged here; the tokens live in the reader's browser.
 */

export interface ProxyService {
  readonly tokenUrl: string;
  readonly redirect: string;
  readonly scope: string | null;
  readonly clientIdEnv: string;
  readonly secretEnv: string;
}

export const PROXY_SERVICES: Readonly<Record<string, ProxyService>> = {
  teams: {
    tokenUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
    redirect: `${SITE_URL}/connect/teams/callback`,
    scope: TEAMS_SCOPES.join(' '),
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    secretEnv: 'MICROSOFT_CLIENT_SECRET',
  },
  discord: {
    tokenUrl: 'https://discord.com/api/v10/oauth2/token',
    redirect: `${SITE_URL}/connect/discord/callback`,
    scope: null,
    clientIdEnv: 'DISCORD_CLIENT_ID',
    secretEnv: 'DISCORD_CLIENT_SECRET',
  },
};

export type TokenRequest = { readonly grant: 'code'; readonly code: string; readonly verifier: string } | { readonly grant: 'refresh'; readonly refresh: string };

const MAX_FIELD = 4096;
const field = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= MAX_FIELD;

export function parseTokenRequest(body: unknown): TokenRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = Object.fromEntries(Object.entries(body));
  if (value.grant === 'code' && field(value.code) && field(value.verifier)) return { grant: 'code', code: value.code, verifier: value.verifier };
  if (value.grant === 'refresh' && field(value.refresh)) return { grant: 'refresh', refresh: value.refresh };
  return null;
}

export type TokenAnswer = { readonly ok: true; readonly accessToken: string; readonly refreshToken: string | null; readonly expiresIn: number | null } | { readonly ok: false; readonly error: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function exchangeToken(service: ProxyService, request: TokenRequest, env: Readonly<Record<string, string | undefined>>, fetch: Fetch): Promise<{ readonly status: number; readonly answer: TokenAnswer }> {
  const clientId = env[service.clientIdEnv] ?? '';
  const secret = env[service.secretEnv] ?? '';
  if (clientId === '' || secret === '') return { status: 503, answer: { ok: false, error: 'This sign-in is not set up on geld.sh yet' } };
  const form = new URLSearchParams({ client_id: clientId, client_secret: secret, redirect_uri: service.redirect });
  if (service.scope !== null) form.set('scope', service.scope);
  if (request.grant === 'code') {
    form.set('grant_type', 'authorization_code');
    form.set('code', request.code);
    form.set('code_verifier', request.verifier);
  } else {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', request.refresh);
  }
  let body: unknown;
  try {
    const response = await fetch(service.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString(), signal: AbortSignal.timeout(15_000) });
    body = await response.json();
  } catch {
    return { status: 502, answer: { ok: false, error: 'The provider could not be reached' } };
  }
  const value = typeof body === 'object' && body !== null ? Object.fromEntries(Object.entries(body)) : {};
  if (typeof value.access_token !== 'string') {
    const description = typeof value.error_description === 'string' ? value.error_description.split(/\r?\n/)[0] : null;
    return { status: 400, answer: { ok: false, error: description ?? (typeof value.error === 'string' ? value.error : 'The provider did not issue a token') } };
  }
  return {
    status: 200,
    answer: {
      ok: true,
      accessToken: value.access_token,
      refreshToken: typeof value.refresh_token === 'string' ? value.refresh_token : null,
      expiresIn: typeof value.expires_in === 'number' ? value.expires_in : null,
    },
  };
}
