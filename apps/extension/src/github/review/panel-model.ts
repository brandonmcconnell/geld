/**
 * Pure helpers behind the review panel: row order, verdict copy and tone.
 * Kept DOM-free so they can be unit tested.
 */

import type { BotVerdictRecord, GeldPrMeta, RawComment, ReviewItem, ReviewItemStatus, ReviewerRecord } from '@geld/review';
import { normalizeAvatarSrc } from './crawler';
import { botByAppSlug, botByCheckName, botByTrigger, botTitle, doneItemCount, isOpenStatus, rerunTriggerFor } from '@geld/review';

export interface InstalledBot {
  readonly id: string;
  readonly label: string;
  readonly trigger: string;
  readonly iconSrc: string | null;
}

/**
 * Bots present on this pull request that a comment can re-run: every
 * registered bot the page links to as `/apps/<slug>` (comments, the checks
 * list, the reviewers box), those the payload knows from verdicts or item
 * sources, those with a check run in the merge box (a bot that found nothing
 * may post no comment at all and leave only its check), and those a person
 * has asked for with a trigger comment. Icons come from the page's own
 * `<img>` next to the link or the check row.
 */
export function installedBots(meta: GeldPrMeta, doc: ParentNode, comments: readonly RawComment[] = []): readonly InstalledBot[] {
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
    // One URL per picture whatever size the link near the app happens to show (see `normalizeAvatarSrc`).
    add(bot.id, `${slug}[bot]`, src === null || src === '' ? null : normalizeAvatarSrc(src));
  }
  for (const bot of meta.bots) add(bot.id, bot.login, null);
  for (const item of meta.items) {
    for (const source of item.sources) if (source.bot !== undefined) add(source.bot, source.author, null);
  }
  // Check runs: the row's name links to the run (classic) or to the checks tab (React); the row's image is the app's.
  for (const link of doc.querySelectorAll<HTMLAnchorElement>('a[href*="check_run_id="], a[href*="/runs/"], a[href*="/checks/"]')) {
    const bot = botByCheckName((link.textContent ?? '').trim());
    if (bot === null) continue;
    const row = link.closest('li, .merge-status-item, [class*="StatusCheckRow"], [class*="ListItem"]');
    const img = row?.querySelector('img');
    const src = img?.currentSrc || img?.getAttribute('src') || null;
    add(bot.id, bot.logins[0] ?? `${bot.id}[bot]`, src === null || src === '' ? null : normalizeAvatarSrc(src));
  }
  for (const comment of comments) {
    const bot = botByTrigger(comment.body);
    if (bot !== null) add(bot.id, bot.logins[0] ?? `${bot.id}[bot]`, null);
  }
  // Alphabetical: the page's link order changes as nodes move into the panel, and buttons must not shuffle.
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
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

export type CheckState = 'success' | 'failure' | 'queued' | 'pending' | 'skipped' | 'neutral';

export interface CheckCounts {
  readonly success: number;
  readonly failure: number;
  /** Not started: GitHub's "pending" (waiting for a status to be reported, queued, expected). */
  readonly queued: number;
  /** Started and running: GitHub's "in progress". */
  readonly pending: number;
  readonly skipped: number;
  readonly neutral: number;
}

export const EMPTY_CHECKS: CheckCounts = { success: 0, failure: 0, queued: 0, pending: 0, skipped: 0, neutral: 0 };

export function checksTotal(counts: CheckCounts): number {
  return counts.success + counts.failure + counts.queued + counts.pending + counts.skipped + counts.neutral;
}

/** The whole word between the number and "checks", so "1 pending review" on the same line never counts as a check. */
const CHECK_WORDS: ReadonlyArray<readonly [RegExp, CheckState]> = [
  [/^(?:successful|passed|passing)$/i, 'success'],
  [/^(?:failing|failed|failure|error(?:ed)?|cancell?ed|timed out|action required)$/i, 'failure'],
  // GitHub counts the two apart ("4 pending, 8 in progress checks"): a check that has not started is not a running one,
  // and one bucket taking the larger of the two numbers lost the smaller group.
  [/^(?:in progress|running)$/i, 'pending'],
  [/^(?:pending|queued|waiting|expected)$/i, 'queued'],
  [/^skipped$/i, 'skipped'],
  [/^(?:neutral|stale)$/i, 'neutral'],
];

function stateOfWord(word: string): CheckState | null {
  const trimmed = word.trim();
  return CHECK_WORDS.find(([pattern]) => pattern.test(trimmed))?.[1] ?? null;
}

/**
 * Check counts from the merge box's own headings: the new merge box writes
 * "1 in progress check", "3 skipped checks", "8 successful checks"; the
 * legacy one "All checks have passed" plus one row per check. Returns null
 * when no checks section is on the page.
 */
