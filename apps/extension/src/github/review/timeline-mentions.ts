import { pageFetch } from '../page-fetch';
import type { RefState } from './refs';
import { parseTimelineEvents, type TimelineEvent } from './timeline-events';

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

/**
 * Pages read at most: 25 items each, so a conversation's first 1,000 items. The pages run oldest first, so a longer
 * timeline is read without its newest items, and the reading says it is not complete.
 */
const MAX_PAGES = 40;
/** A reading is kept this long before it is asked for again, since a mention or an event can land while the page is open. */
const FRESH_MS = 5 * 60_000;

export interface Timeline {
  readonly mentions: readonly TimelineMention[];
  readonly events: readonly TimelineEvent[];
  /** False when the timeline ran past `MAX_PAGES`: what was read is its oldest part. */
  readonly complete: boolean;
}

interface Reading {
  readonly at: number;
  readonly timeline: Timeline | null;
}

const readings = new Map<string, Reading>();
const inFlight = new Set<string>();

async function readTimeline(pullPath: string): Promise<Timeline | null> {
  const mentions: TimelineMention[] = [];
  const events: TimelineEvent[] = [];
  let next: string | null = `${pullPath}/page_data/timeline`;
  for (let page = 0; next !== null && page < MAX_PAGES; page += 1) {
    const response = await pageFetch(next, { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' } });
    // A page that fails leaves the reading incomplete: no answer, so the last complete one stands rather than a shorter list.
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    mentions.push(...parseTimelineMentions(payload));
    events.push(...parseTimelineEvents(payload));
    next = nextTimelinePage(response.headers.get('link'));
  }
  return { mentions, events, complete: next === null };
}

/**
 * The Overview's timeline data, which its page holds no rows for (they live in its activity panel, outside the page
 * until opened): read once per pull request and again after `FRESH_MS`, `onLanded` asked for a pass when an answer
 * changes what was read. Null until the first answer, or when the timeline cannot be read.
 */
function timelineFor(pullPath: string, onLanded: () => void): Timeline | null {
  const reading = readings.get(pullPath);
  if ((reading === undefined || Date.now() - reading.at > FRESH_MS) && !inFlight.has(pullPath)) {
    inFlight.add(pullPath);
    void readTimeline(pullPath)
      .catch(() => null)
      .then((timeline) => {
        inFlight.delete(pullPath);
        const before = readings.get(pullPath)?.timeline ?? null;
        const after = timeline ?? before;
        readings.set(pullPath, { at: Date.now(), timeline: after });
        if (JSON.stringify(before) !== JSON.stringify(after)) onLanded();
      });
  }
  return reading?.timeline ?? null;
}

/** The pull requests and issues that mention this one, on the Overview: null until the timeline has been read. */
export function timelineMentionsFor(pullPath: string, onLanded: () => void): readonly TimelineMention[] | null {
  return timelineFor(pullPath, onLanded)?.mentions ?? null;
}

/** The pull request's own events (closed, renamed, a review requested…), on the Overview, and whether the whole timeline was read: null until it has been. */
export function timelineEventsFor(pullPath: string, onLanded: () => void): Pick<Timeline, 'events' | 'complete'> | null {
  return timelineFor(pullPath, onLanded);
}

export function resetTimelineMentions(): void {
  readings.clear();
}
