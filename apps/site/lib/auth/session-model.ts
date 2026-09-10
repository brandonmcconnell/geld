import type { TokenKind, TokenSet } from '@geld/github';
import { tokenKind } from '@geld/github';

/**
 * What the encrypted session cookie holds. The token never leaves the server.
 * Pure shape and conversions live here so they can be unit tested; reading and
 * writing the cookie itself is in `session.ts`.
 */
export interface Session {
  /** `app` for Geld GitHub App tokens (refreshable); `oauth` for tokens from the retired OAuth App. */
  readonly auth: TokenKind;
  readonly token: string;
  /** Epoch ms; `null` for tokens that do not expire. */
  readonly expiresAt: number | null;
  readonly refreshToken: string | null;
  readonly refreshTokenExpiresAt: number | null;
  readonly login: string;
  readonly avatarUrl: string;
}

/** Non-secret part of the session, mirrored in a readable cookie for the header UI. */
export interface Account {
  readonly login: string;
  readonly avatarUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Cookies written before the GitHub App held `{ token, login, avatarUrl }`
 * only; they read as non-expiring `oauth` sessions, which keep working and
 * make the settings page ask the user to sign in again.
 */
export function parseSession(value: unknown): Session | null {
  if (!isRecord(value)) return null;
  const { token, login, avatarUrl } = value;
  if (typeof token !== 'string' || token === '' || typeof login !== 'string' || typeof avatarUrl !== 'string') return null;
  return {
    auth: tokenKind(token),
    token,
    expiresAt: optionalNumber(value.expiresAt),
    refreshToken: optionalString(value.refreshToken),
    refreshTokenExpiresAt: optionalNumber(value.refreshTokenExpiresAt),
    login,
    avatarUrl,
  };
}

export function tokensOfSession(session: Session): TokenSet {
  return { accessToken: session.token, expiresAt: session.expiresAt, refreshToken: session.refreshToken, refreshTokenExpiresAt: session.refreshTokenExpiresAt };
}

export function sessionWithTokens(session: Session, tokens: TokenSet): Session {
  return {
    ...session,
    auth: tokenKind(tokens.accessToken),
    token: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
  };
}

export function sessionFromTokens(tokens: TokenSet, account: Account): Session {
  return sessionWithTokens({ auth: 'app', token: '', expiresAt: null, refreshToken: null, refreshTokenExpiresAt: null, ...account }, tokens);
}
