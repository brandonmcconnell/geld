/**
 * Decide whether a clustered item is still open, waiting on a reply, or
 * addressed by later commits. Deterministic signals only; an optional
 * semantic verdict (from AI) can override the `addressed` field.
 */

import type { AddressedEvidence, ReviewItem, ReviewItemStatus } from './model';
import { isBotOnly } from './cluster';

export interface AddressSignals {
  /** Paths the head commit (or later commits after the comment) touched. */
  readonly changedPaths: readonly string[];
  /** Item ids the previous summary had ticked (`done-manual`). */
  readonly manualDoneIds: ReadonlySet<string>;
  /** True when a human replied in the same thread after the last bot comment. */
  readonly humanReplied: boolean;
}

const ADDRESSABLE: ReadonlySet<ReviewItemStatus> = new Set(['open', 'needs-reply', 'addressed']);

/**
 * Apply deterministic status. Resolved/outdated/done-manual win; otherwise a
 * later edit to the same path is `addressed`, a human reply without a path
 * change is `needs-reply`, and everything else stays `open`.
 */
export function applyAddressed(item: ReviewItem, signals: AddressSignals, semantic?: AddressedEvidence): ReviewItem {
  if (signals.manualDoneIds.has(item.id)) {
    return { ...item, status: 'done-manual' };
  }
  if (item.status === 'resolved' || item.status === 'outdated' || item.status === 'done-manual') {
    return semantic === undefined ? item : { ...item, addressed: semantic };
  }
  if (!ADDRESSABLE.has(item.status)) return item;

  let status: ReviewItemStatus = item.status;
  const evidence: string[] = [];
  if (item.path !== undefined && signals.changedPaths.includes(item.path)) {
    status = 'addressed';
    evidence.push(`later commit touched ${item.path}`);
  } else if (signals.humanReplied && isBotOnly({ ...item, sources: item.sources })) {
    status = 'needs-reply';
    evidence.push('human replied in-thread');
  } else if (signals.humanReplied && !isBotOnly(item)) {
    status = 'needs-reply';
    evidence.push('author replied');
  }

  const addressed = semantic ?? (evidence.length > 0 ? { verdict: status === 'addressed' ? 'yes' : 'unclear', evidence } : undefined);
  if (semantic !== undefined && semantic.verdict === 'yes' && status === 'open') status = 'addressed';
  if (semantic !== undefined && semantic.verdict === 'no' && status === 'addressed') status = 'open';

  if (addressed === undefined) return { ...item, status };
  return { ...item, status, addressed };
}

export function applyAddressedAll(
  items: readonly ReviewItem[],
  forItem: (item: ReviewItem) => AddressSignals,
  semanticById: ReadonlyMap<string, AddressedEvidence> = new Map(),
): readonly ReviewItem[] {
  return items.map((item) => applyAddressed(item, forItem(item), semanticById.get(item.id)));
}
