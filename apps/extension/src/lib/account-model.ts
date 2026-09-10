import type { TokenKind, TokenSet } from '@geld/github';
import { tokenKind } from '@geld/github';

/** The GitHub account linked on this device (see `account.ts` for where it is stored). */
export interface GitHubAccount {
  readonly login: string;
  readonly id: number;
  readonly avatarUrl: string;
  /**
   * `app`: a Geld GitHub App user access token (expires, refreshable).
   * `oauth`: a token from the retired OAuth App; still works for the gist but
   * cannot be refreshed or gain permissions, so the UI asks to sign in again.
   */
  readonly auth: TokenKind;
  /** The current access token. */
  readonly token: string;
  /** Epoch ms; `null` for tokens that do not expire. */
  readonly expiresAt: number | null;
  readonly refreshToken: string | null;
  readonly refreshTokenExpiresAt: number | null;
  /** Scopes granted to an OAuth App token, for diagnostics; empty for App tokens. */
  readonly scopes: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Accounts saved before the GitHub App carried only `{ login, id, avatarUrl,
 * token, scopes }`. They become non-expiring `oauth` accounts, which keeps
 * syncing and triggers the "sign in again" prompt. Anything unreadable is
 * dropped (the user simply signs in again).
 */
export function migrateStoredAccount(value: unknown): GitHubAccount | null {
  if (!isRecord(value)) return null;
  const { login, id, avatarUrl, token } = value;
  if (typeof login !== 'string' || typeof id !== 'number' || typeof avatarUrl !== 'string' || typeof token !== 'string' || token === '') return null;
  const scopes = Array.isArray(value.scopes) ? value.scopes.filter((scope): scope is string => typeof scope === 'string') : [];
  return { login, id, avatarUrl, auth: tokenKind(token), token, expiresAt: null, refreshToken: null, refreshTokenExpiresAt: null, scopes };
}

export function tokensOf(account: GitHubAccount): TokenSet {
  return { accessToken: account.token, expiresAt: account.expiresAt, refreshToken: account.refreshToken, refreshTokenExpiresAt: account.refreshTokenExpiresAt };
}

export function withTokens(account: GitHubAccount, tokens: TokenSet): GitHubAccount {
  return {
    ...account,
    auth: tokenKind(tokens.accessToken),
    token: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
  };
}
