import { pageFetch } from '../page-fetch';
import type { RefState } from './refs';

/** A pull request or issue that mentions this one, from the Overview's timeline data. */
export interface TimelineMention {
  readonly href: string;
  readonly ref: string;
  readonly title: string;
  readonly state: RefState;
  readonly login: string;
  readonly avatarUrl: string;
  readonly bot: boolean;
  /** ISO time of the mention. */
  readonly at: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function stateOf(source: Record<string, unknown>): RefState {
  const pull = source.sourceType === 'PullRequest';
  const state = text(source.sourceState).toUpperCase();
  if (pull && source.sourceIsDraft === true && state === 'OPEN') return 'draft';
  if (state === 'MERGED') return 'merged';
  if (state === 'OPEN') return pull ? 'open' : 'issue-open';
  if (state === 'CLOSED') return pull ? 'closed' : /NOT_PLANNED/i.test(text(source.sourceStateReason)) ? 'issue-not-planned' : 'issue-closed';
  return 'unknown';
}

/**
 * The cross-references in one page of `page_data/timeline` (what the Overview's activity panel reads, Nov 2026): each
 * `TIMELINE_ITEM_TYPE_CROSS_REFERENCE` item names the pull request or issue that mentioned this one and who did.
 */
export function parseTimelineMentions(payload: unknown): readonly TimelineMention[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  const mentions: TimelineMention[] = [];
  for (const item of payload.items) {
    if (!isRecord(item) || item.type !== 'TIMELINE_ITEM_TYPE_CROSS_REFERENCE') continue;
    const source = isRecord(item.additionalInfo) && isRecord(item.additionalInfo.crossReference) ? item.additionalInfo.crossReference : null;
    if (source === null) continue;
    const href = text(source.sourceUrl);
    const repo = text(source.sourceRepositoryNameWithOwner);
    const number = typeof source.sourceNumber === 'number' ? source.sourceNumber : Number(text(source.sourceNumber));
    if (href === '' || !Number.isFinite(number)) continue;
    const user = isRecord(item.user) ? item.user : {};
    mentions.push({
      href,
      ref: repo === '' ? `#${number}` : `${repo}#${number}`,
      title: text(source.sourceTitle),
      state: stateOf(source),
      login: text(user.displayLogin),
      avatarUrl: text(user.avatarUrl),
      bot: user.userType === 'USER_TYPE_BOT',
      at: text(item.timestamp),
    });
  }
  return mentions;
}

/** The next page's path from GitHub's `Link` header (`<…?after=…&per_page=25>; rel="next"`), or null on the last page. */
export function nextTimelinePage(link: string | null): string | null {
  if (link === null) return null;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/** Pages read at most: 25 items each, so the mentions of a long conversation's first 200 events. */
const MAX_PAGES = 8;
/** A reading is kept this long before it is asked for again, since a mention can land while the page is open. */
const FRESH_MS = 5 * 60_000;

interface Reading {
  readonly at: number;
  readonly mentions: readonly TimelineMention[] | null;
}

const readings = new Map<string, Reading>();
const inFlight = new Set<string>();

async function readMentions(pullPath: string): Promise<readonly TimelineMention[] | null> {
  const mentions: TimelineMention[] = [];
  let next: string | null = `${pullPath}/page_data/timeline`;
  for (let page = 0; next !== null && page < MAX_PAGES; page += 1) {
    const response = await pageFetch(next, { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' } });
    if (!response.ok) return page === 0 ? null : mentions;
    mentions.push(...parseTimelineMentions(await response.json()));
    next = nextTimelinePage(response.headers.get('link'));
  }
  return mentions;
}

/**
 * The pull requests and issues that mention this one, on the Overview, whose page holds no cross-reference rows (they
 * live in its activity panel, outside the page until opened): read once per pull request and again after `FRESH_MS`,
 * `onLanded` asked for a pass when an answer lands. Null until the first answer, or when the timeline cannot be read.
 */
export function timelineMentionsFor(pullPath: string, onLanded: () => void): readonly TimelineMention[] | null {
  const reading = readings.get(pullPath);
  if ((reading === undefined || Date.now() - reading.at > FRESH_MS) && !inFlight.has(pullPath)) {
    inFlight.add(pullPath);
    void readMentions(pullPath)
      .catch(() => null)
      .then((mentions) => {
        inFlight.delete(pullPath);
        const before = readings.get(pullPath)?.mentions;
        readings.set(pullPath, { at: Date.now(), mentions: mentions ?? before ?? null });
        if (JSON.stringify(before ?? null) !== JSON.stringify(mentions ?? before ?? null)) onLanded();
      });
  }
  return reading?.mentions ?? null;
}

export function resetTimelineMentions(): void {
  readings.clear();
}
