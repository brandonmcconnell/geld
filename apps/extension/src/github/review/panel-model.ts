/**
 * Pure helpers behind the review panel: row order, verdict copy and tone.
 * Kept DOM-free so they can be unit tested.
 */

import type { BotVerdictRecord, GeldPrMeta, ReviewItem, ReviewItemStatus } from '@geld/review';
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

export function digestMarkdown(meta: GeldPrMeta, subject: MarkdownSubject | null, showFix: (item: ReviewItem) => boolean): string {
  const { open, done } = splitItems(meta.items);
  const lines = [`## Review digest — ${doneItemCount(meta.items)} of ${meta.items.length} done`];
  if (meta.summary !== undefined) lines.push('', meta.summary.tldr);
  if (meta.bots.length > 0) lines.push('', meta.bots.map((bot) => verdictLabel(bot)).join(' · '));
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
