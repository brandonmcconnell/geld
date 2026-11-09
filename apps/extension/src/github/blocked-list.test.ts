import { describe, expect, it } from 'vitest';
import { blockedLoginsIn, blockedUsersUrl } from './blocked-list';

/** A Blocked users page as GitHub serves it (Nov 2026), names replaced: the list rides in the page as JSON. */
function page(items: readonly Record<string, unknown>[], isOrganization: boolean): string {
  const json = JSON.stringify({ props: { items, isOrganization } });
  return `<html><body><script type="application/json" data-target="react-partial.embeddedData">{"props":{"other":true}}</script><script type="application/json" data-target="react-partial.embeddedData">${json}</script></body></html>`;
}

describe('blockedLoginsIn', () => {
  it('reads every blocked login, leaving out a block that has run out', () => {
    const html = page(
      [
        { id: '1', login: 'Blocked-One', blockedAt: '2026-11-09T03:24:05Z', expiresAt: null, blockedByLogin: 'owner', note: '' },
        { id: '2', login: 'blocked-for-a-day', blockedAt: '2026-11-01T00:00:00Z', expiresAt: '2026-11-02T00:00:00Z' },
        { id: '3', login: 'blocked-for-a-week', blockedAt: '2026-11-08T00:00:00Z', expiresAt: '2026-11-15T00:00:00Z' },
      ],
      true,
    );
    expect(blockedLoginsIn(html, Date.parse('2026-11-09T04:00:00Z'))).toEqual(['Blocked-One', 'blocked-for-a-week']);
  });

  it('finds nobody on an empty list or a page without one', () => {
    expect(blockedLoginsIn(page([], false))).toEqual([]);
    expect(blockedLoginsIn('<html><body>Not Found</body></html>')).toEqual([]);
  });
});

describe('blockedUsersUrl', () => {
  it('names the reader’s page or an organisation’s', () => {
    expect(blockedUsersUrl('personal')).toBe('https://github.com/settings/blocked_users');
    expect(blockedUsersUrl('org', 'acme')).toBe('https://github.com/organizations/acme/settings/blocked_users');
  });
});
