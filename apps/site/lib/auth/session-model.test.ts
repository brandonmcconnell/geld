import { describe, expect, it } from 'vitest';

import { parseSession, sessionFromTokens, sessionWithTokens, tokensOfSession } from './session-model';

describe('parseSession', () => {
  it('reads a cookie written before the GitHub App as a non-expiring oauth session', () => {
    expect(parseSession({ token: 'gho_old', login: 'octocat', avatarUrl: 'https://a/b.png' })).toEqual({
      auth: 'oauth',
      token: 'gho_old',
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      login: 'octocat',
      avatarUrl: 'https://a/b.png',
    });
  });

  it('reads an App session with its refresh fields', () => {
    const session = parseSession({ token: 'ghu_x', expiresAt: 10, refreshToken: 'ghr_1', refreshTokenExpiresAt: 20, login: 'o', avatarUrl: 'u' });
    expect(session?.auth).toBe('app');
    expect(session === null ? null : tokensOfSession(session)).toEqual({ accessToken: 'ghu_x', expiresAt: 10, refreshToken: 'ghr_1', refreshTokenExpiresAt: 20 });
  });

  it('rejects anything without a token, login and avatar', () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession({ token: '', login: 'o', avatarUrl: 'u' })).toBeNull();
    expect(parseSession({ token: 'ghu_x', login: 'o' })).toBeNull();
  });
});

describe('sessionWithTokens / sessionFromTokens', () => {
  const tokens = { accessToken: 'ghu_new', expiresAt: 1, refreshToken: 'ghr_2', refreshTokenExpiresAt: 2 };

  it('replaces the token fields and re-derives the kind, keeping the account', () => {
    const legacy = parseSession({ token: 'gho_old', login: 'o', avatarUrl: 'u' });
    expect(legacy).not.toBeNull();
    if (legacy === null) return;
    expect(sessionWithTokens(legacy, tokens)).toEqual({ auth: 'app', login: 'o', avatarUrl: 'u', token: 'ghu_new', expiresAt: 1, refreshToken: 'ghr_2', refreshTokenExpiresAt: 2 });
  });

  it('builds a fresh session from an exchange result', () => {
    expect(sessionFromTokens(tokens, { login: 'o', avatarUrl: 'u' })).toEqual({ auth: 'app', login: 'o', avatarUrl: 'u', token: 'ghu_new', expiresAt: 1, refreshToken: 'ghr_2', refreshTokenExpiresAt: 2 });
  });
});
