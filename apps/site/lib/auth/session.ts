import 'server-only';

import type { TokenSet } from '@geld/github';
import { createTokenSource, expiresWithin, refreshTokens } from '@geld/github';
import { cookies } from 'next/headers';

import type { AuthConfig } from './config';
import { authConfig, authOrigin } from './config';
import { open, seal } from './crypto';
import type { Account, Session } from './session-model';
import { parseSession, sessionWithTokens, tokensOfSession } from './session-model';
import { ACCOUNT_COOKIE_NAME } from '@/lib/account-cookie';

export type { Account, Session } from './session-model';

export const SESSION_COOKIE = 'geld_session';
/** Readable by the browser so the header can show the avatar without a request; carries no token. */
export const ACCOUNT_COOKIE = ACCOUNT_COOKIE_NAME;
export const STATE_COOKIE = 'geld_oauth_state';

/**
 * Sliding: rewritten on every refresh, so an active user stays signed in as
 * long as the refresh token lives (six months); an inactive one drops out
 * after a month.
 */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const STATE_MAX_AGE = 60 * 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function secure(): boolean {
  return authOrigin().startsWith('https://');
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** The session as stored, without checking whether its token is still fresh. Reading cookies makes the caller dynamic. */
export async function getSession(config: AuthConfig | null = authConfig()): Promise<Session | null> {
  if (config === null) return null;
  const store = await cookies();
  const sealed = store.get(SESSION_COOKIE)?.value;
  if (sealed === undefined) return null;
  const json = await open(sealed, config.secret);
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return parseSession(parsed);
  } catch {
    return null;
  }
}

export type SessionAccess =
  | { readonly status: 'none' }
  /** A token good for a while; `refreshed` when this call renewed (and rewrote) it. */
  | { readonly status: 'ok'; readonly session: Session; readonly refreshed: boolean }
  /** The token needs renewing but this caller may not write cookies: redirect to `/auth/refresh`. */
  | { readonly status: 'stale'; readonly session: Session }
  /** GitHub refused the refresh (or there is nothing to refresh with): the cookie has been cleared. */
  | { readonly status: 'expired' }
  /** The token is dead and GitHub could not be reached to renew it; the session is kept for a later try. */
  | { readonly status: 'unavailable'; readonly message: string };

/**
 * The signed-in user with a token that will outlive the request, renewing
 * App tokens ahead of expiry. Only Route Handlers and Server Actions may write
 * cookies, so they pass the store (`writable`) and get the refresh done here;
 * pages pass `null` and, on `stale`, redirect to `/auth/refresh`, which does it.
 */
export async function resolveSession(config: AuthConfig | null, writable: CookieStore | null): Promise<SessionAccess> {
  if (config === null) return { status: 'none' };
  const session = await getSession(config);
  if (session === null) return { status: 'none' };

  if (writable === null) {
    // Peek only: is the token fresh enough to use without writing anything?
    return expiresWithin(tokensOfSession(session), Date.now()) ? { status: 'stale', session } : { status: 'ok', session, refreshed: false };
  }

  let current = session;
  const source = createTokenSource({
    store: {
      load: (): Promise<TokenSet | null> => Promise.resolve(tokensOfSession(current)),
      save: async (tokens: TokenSet): Promise<void> => {
        current = sessionWithTokens(current, tokens);
        await writeSession(writable, config, current);
      },
    },
    // Web-flow tokens refresh only with the client secret, which the site holds.
    refresh: (refreshToken) => refreshTokens({ clientId: config.clientId, clientSecret: config.clientSecret, refreshToken }),
  });

  const access = await source.get();
  switch (access.status) {
    case 'ok':
      return { status: 'ok', session: current, refreshed: access.refreshed };
    case 'signed-out':
      clearSession(writable);
      return { status: 'expired' };
    case 'unavailable':
      return { status: 'unavailable', message: access.message };
  }
}

/** Only valid from Route Handlers and Server Actions (cookies are read-only elsewhere). */
export async function writeSession(store: CookieStore, config: AuthConfig, session: Session): Promise<void> {
  const value = await seal(JSON.stringify(session), config.secret);
  store.set(SESSION_COOKIE, value, { httpOnly: true, sameSite: 'lax', secure: secure(), path: '/', maxAge: SESSION_MAX_AGE });
  const account: Account = { login: session.login, avatarUrl: session.avatarUrl };
  store.set(ACCOUNT_COOKIE, JSON.stringify(account), { httpOnly: false, sameSite: 'lax', secure: secure(), path: '/', maxAge: SESSION_MAX_AGE });
}

export function clearSession(store: CookieStore): void {
  store.delete({ name: SESSION_COOKIE, path: '/' });
  store.delete({ name: ACCOUNT_COOKIE, path: '/' });
}

export interface OAuthState {
  readonly state: string;
  readonly next: string;
}

export function writeOAuthState(store: CookieStore, value: OAuthState): void {
  store.set(STATE_COOKIE, JSON.stringify(value), { httpOnly: true, sameSite: 'lax', secure: secure(), path: '/', maxAge: STATE_MAX_AGE });
}

export function readOAuthState(store: CookieStore): OAuthState | null {
  const raw = store.get(STATE_COOKIE)?.value;
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.state !== 'string' || typeof parsed.next !== 'string') return null;
    return { state: parsed.state, next: parsed.next };
  } catch {
    return null;
  }
}

export function clearOAuthState(store: CookieStore): void {
  store.delete({ name: STATE_COOKIE, path: '/' });
}
