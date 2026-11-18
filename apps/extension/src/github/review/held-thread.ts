import type { ReviewItem } from '@geld/review';
import type { Batch } from './panel';
import { itemKey } from './panel';

/** How long a thread open in a round may be missing from the crawl while its comments are still on the page. */
export const HELD_THREAD_MS = 20_000;

export interface HeldThread {
  readonly key: string;
  readonly batch: string;
  readonly item: ReviewItem;
  readonly seen: number;
}

/**
 * The thread open in a round stays in it while GitHub swaps the thread's node: resolving or unresolving answers with
 * the thread's partial, its comments deferred, and until they land the crawl reads no thread. Its last reading
 * stands where it stood, so the row neither closes nor reopens, until the crawl reads it again and it moves to where
 * its new state puts it. Only while one of its comments is still on the page, and for `HELD_THREAD_MS` at most.
 */
export function holdThread(batches: readonly Batch[], key: string | null, held: HeldThread | null, now: number, onPage: (anchor: string) => boolean, openRound: string | null): { readonly batches: readonly Batch[]; readonly held: HeldThread | null; readonly holding: boolean } {
  if (key === null) return { batches, held: null, holding: false };
  for (const batch of batches) {
    const item = batch.items.find((entry) => itemKey(entry.id) === key);
    if (item !== undefined) return { batches, held: { key, batch: batch.key, item, seen: now }, holding: false };
  }
  if (held === null || held.key !== key || now - held.seen > HELD_THREAD_MS) return { batches, held, holding: false };
  if (!held.item.sources.some((source) => onPage(source.anchor))) return { batches, held, holding: false };
  const home = batches.find((batch) => batch.key === held.batch) ?? batches.find((batch) => batch.key === openRound);
  if (home === undefined) return { batches, held, holding: false };
  return { batches: batches.map((batch) => (batch === home ? { ...batch, items: [...batch.items, held.item] } : batch)), held, holding: true };
}
