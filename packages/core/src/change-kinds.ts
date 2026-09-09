/**
 * Kinds of change that make a file's diff not worth a reviewer's line-by-line
 * attention regardless of where the file lives: a rename without edits, a
 * permission flip, a binary blob, a deleted file, whitespace-only or
 * comment-only edits, or a diff so large GitHub does not render it either. They are the groups of the
 * built-in "Trivial changes" category (`trivial`); unlike every other group
 * they are decided from what the diff says about the file, not from its path,
 * so their pattern lists are empty and the matcher consults {@link FileFacts}.
 */

export const CHANGE_KIND_IDS = ['renames', 'modes', 'binary', 'deleted', 'whitespace', 'comments', 'large'] as const;
export type ChangeKindId = (typeof CHANGE_KIND_IDS)[number];

export function isChangeKindId(value: unknown): value is ChangeKindId {
  return typeof value === 'string' && CHANGE_KIND_IDS.some((id) => id === value);
}

/** Changed lines (additions + deletions) from which a diff counts as "very large"; GitHub stops rendering around here too. */
export const LARGE_CHANGE_LINES = 1000;

/** What is known about one changed file beyond its path. Everything is optional: a bare path is a valid fact. */
export interface FileFacts {
  readonly path: string;
  readonly additions?: number | null;
  readonly deletions?: number | null;
  /** Kinds the diff itself revealed (see `parseUnifiedDiff`): everything but `large`, which follows from the counts. */
  readonly kinds?: readonly ChangeKindId[];
}

/** Every kind that applies to a file: the diff-derived ones plus `large` when the counts say so. */
export function changeKindsOf(facts: FileFacts): readonly ChangeKindId[] {
  const kinds: ChangeKindId[] = facts.kinds === undefined ? [] : [...facts.kinds];
  const changed = (facts.additions ?? 0) + (facts.deletions ?? 0);
  if (changed >= LARGE_CHANGE_LINES && !kinds.includes('large')) kinds.push('large');
  return kinds;
}
