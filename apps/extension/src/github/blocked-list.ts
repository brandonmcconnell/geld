/** How GitHub's "Blocked users" settings pages list who is blocked (see `blocked-users.ts`). */

export type BlockScope = 'personal' | 'org';

/** Who has blocked someone: the repository's organisation, the reader, or both (each list is read on its own). */
export interface BlockedBy {
  readonly org: boolean;
  readonly personal: boolean;
}

const SCRIPT_JSON = /<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The logins a Blocked users page lists, leaving out blocks that have expired by `now`. */
export function blockedLoginsIn(html: string, now: number = Date.now()): readonly string[] {
  const logins: string[] = [];
  for (const match of html.matchAll(SCRIPT_JSON)) {
    const text = match[1] ?? '';
    if (!text.includes('"blockedAt"')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const props = isRecord(parsed) ? parsed.props : undefined;
    const items = isRecord(props) && Array.isArray(props.items) ? props.items : [];
    for (const item of items) {
      if (!isRecord(item) || typeof item.login !== 'string' || item.login === '') continue;
      const expires = typeof item.expiresAt === 'string' ? Date.parse(item.expiresAt) : Number.NaN;
      if (!Number.isNaN(expires) && expires <= now) continue;
      if (!logins.includes(item.login)) logins.push(item.login);
    }
  }
  return logins;
}

/** The settings page to read: the reader's own, or an organisation's. */
export function blockedUsersUrl(scope: BlockScope, org = ''): string {
  return scope === 'personal' ? 'https://github.com/settings/blocked_users' : `https://github.com/organizations/${encodeURIComponent(org)}/settings/blocked_users`;
}
