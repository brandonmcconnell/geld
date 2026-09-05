import { describe, expect, it } from 'vitest';

import { parseAccountCookie } from './account-cookie';

describe('parseAccountCookie', () => {
  it('reads the account cookie among others', () => {
    const value = encodeURIComponent(JSON.stringify({ login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' }));
    expect(parseAccountCookie(`geld-theme=dark; geld_account=${value}; other=1`)).toEqual({
      login: 'octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
    });
  });

  it('ignores missing or malformed values', () => {
    expect(parseAccountCookie('')).toBeNull();
    expect(parseAccountCookie('geld_account=not-json')).toBeNull();
    expect(parseAccountCookie('geld_account=%7B%22login%22%3A1%7D')).toBeNull();
  });
});
