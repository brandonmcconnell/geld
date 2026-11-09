import { browser } from 'wxt/browser';
import type { BlockedUsersRequest } from '../lib/messages';
import { isBlockedUsersResponse } from '../lib/messages';
import type { BlockedBy } from './blocked-list';
import { blockedUsersUrl } from './blocked-list';

/**
 * Who the reader has blocked, read from GitHub's own "Blocked users" settings
 * pages: theirs (`/settings/blocked_users`) and, for a repository owned by an
 * organisation they moderate, the organisation's
 * (`/organizations/<org>/settings/blocked_users`). GitHub shows a block nowhere
 * else: not on the pull request, the hover card or the lists (checked signed in,
 * Nov 2026). Each page embeds its list as JSON:
 * `{"props":{"items":[{"login","blockedAt","expiresAt",…}],"isOrganization":…}}`.
 * The background reads the pages, so the 404 a member who is not a moderator
 * gets (and a repository owned by a person) stays out of the page's console.
 * Read once per page load and kept through GitHub's in-page navigation.
 */

const lists = new Map<string, readonly string[] | null>();

function read(url: string, onLanded: () => void): readonly string[] {
  const known = lists.get(url);
  if (known !== undefined) return known ?? [];
  lists.set(url, null);
  const request: BlockedUsersRequest = { type: 'geld:blocked-users', url };
  void browser.runtime
    .sendMessage(request)
    .then((response: unknown) => {
      const logins = isBlockedUsersResponse(response) && response.ok ? response.logins : [];
      lists.set(url, logins);
      if (logins.length > 0) onLanded();
    })
    .catch(() => lists.set(url, []));
  return [];
}

/**
 * Everyone blocked for a pull request in `owner`'s repository, by lowercased
 * login, and by whom: the reader, the owner's organisation, or both. Answered from
 * memory; the first ask starts the reads and `onLanded` fires when a list with
 * anyone on it arrives. Only on github.com and signed in.
 */
export function blockedFor(owner: string, viewer: string, onLanded: () => void): ReadonlyMap<string, BlockedBy> {
  const blocked = new Map<string, BlockedBy>();
  if (location.hostname !== 'github.com' || viewer === '') return blocked;
  const org = owner !== '' && owner.toLowerCase() !== viewer.toLowerCase() ? read(blockedUsersUrl('org', owner), onLanded) : [];
  const personal = read(blockedUsersUrl('personal'), onLanded);
  for (const login of org) blocked.set(login.toLowerCase(), { org: true, personal: false });
  for (const login of personal) blocked.set(login.toLowerCase(), { org: blocked.get(login.toLowerCase())?.org ?? false, personal: true });
  return blocked;
}
