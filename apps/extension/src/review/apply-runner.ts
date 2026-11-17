import type { GeldSettings } from '@geld/core';
import type { GeldPrMeta, RawComment } from '@geld/review';
import { isOpenStatus } from '@geld/review';
import { countUsage } from '../lib/usage-count';
import { markSuggestionApplied, markSuggestionPosted, pendingReplyFor, threadKeyOf, triageSuggestions } from './ai';
import { OVERLAP_WORDS, splitOverlapping } from './apply-fixes';
import type { ApplyVisit, FixApplier } from './apply-fixes';

export type { ApplyResult, ApplyVisit, FixApplier, FixToApply } from './apply-fixes';

/**
 * Applying the triage's fixes, the same on every host: which fixes go in one commit, what each one's result says, and
 * which threads are resolved after. A host lends an `FixApplier`, which posts the fixes and commits them its own way:
 * GitHub through its pull request page's suggestion requests, GitLab through its suggestions API.
 */

/** Apply the fixes `keys` names that can go now, in one commit, and resolve the threads they answer when `resolves()` says so. */
export function runFixes(keys: readonly string[], ctx: {
  readonly meta: GeldPrMeta;
  readonly comments: readonly RawComment[];
  readonly settings: GeldSettings;
  readonly visit: ApplyVisit;
  readonly applier: FixApplier;
  readonly reapply: () => void;
  /** Read when the commit lands: the reader's setting may have changed and the repository's config arrived meanwhile. */
  readonly resolves: () => boolean;
  /** Whether to resolve is not known yet (the repository's config is being read): Apply waits. */
  readonly waiting?: () => boolean;
}): void {
  const { meta, settings, visit: triage } = ctx;
  const listed = triageSuggestions(meta, settings);
  const candidates = keys.flatMap((key) => {
    const found = listed.find((entry) => entry.entry.key === key);
    const replacement = found?.entry.replacement ?? null;
    return found === undefined || replacement === null || !found.current || found.entry.state === 'applied' || triage.busy.has(key) ? [] : [{ key, found, replacement, path: found.entry.path, start: found.entry.start, end: found.entry.end }];
  });
  const { batch: picked, overlapping } = splitOverlapping(candidates);
  if (picked.length === 0 || ctx.waiting?.() === true) return;
  for (const { key } of overlapping) triage.errors.set(key, OVERLAP_WORDS);
  for (const { key } of picked) {
    triage.busy.set(key, 'fix');
    triage.errors.delete(key);
  }
  ctx.reapply();
  const fixes = picked.map(({ key, found, replacement }) => ({ threadAnchors: found.item.sources.map((source) => source.anchor), path: found.entry.path, start: found.entry.start, end: found.entry.end, replacement, summary: found.entry.summary, title: found.item.title, headSha: meta.headSha, pendingReply: pendingReplyFor(key, ctx.comments) }));
  void ctx.applier.apply(fixes).then(async (results) => {
    const resolves = ctx.resolves();
    let changed = false;
    for (const [index, { key, found }] of picked.entries()) {
      triage.busy.delete(key);
      const result = results[index];
      if (result === undefined) continue;
      if (!result.ok) {
        triage.errors.set(key, result.reason);
        if (result.reply !== undefined) await markSuggestionPosted(key, result.reply);
        changed ||= result.posted;
        continue;
      }
      changed = true;
      countUsage('ai_fix_applied');
      await markSuggestionApplied(key, result.replyAnchor);
      // Only Resolve: a partner thread someone resolved meanwhile wears Unresolve, which must not be pressed.
      if (resolves) for (const each of [found.item, ...found.partners]) if (isOpenStatus(each.status)) ctx.applier.resolve(threadKeyOf(each));
    }
    if (changed) await ctx.applier.afterPost?.();
    ctx.reapply();
  }, () => {
    for (const { key } of picked) {
      triage.busy.delete(key);
      triage.errors.set(key, 'The request did not finish.');
    }
    ctx.reapply();
  });
}
