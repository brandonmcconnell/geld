/**
 * Pure helpers behind the review panel: row order, verdict copy and tone.
 * Kept DOM-free so they can be unit tested.
 */

import type { BotVerdictRecord, GeldPrMeta, ReviewItem, ReviewItemStatus, ReviewerRecord } from '@geld/review';
import { botByAppSlug, botTitle, doneItemCount, isOpenStatus, rerunTriggerFor } from '@geld/review';

export interface InstalledBot {
  readonly id: string;
  readonly label: string;
  readonly trigger: string;
  readonly iconSrc: string | null;
}

/**
 * Bots present on this pull request that a comment can re-run: every
 * registered bot the page links to as `/apps/<slug>` (comments, the checks
 * list, the reviewers box), plus those the payload knows from verdicts or
 * item sources. Icons come from the page's own `<img>` next to that link.
 */
export function installedBots(meta: GeldPrMeta, doc: ParentNode): readonly InstalledBot[] {
  const found = new Map<string, InstalledBot>();
  const add = (id: string, login: string, iconSrc: string | null): void => {
    const trigger = rerunTriggerFor(id);
    if (trigger === null) return;
    const existing = found.get(id);
    if (existing !== undefined) {
      if (existing.iconSrc === null && iconSrc !== null) found.set(id, { ...existing, iconSrc });
      return;
    }
    found.set(id, { id, label: botTitle(id, login), trigger, iconSrc });
  };
  for (const link of doc.querySelectorAll<HTMLAnchorElement>('a[href^="/apps/"], a[href*="github.com/apps/"]')) {
    const slug = /\/apps\/([\w.-]+)/.exec(link.getAttribute('href') ?? '')?.[1];
    if (slug === undefined) continue;
    const bot = botByAppSlug(slug);
    if (bot === null) continue;
    const img = link.querySelector('img') ?? link.parentElement?.querySelector('img') ?? link.closest('.TimelineItem, .js-timeline-item, li, tr')?.querySelector('img');
    const src = img?.currentSrc || img?.getAttribute('src') || null;
    add(bot.id, `${slug}[bot]`, src === '' ? null : src);
  }
  for (const bot of meta.bots) add(bot.id, bot.login, null);
  for (const item of meta.items) {
    for (const source of item.sources) if (source.bot !== undefined) add(source.bot, source.author, null);
  }
  return [...found.values()];
}

const ORDER: Readonly<Record<ReviewItemStatus, number>> = {
  'needs-reply': 0,
  open: 1,
  addressed: 2,
  'done-manual': 3,
  resolved: 4,
  outdated: 5,
};

