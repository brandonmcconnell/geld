import type { CommentReaction } from '@geld/review';
import { pageFetch } from '../page-fetch';
import { reactionsOf } from './crawler';
import { fragmentHeaders } from './deeplink';
import { closestAtHome } from './teleport';

/**
 * A review bot's reaction to the comment that asked for it (Greptile's 👍)
 * says it took the run, and it lands minutes after the request. A top-level
 * comment has no socket channel, so GitHub never tells an open page about it
 * and the reaction showed only after a reload. While a trigger is waiting on
 * one (`awaitingReaction`), its own partial, the `data-url` GitHub renders
 * the comment from, is read again on a clock and the reactions found there
 * are laid over the page's (`withFetchedReactions`). GitHub's node is left as
 * it is.
 */
export const REACTION_POLL_MS = 15_000;

const CONTAINER = '.js-comment-container[data-url]';

const fetched = new Map<string, readonly CommentReaction[]>();
const lastAsked = new Map<string, number>();
const inFlight = new Set<string>();

function partialUrlOf(anchor: string): string | null {
  const node = document.getElementById(anchor);
  const url = node === null ? null : closestAtHome(node, CONTAINER)?.getAttribute('data-url') ?? null;
  return url !== null && url.startsWith('/') ? url : null;
}

async function readReactions(url: string, anchor: string): Promise<readonly CommentReaction[] | null> {
  try {
    const response = await pageFetch(url, { headers: fragmentHeaders(), credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    const node = new DOMParser().parseFromString(await response.text(), 'text/html').getElementById(anchor);
    return node === null ? null : reactionsOf(node);
  } catch {
    return null;
  }
}

function key(reactions: readonly CommentReaction[]): string {
  return reactions.map((reaction) => `${reaction.login}\n${reaction.emoji}`).sort().join('\n');
}

/**
 * Reads each waiting trigger's reactions again, at most once per `REACTION_POLL_MS`, and calls `landed` when an
 * answer changes what is known. The time the next read is due, or null when nothing is waiting.
 */
export function pollTriggerReactions(anchors: readonly string[], now: number, landed: () => void): number | null {
  if (anchors.length === 0) return null;
  for (const anchor of anchors) {
    const last = lastAsked.get(anchor);
    if (inFlight.has(anchor) || (last !== undefined && now - last < REACTION_POLL_MS)) continue;
    const url = partialUrlOf(anchor);
    if (url === null) continue;
    lastAsked.set(anchor, now);
    inFlight.add(anchor);
    void readReactions(url, anchor).then((reactions) => {
      inFlight.delete(anchor);
      if (reactions === null) return;
      const before = fetched.get(anchor);
      fetched.set(anchor, reactions);
      if (before === undefined ? reactions.length > 0 : key(before) !== key(reactions)) landed();
    });
  }
  return now + REACTION_POLL_MS;
}

/** The comment's reactions as the page shows them, with any its partial has shown since. */
export function withFetchedReactions(anchor: string, page: readonly CommentReaction[] | undefined): readonly CommentReaction[] | undefined {
  const extra = fetched.get(anchor);
  if (extra === undefined || extra.length === 0) return page;
  const out = new Map((page ?? []).map((reaction) => [`${reaction.login}\n${reaction.emoji}`, reaction] as const));
  for (const reaction of extra) out.set(`${reaction.login}\n${reaction.emoji}`, reaction);
  return [...out.values()];
}

/** For a new page: what was read belongs to the comments of the last one. */
export function resetTriggerReactions(): void {
  fetched.clear();
  lastAsked.clear();
  inFlight.clear();
}
