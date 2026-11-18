/**
 * Incremental consolidation. The model is asked about an item only when
 * its sources changed since the last summary: an unchanged item carries
 * its previous title, context and fix; an item that gained a source (a
 * second bot reporting the same thing) is re-asked with the previous
 * wording as the baseline so the digest moves as little as possible; and
 * the TL;DR is rewritten only when the set of open items changed.
 */

import { botById, unthreadedExcerpt } from './bots';
import type { RawComment } from './cluster';
import { isBotOnly, sourceExcerpts } from './cluster';
import type { GeldPrMeta, ReviewItem, ReviewSummary, SuggestedFix } from './model';
import { isOpenStatus } from './model';
import type { ConsolidateInputItem, ConsolidateOutputItem, SummaryInputItem } from './prompts';

/** Which review items the model may rewrite: bot-only by default; people's words stay theirs. */
export type ConsolidateScope = 'bots' | 'all';

export interface Carried {
  readonly title: string;
  readonly severity?: ReviewItem['severity'];
  readonly context?: string;
  readonly fix?: SuggestedFix;
}

export interface ConsolidationPlan {
  /** Items whose sources are unchanged: reuse the previous model output. */
  readonly carried: ReadonlyMap<string, Carried>;
  /** Items to ask the model about, with the previous wording when the item grew. */
  readonly pending: readonly ConsolidateInputItem[];
}

function anchorKey(item: Pick<ReviewItem, 'sources'>): string {
  return item.sources
    .map((source) => source.anchor)
    .sort()
    .join('|');
}

function carriedFrom(previous: ReviewItem): Carried {
  const carried: Carried = { title: previous.title };
  const graded = { ...carried, severity: previous.severity };
  const explained = previous.context === undefined ? graded : { ...graded, context: previous.context };
  return previous.fix === undefined || previous.fix.source !== 'ai' ? explained : { ...explained, fix: previous.fix };
}

export interface PlanOptions {
  readonly scope?: ConsolidateScope;
  /** Ask the model for a fix on items without one. */
  readonly wantFix?: boolean;
  /** Raw comments (for excerpts); pass what `clusterComments` was given. */
  readonly comments: readonly RawComment[];
  /**
   * Comment anchors an earlier run already showed the model. An item made only of these is not asked again even when
   * the model left it as reported (no partner to merge with, or an id it skipped): asking would cost a request and
   * change nothing. A reply in its thread is a new anchor, so the item is asked again then.
   */
  readonly seen?: ReadonlySet<string>;
}

export function planConsolidation(previous: GeldPrMeta | null, items: readonly ReviewItem[], options: PlanOptions): ConsolidationPlan {
  const scope = options.scope ?? 'bots';
  const previousByAnchors = new Map<string, ReviewItem>();
  const previousByAnchor = new Map<string, ReviewItem>();
  for (const item of previous?.items ?? []) {
    if (!item.rewritten) continue;
    previousByAnchors.set(anchorKey(item), item);
    for (const source of item.sources) previousByAnchor.set(source.anchor, item);
  }
  const carried = new Map<string, Carried>();
  const pending: ConsolidateInputItem[] = [];
  for (const item of items) {
    if (scope === 'bots' && !isBotOnly(item)) continue;
    if (!isOpenStatus(item.status)) continue;
    const same = previousByAnchors.get(anchorKey(item));
    if (same !== undefined) {
      carried.set(item.id, carriedFrom(same));
      continue;
    }
    const seen = options.seen;
    if (seen !== undefined && item.sources.length > 0 && item.sources.every((source) => seen.has(source.anchor))) continue;
    // Grew: some earlier item shares a source with this one; start from its wording.
    const grownFrom = item.sources.map((source) => previousByAnchor.get(source.anchor)).find((candidate) => candidate !== undefined);
    const input: ConsolidateInputItem = {
      id: item.id,
      title: item.title,
      sources: item.sources.map((source) => source.anchor),
      excerpts: sourceExcerpts(options.comments, item),
      wantFix: options.wantFix === true && item.fix === undefined,
      ...(item.path === undefined ? {} : { path: item.path }),
      ...(item.line === undefined ? {} : { line: item.line }),
      ...(grownFrom === undefined ? {} : { previousTitle: grownFrom.title }),
      ...(grownFrom?.context === undefined ? {} : { previousContext: grownFrom.context }),
    };
    pending.push(input);
  }
  return { carried, pending };
}

