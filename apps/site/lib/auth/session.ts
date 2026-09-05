import 'server-only';

import { cookies } from 'next/headers';

import type { AuthConfig } from './config';
import { authConfig, authOrigin } from './config';
import { open, seal } from './crypto';
import { ACCOUNT_COOKIE_NAME } from '@/lib/account-cookie';

/** What the encrypted session cookie holds. The token never leaves the server. */
export interface Session {
  readonly token: string;
  readonly login: string;
  readonly avatarUrl: string;
}

/** Non-secret part of the session, mirrored in a readable cookie for the header UI. */
export interface Account {
  readonly login: string;
  readonly avatarUrl: string;
}

export const SESSION_COOKIE = 'geld_session';
/** Readable by the browser so the header can show the avatar without a request; carries no token. */
export const ACCOUNT_COOKIE = ACCOUNT_COOKIE_NAME;
export const STATE_COOKIE = 'geld_oauth_state';

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const STATE_MAX_AGE = 60 * 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSession(value: unknown): Session | null {
  if (!isRecord(value)) return null;
  const { token, login, avatarUrl } = value;
  if (typeof token !== 'string' || typeof login !== 'string' || typeof avatarUrl !== 'string') return null;
  return { token, login, avatarUrl };
}

function secure(): boolean {
  return authOrigin().startsWith('https://');
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** The signed-in user, or `null`. Reading cookies makes the caller dynamic. */
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
