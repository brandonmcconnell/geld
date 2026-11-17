/** What applying a triage fix takes and gives back, on every host; the runner is `apply-runner.ts`. */

/** The commit's message: the finding's title for one fix, a line per finding for several. */
export function commitMessage(titles: readonly string[]): string {
  if (titles.length === 1) return `Apply suggestion from Geld triage\n\n${titles[0] ?? ''}`;
  return `Apply ${titles.length} suggestions from Geld triage\n\n${titles.map((title) => `- ${title}`).join('\n')}`;
}

export interface FixToApply {
  /** Every comment anchor of the thread the fix replaces the lines of. */
  readonly threadAnchors: readonly string[];
  readonly path: string;
  readonly replacement: readonly string[];
  readonly summary: string;
  readonly title: string;
  readonly headSha: string;
  /** The lines the fix replaces, at the head. */
  readonly start?: number;
  readonly end?: number;
  /** A suggestion reply Geld posted for this fix whose commit was refused: committed instead of posting another. */
  readonly pendingReply?: number | null;
}

export type ApplyResult =
  | { readonly ok: true; readonly replyAnchor: string }
  /**
   * `posted`: the suggestion reply stands in the thread, so GitHub's own Commit suggestion can still take it, and
   * `reply` names it when its id was read.
   */
  | { readonly ok: false; readonly reason: string; readonly posted: boolean; readonly reply?: { readonly anchor: string; readonly id: number } };

/**
 * A batch's fixes and the ones left out of it: a fix replaces its whole line range, so two whose ranges in one file
 * overlap would each rewrite the other's lines. The first of them goes in the batch; the rest wait for their own run.
 */
export function splitOverlapping<T extends { readonly path: string; readonly start: number; readonly end: number }>(fixes: readonly T[]): { readonly batch: readonly T[]; readonly overlapping: readonly T[] } {
  const batch: T[] = [];
  const overlapping: T[] = [];
  for (const fix of fixes) {
    const clash = batch.some((taken) => taken.path === fix.path && fix.start <= taken.end && taken.start <= fix.end);
    (clash ? overlapping : batch).push(fix);
  }
  return { batch, overlapping };
}

/** How a host posts and commits fixes, and resolves a thread. */
export interface FixApplier {
  /** Post each fix and commit them together; results in `fixes`' order. */
  readonly apply: (fixes: readonly FixToApply[]) => Promise<readonly ApplyResult[]>;
  /** Resolve a thread by its key (the first comment's anchor), only if it is still open: never unresolve. */
  readonly resolve: (threadKey: string) => void;
  /** After something was posted: bring the page up to date. */
  readonly afterPost?: () => Promise<void>;
}

/** The parts of a triage visit applying reads and writes. */
export interface ApplyVisit {
  readonly busy: Map<string, 'fix' | 'writing'>;
  readonly errors: Map<string, string>;
}

export const OVERLAP_WORDS = 'Its lines overlap another fix’s, so it was left out of that commit. Triage again to fit it to the new code.';