export function checkCountsFrom(text: string): CheckCounts | null {
  // "8 successful checks" (one heading per state) or "1 failing, 7 skipped, 59 successful checks" (one
  // sentence). The React merge box shows both once expanded; the sentence alone is the whole picture.
  const sentences = [...text.matchAll(/((?:\d+\s+[a-z][a-z ]*?,\s*)*\d+\s+[a-z][a-z ]*?)\s+checks?\b/gi)].map((match) => match[1] ?? '');
  const summary = sentences.find((sentence) => sentence.includes(','));
  const counts = { ...EMPTY_CHECKS };
  let found = false;
  for (const sentence of summary === undefined ? sentences : [summary]) {
    for (const part of sentence.split(',')) {
      const match = /(\d+)\s+([a-z][a-z ]*)/i.exec(part.trim());
      const state = stateOfWord(match?.[2] ?? '');
      const count = Number.parseInt(match?.[1] ?? '0', 10);
      if (state === null || !Number.isFinite(count)) continue;
      found = true;
      // The section heading and the expanded group heading state the same number; never add them up.
      counts[state] = Math.max(counts[state], count);
    }
  }
  return found ? counts : null;
}

export function checksHealth(counts: CheckCounts): Health {
  if (counts.failure > 0) return 'bad';
  if (counts.pending > 0 || counts.queued > 0) return 'pending';
  if (counts.success > 0) return 'good';
  return 'warn';
}

/** The colour a row wears: none while the page is still deciding. */
export type Tone = 'good' | 'warn' | 'bad';

export function toneOf(health: Health): Tone | null {
  return health === 'pending' ? null : health;
}

/**
 * The CI row's tint: red when a required check failed, amber when only
 * optional ones did (`requiredFailing` is null when the list does not say
 * which are required — then every failure counts), none while anything is
 * still running, green once everything passed.
 */
export function checksTone(counts: CheckCounts, requiredFailing: boolean | null): Tone | null {
  if (counts.failure > 0) return requiredFailing === false ? 'warn' : 'bad';
  if (counts.pending > 0 || counts.queued > 0) return null;
  if (counts.success > 0) return 'good';
  return null;
}

export function checksSummary(counts: CheckCounts): string {
  const parts: string[] = [];
  if (counts.failure > 0) parts.push(`${counts.failure} failing`);
  if (counts.queued > 0) parts.push(`${counts.queued} pending`);
  if (counts.pending > 0) parts.push(`${counts.pending} in progress`);
  if (counts.success > 0) parts.push(`${counts.success} successful`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  if (counts.neutral > 0) parts.push(`${counts.neutral} neutral`);
  return parts.join(' · ');
}

export interface RequiredReviews {
  /** Null when the page no longer states the requirement (it was met before we saw it). */
  readonly required: number | null;
  readonly approvals: number;
  readonly changesRequested: boolean;
}

/**
 * "2 approving reviews are required" / "At least 1 approving review is
 * required" plus the approvals the payload knows (or "N approvals" on the
 * page). Null when the merge box does not require reviews.
 */
export interface RequiredReviewsOptions {
  /** The requirement seen earlier on this visit: once satisfied, GitHub's merge box stops stating it. */
  readonly knownRequired?: number | null;
}

/**
 * The merge box says "At least N approving reviews are required" while
 * unsatisfied and "N approving reviews by reviewers with write access" once
 * met — the second N counts approvals, not the requirement. Approvals are the
 * larger of that sentence and the reviewers whose latest review approved.
 * `required` is null when the page no longer states it and nothing was
 * remembered; the row then shows "N approved".
 */
export function requiredReviewsFrom(text: string, reviewers: readonly ReviewerRecord[], options: RequiredReviewsOptions = {}): RequiredReviews | null {
  const stated = /at least\s+(\d+)\s+approving review/i.exec(text)?.[1];
  const satisfied = /(\d+)\s+approving reviews?\s+by\b/i.exec(text)?.[1];
  const approvedByPage = /(\d+)\s+approvals?\b/i.exec(text)?.[1];
  const mentionsReviews = stated !== undefined || satisfied !== undefined || /\breview required\b/i.test(text) || /\bchanges approved\b/i.test(text);
  if (!mentionsReviews && reviewers.length === 0) return null;
  const known = options.knownRequired ?? null;
  const required = stated !== undefined ? Number.parseInt(stated, 10) : known !== null ? known : /\breview required\b/i.test(text) ? 1 : null;
  const approvals = Math.max(
    reviewers.filter((reviewer) => reviewer.state === 'approved').length,
    satisfied === undefined ? 0 : Number.parseInt(satisfied, 10),
    approvedByPage === undefined ? 0 : Number.parseInt(approvedByPage, 10),
  );
  return {
    required,
    approvals,
    // The box's own "changes requested" sentence is the merge blocker's wording; it stays while a request stands
    // and goes once the reviewer is re-requested, so it can be read as it is.
    changesRequested: reviewers.some((reviewer) => reviewer.state === 'changes_requested') || /\bchanges requested\b/i.test(text),
  };
}

export function reviewsHealth(reviews: RequiredReviews): Health {
  if (reviews.changesRequested) return 'bad';
  if (reviews.required === null) return reviews.approvals > 0 ? 'good' : 'pending';
  return reviews.approvals >= reviews.required ? 'good' : 'pending';
}

/** "2/1 approvals", "2 approved" (requirement unknown) or "changes requested". */
export function reviewsLabel(reviews: RequiredReviews): string {
  if (reviews.changesRequested) return 'changes requested';
  if (reviews.required === null) return `${reviews.approvals} approved`;
  return `${reviews.approvals}/${reviews.required} approvals`;
}