/** Waiting-on-you first, then open, then addressed; done items keep their relative order. */
export function sortItems(items: readonly ReviewItem[]): readonly ReviewItem[] {
  return [...items].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

export function splitItems(items: readonly ReviewItem[]): { readonly open: readonly ReviewItem[]; readonly done: readonly ReviewItem[] } {
  const sorted = sortItems(items);
  return { open: sorted.filter((item) => isOpenStatus(item.status)), done: sorted.filter((item) => !isOpenStatus(item.status)) };
}

export type VerdictTone = 'success' | 'attention' | 'danger' | 'neutral';

export function verdictTone(bot: BotVerdictRecord): VerdictTone {
  if (bot.verdict === 'clean') return 'success';
  if (bot.verdict === 'failed') return 'danger';
  if (bot.verdict === 'running') return 'neutral';
  return 'attention';
}

export function isCurrent(bot: BotVerdictRecord, headSha: string): boolean {
  const reviewed = bot.reviewedSha.toLowerCase();
  const head = headSha.toLowerCase();
  return reviewed === head || head.startsWith(reviewed) || reviewed.startsWith(head);
}

/** "Greptile 4/5", "Bugbot clean", "Devin 1 issue", "Copilot running". */
export function verdictLabel(bot: BotVerdictRecord): string {
  const title = botTitle(bot.id, bot.login);
  if (bot.verdict === 'running') return `${title} running`;
  if (bot.verdict === 'failed') return `${title} failed`;
  if (bot.verdict === 'clean') return `${title} clean`;
  if (bot.score !== undefined) return `${title} ${bot.score}/5`;
  if (bot.count !== undefined) return `${title} ${bot.count} issue${bot.count === 1 ? '' : 's'}`;
  return `${title} findings`;
}

export function statusBadge(status: ReviewItemStatus): string | null {
  if (status === 'needs-reply') return 'needs reply';
  if (status === 'addressed') return 'addressed';
  if (status === 'outdated') return 'outdated';
  return null;
}

export interface MarkdownSubject {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly origin: string;
}

function locationOf(item: ReviewItem): string {
  if (item.path === undefined) return '';
  return item.line === undefined ? ` \`${item.path}\`` : ` \`${item.path}:${item.line}\``;
}

/** One item as Markdown a person can hand to an agent: title, location, context, fix, links back to every source. */
export function itemMarkdown(item: ReviewItem, subject: MarkdownSubject | null, showFix: boolean): string {
  const link = (anchor: string): string => (subject === null ? `#${anchor}` : `${subject.origin}/${subject.owner}/${subject.repo}/pull/${subject.number}#${anchor}`);
  const lines = [`- [${isOpenStatus(item.status) ? ' ' : 'x'}] **${item.title}**${locationOf(item)} — ${authorLabels(item).join(', ')}`];
  if (item.context !== undefined) lines.push(`  ${item.context}`);
  if (showFix && item.fix !== undefined) {
    lines.push(`  Suggested fix (${item.fix.source}):`, '  ```suggestion', ...item.fix.text.split('\n').map((row) => `  ${row}`), '  ```');
  }
  lines.push(`  Sources: ${item.sources.map((source) => `[${source.bot ?? source.author}](${link(source.anchor)})`).join(' · ')}`);
  return lines.join('\n');
}

export interface DigestExtras {
  /** Status lines for the top: CI checks, required reviews. */
  readonly status: readonly string[];
  /** Short text of a bot's run summary, by its comment anchor. */
  readonly excerptFor: (anchor: string) => string | null;
}

const HEALTH_MARK: Readonly<Record<Health, string>> = { good: '✅', warn: '🟡', bad: '❌', pending: '⏳' };

/**
 * The whole digest as Markdown for an agent or a teammate: TL;DR, status,
 * one line per bot with a link to its run summary and what it said, then
 * every item with its sources. Without review threads this is still the
 * bots' verdicts and summaries, not just a count.
 */
export function digestMarkdown(meta: GeldPrMeta, subject: MarkdownSubject | null, showFix: (item: ReviewItem) => boolean, extras?: DigestExtras): string {
  const link = (anchor: string): string => (subject === null ? `#${anchor}` : `${subject.origin}/${subject.owner}/${subject.repo}/pull/${subject.number}#${anchor}`);
  const { open, done } = splitItems(meta.items);
  const title = subject === null ? 'Review digest' : `Review digest — ${subject.owner}/${subject.repo}#${subject.number}`;
  const lines = [`## ${title}`];
  if (meta.summary !== undefined) lines.push('', meta.summary.tldr);
  const status = [...(extras?.status ?? [])];
  if (meta.items.length > 0) status.unshift(`${doneItemCount(meta.items)} of ${meta.items.length} review items done`);
  if (status.length > 0) lines.push('', ...status.map((line) => `- ${line}`));
  if (meta.bots.length > 0) {
    lines.push('', '### Review bots', '');
    for (const bot of meta.bots) {
      const head = `- ${HEALTH_MARK[botHealth(bot)]} **${verdictLabel(bot)}**${isCurrent(bot, meta.headSha) ? '' : ' (earlier commit)'}`;
      const source = bot.sourceId === undefined ? '' : ` — [run summary](${link(bot.sourceId)})`;
      const excerpt = bot.sourceId === undefined ? null : extras?.excerptFor(bot.sourceId) ?? null;
      lines.push(head + source);
      if (excerpt !== null && excerpt !== '') lines.push(`  ${excerpt}`);
    }
  }
  if (open.length > 0) lines.push('', '### Open', '', ...open.map((item) => itemMarkdown(item, subject, showFix(item))));
  if (done.length > 0) lines.push('', '### Done', '', ...done.map((item) => itemMarkdown(item, subject, showFix(item))));
  return lines.join('\n');
}

/** Distinct human-readable author labels for a row, bots by their product name. */
export function authorLabels(item: ReviewItem): readonly string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const source of item.sources) {
    const label = source.bot !== undefined ? botTitle(source.bot, source.author) : source.author;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

/* ---- status rows: bots, CI checks, required reviews ---------------------- */

/** Traffic light for a bot's verdict: green check, yellow dot, red X, or gray while running. */
export type Health = 'good' | 'warn' | 'bad' | 'pending';

export function botHealth(bot: BotVerdictRecord): Health {
  if (bot.verdict === 'running') return 'pending';
  if (bot.verdict === 'failed') return 'bad';
  if (bot.verdict === 'clean') return 'good';
  if (bot.severity === 'high') return 'bad';
  if (bot.score !== undefined) return bot.score >= 5 ? 'good' : bot.score >= 3 ? 'warn' : 'bad';
  if (bot.count === 0) return 'good';
  return 'warn';
}

/** Short text beside the glyph: "4/5", "2 issues", "clean", "running". */
export function botDetail(bot: BotVerdictRecord): string {
  if (bot.verdict === 'running') return 'running';
  if (bot.verdict === 'failed') return 'failed';
  if (bot.verdict === 'clean') return 'clean';
  if (bot.score !== undefined) return `${bot.score}/5`;
  if (bot.count !== undefined) return `${bot.count} issue${bot.count === 1 ? '' : 's'}`;
  return 'findings';
}

export type CheckState = 'success' | 'failure' | 'pending' | 'skipped' | 'neutral';

export interface CheckCounts {
  readonly success: number;
  readonly failure: number;
  readonly pending: number;
  readonly skipped: number;
  readonly neutral: number;
}

export const EMPTY_CHECKS: CheckCounts = { success: 0, failure: 0, pending: 0, skipped: 0, neutral: 0 };

export function checksTotal(counts: CheckCounts): number {
  return counts.success + counts.failure + counts.pending + counts.skipped + counts.neutral;
}

const CHECK_WORDS: ReadonlyArray<readonly [RegExp, CheckState]> = [
  [/successful|passed|passing/i, 'success'],
  [/failing|failed|failure|error(?:ed)?|cancell?ed|timed out|action required/i, 'failure'],
  [/in progress|pending|queued|waiting|expected|running/i, 'pending'],
  [/skipped/i, 'skipped'],
  [/neutral|stale/i, 'neutral'],
];

function stateOfWord(word: string): CheckState | null {
  return CHECK_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? null;
}

/**
 * Check counts from the merge box's own headings: the new merge box writes
 * "1 in progress check", "3 skipped checks", "8 successful checks"; the
 * legacy one "All checks have passed" plus one row per check. Returns null
 * when no checks section is on the page.
 */
export function checkCountsFrom(text: string): CheckCounts | null {
  const counts = { ...EMPTY_CHECKS };
  let found = false;
  for (const match of text.matchAll(/(\d+)\s+((?:in progress|action required|timed out|[a-z]+))\s+checks?\b/gi)) {
    const state = stateOfWord(match[2] ?? '');
    const count = Number.parseInt(match[1] ?? '0', 10);
    if (state === null || !Number.isFinite(count)) continue;
    found = true;
    counts[state] += count;
  }
  return found ? counts : null;
}

export function checksHealth(counts: CheckCounts): Health {
  if (counts.failure > 0) return 'bad';
  if (counts.pending > 0) return 'pending';
  if (counts.success > 0) return 'good';
  return 'warn';
}

export function checksSummary(counts: CheckCounts): string {
  const parts: string[] = [];
  if (counts.failure > 0) parts.push(`${counts.failure} failing`);
  if (counts.pending > 0) parts.push(`${counts.pending} in progress`);
  if (counts.success > 0) parts.push(`${counts.success} successful`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  if (counts.neutral > 0) parts.push(`${counts.neutral} neutral`);
  return parts.join(' · ');
}

export interface RequiredReviews {
  readonly required: number;
  readonly approvals: number;
  readonly changesRequested: boolean;
}

/**
 * "2 approving reviews are required" / "At least 1 approving review is
 * required" plus the approvals the payload knows (or "N approvals" on the
 * page). Null when the merge box does not require reviews.
 */
export function requiredReviewsFrom(text: string, reviewers: readonly ReviewerRecord[]): RequiredReviews | null {
  const required = /(?:at least\s+)?(\d+)\s+approving review/i.exec(text)?.[1] ?? (/\breview required\b/i.test(text) ? '1' : null);
  if (required === null) return null;
  const fromPage = /(\d+)\s+approvals?\b/i.exec(text)?.[1];
  const approvals = Math.max(reviewers.filter((reviewer) => reviewer.state === 'approved').length, fromPage === undefined ? 0 : Number.parseInt(fromPage, 10));
  return {
    required: Number.parseInt(required, 10),
    approvals,
    changesRequested: reviewers.some((reviewer) => reviewer.state === 'changes_requested') || /\bchanges requested\b/i.test(text),
  };
}

export function reviewsHealth(reviews: RequiredReviews): Health {
  if (reviews.changesRequested) return 'bad';
  return reviews.approvals >= reviews.required ? 'good' : 'pending';
}