/** Apply carried wording and fresh model output to the deterministic items. */
export function applyConsolidation(
  items: readonly ReviewItem[],
  carried: ReadonlyMap<string, Carried>,
  outputs: readonly ConsolidateOutputItem[],
): readonly ReviewItem[] {
  const fresh = new Map(outputs.map((entry) => [entry.id, entry]));
  return items.map((item) => {
    const output = fresh.get(item.id);
    if (output !== undefined) {
      const next: ReviewItem = { ...item, title: output.title, rewritten: true };
      const graded = output.severity === undefined ? next : { ...next, severity: output.severity };
      const explained = output.context === undefined ? graded : { ...graded, context: output.context };
      return output.fix === undefined || item.fix !== undefined ? explained : { ...explained, fix: { text: output.fix, source: 'ai' } };
    }
    const carry = carried.get(item.id);
    if (carry === undefined) return item;
    const next: ReviewItem = { ...item, title: carry.title, rewritten: true };
    const graded = carry.severity === undefined ? next : { ...next, severity: carry.severity };
    const explained = carry.context === undefined ? graded : { ...graded, context: carry.context };
    return carry.fix === undefined || item.fix !== undefined ? explained : { ...explained, fix: carry.fix };
  });
}

/**
 * Findings a review bot reports that no open review thread holds, as its latest review says (`BotVerdictRecord.unthreaded`:
 * CodeRabbit's outside-diff comments and failed pre-merge checks). The Review bots row counts them, so the triage reads
 * them too. They are taken from the review, never worked out from the threads in view, which a capped item list, a
 * thread marked done by hand or threads merged into one row would miscount.
 */
export interface UnthreadedFinding {
  /** Changes when the bot reports again or rewrites its review, so a TL;DR written before is behind. */
  readonly id: string;
  readonly bot: string;
  readonly login: string;
  readonly count: number;
  readonly sourceId: string;
}

export function unthreadedFindings(meta: GeldPrMeta): readonly UnthreadedFinding[] {
  return meta.bots.flatMap((bot) => {
    const found = bot.unthreaded;
    if (bot.verdict !== 'findings' || found === undefined) return [];
    return [{ id: `unthreaded:${bot.id}@${found.sourceId}:${found.count}:${found.digest}`, bot: bot.id, login: bot.login, count: found.count, sourceId: found.sourceId }];
  });
}

const UNTHREADED_EXCERPT_CHARS = 4000;

/** The TL;DR's view of them: one entry per bot, the sections of its review that hold them. */
export function unthreadedInputs(findings: readonly UnthreadedFinding[], comments: readonly RawComment[]): readonly SummaryInputItem[] {
  return findings.map((finding) => {
    const name = botById(finding.bot)?.title ?? finding.login;
    const what = finding.count === 1 ? '1 finding' : `${finding.count} findings`;
    const review = (comments.find((comment) => comment.anchor === finding.sourceId)?.body ?? '').replace(/<!--[\s\S]*?-->/g, '');
    const held = unthreadedExcerpt(review);
    const body = (held === '' ? review : held).replace(/\s+/g, ' ').trim();
    const context = body.length > UNTHREADED_EXCERPT_CHARS ? `${body.slice(0, UNTHREADED_EXCERPT_CHARS)}…` : body;
    return { id: finding.id, title: `${name} reports ${what} outside its review threads`, severity: 'bug', status: 'open', ...(context === '' ? {} : { context }) };
  });
}

/** Sorted open item ids, and the bots' unthreaded findings: the TL;DR is written for exactly this set. */
export function summaryKey(items: readonly ReviewItem[], unthreaded: readonly UnthreadedFinding[] = []): readonly string[] {
  return [...items.filter((item) => isOpenStatus(item.status)).map((item) => item.id), ...unthreaded.map((finding) => finding.id)].sort();
}

export function summaryIsCurrent(summary: ReviewSummary | undefined, items: readonly ReviewItem[], unthreaded: readonly UnthreadedFinding[] = []): boolean {
  if (summary === undefined) return false;
  const key = summaryKey(items, unthreaded);
  return key.length === summary.forItems.length && key.every((id, index) => id === summary.forItems[index]);
}

export function summaryInput(items: readonly ReviewItem[]): readonly SummaryInputItem[] {
  return items
    .filter((item) => isOpenStatus(item.status))
    .map((item) => ({
      id: item.id,
      title: item.title,
      severity: item.severity,
      status: item.status,
      ...(item.path === undefined ? {} : { path: item.path }),
      ...(item.context === undefined ? {} : { context: item.context }),
    }));
}

export function summaryRecord(tldr: string, items: readonly ReviewItem[], updatedAt: string, unthreaded: readonly UnthreadedFinding[] = []): ReviewSummary {
  return { tldr, updatedAt, forItems: summaryKey(items, unthreaded) };
}

/** Whether a fix should be shown under the user's preference. */
export function fixVisible(fix: SuggestedFix | undefined, mode: 'all' | 'bots' | 'ai' | 'off'): fix is SuggestedFix {
  if (fix === undefined || mode === 'off') return false;
  if (mode === 'all') return true;
  if (mode === 'ai') return fix.source === 'ai';
  return fix.source !== 'ai';
}
