import { migrateStoredAccount, tokensOf, withTokens } from './account-model';

describe('migrateStoredAccount', () => {
  it('turns a pre-App account into a non-expiring oauth account', () => {
    expect(migrateStoredAccount({ login: 'octocat', id: 1, avatarUrl: 'https://a/b.png', token: 'gho_old', scopes: ['gist'] })).toEqual({
      login: 'octocat',
      id: 1,
      avatarUrl: 'https://a/b.png',
      auth: 'oauth',
      token: 'gho_old',
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      scopes: ['gist'],
    });
  });

  it('recognises an App token that was stored without the new fields', () => {
    expect(migrateStoredAccount({ login: 'o', id: 1, avatarUrl: 'u', token: 'ghu_x' })?.auth).toBe('app');
  });

  it('drops anything unreadable so the user just signs in again', () => {
    expect(migrateStoredAccount(null)).toBeNull();
    expect(migrateStoredAccount({ login: 'o' })).toBeNull();
    expect(migrateStoredAccount({ login: 'o', id: 1, avatarUrl: 'u', token: '' })).toBeNull();
  });
});

describe('withTokens / tokensOf', () => {
  it('round-trips the token fields and re-derives the kind', () => {
    const legacy = migrateStoredAccount({ login: 'o', id: 1, avatarUrl: 'u', token: 'gho_old', scopes: ['gist'] });
    expect(legacy).not.toBeNull();
    if (legacy === null) return;
    const tokens = { accessToken: 'ghu_new', expiresAt: 10, refreshToken: 'ghr_1', refreshTokenExpiresAt: 20 };
    const upgraded = withTokens(legacy, tokens);
    expect(upgraded.auth).toBe('app');
    expect(upgraded.login).toBe('o');
    expect(tokensOf(upgraded)).toEqual(tokens);
  });
});
