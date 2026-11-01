/**
 * GeldPrMeta → the one PR comment body. Deterministic; snapshot-tested.
 * The JSON rides in the footer as an empty `<span title="geld:…">`
 * (`PAYLOAD_ATTR_PREFIX`): GitHub strips HTML comments from what it
 * renders but keeps `title`, and an empty inline has no size, so nobody
 * sees the payload — not even as a collapsed block — while the extension
 * reads it from the DOM. Summaries written before this carried it as a
 * `<details>` with a `geld` fence; the parser still reads those.
 */

import type { BotVerdictRecord, GeldPrMeta, ReviewItem, ReviewerRecord, ReviewSource } from './model';
import type { ProviderReviewSubject } from './provider-review';
import { providerReviewUrl, sourceLink } from './provider-review';
import {
  SUMMARY_HEADING,
  SUMMARY_MARKER,
  doneItemCount,
  geldPrUrl,
  howItWorksUrl,
  isOpenStatus,
  openItemCount,
} from './model';
import { botTitle } from './bots';
import { parseInlineMarkdown } from './inline-markdown';
import { publishedSummaryFooter } from './summary-parse';

const STATUS_LABEL: Readonly<Record<ReviewItem['status'], string>> = {
  open: 'Open',
  'needs-reply': 'Needs reply',
  addressed: 'Addressed',
  'done-manual': 'Done',
  resolved: 'Done',
  outdated: 'Outdated',
};

function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

/**
 * One line of comment text as Markdown again: its own `code`, **bold**,
 * *italic* and ~~struck~~ marks are kept (normalised), everything else is
 * escaped. Inside a bold head, a bold run is already bold and takes no marks.
 */
function inlineMd(text: string, inBold = false): string {
  return parseInlineMarkdown(text)
    .map((run) => {
      if (run.marks.includes('code')) {
        const fence = fenceFor(run.text, 1);
        return run.text.includes('`') ? `${fence} ${run.text} ${fence}` : `${fence}${run.text}${fence}`;
      }
      let out = escapeMd(run.text);
      for (const mark of [...run.marks].reverse()) {
        if (mark === 'strong' && !inBold) out = `**${out}**`;
        else if (mark === 'em') out = `*${out}*`;
        else if (mark === 'del') out = `~~${out}~~`;
      }
      return out;
    })
    .join('');
}

function locationOf(item: ReviewItem): string {
  if (item.path === undefined) return '';
  return item.line === undefined ? ` \`${item.path}\`` : ` \`${item.path}:${item.line}\``;
}

function authorsOf(item: ReviewItem): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const source of item.sources) {
    const label = source.bot !== undefined ? botTitle(source.bot, source.author) : `@${source.author}`;
    if (seen.has(label)) continue;
    seen.add(label);
    names.push(label);
  }
  return names.join(', ');
}

interface SummaryLinks {
  readonly sourceHref: (source: ReviewSource) => string | null;
  readonly openHref: string;
  readonly openLabel: string;
  readonly reviewNoun: 'pull request' | 'merge request';
}

function fenceFor(text: string, minimum: number): string {
  const longest = (text.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length), 0);
  return '`'.repeat(Math.max(minimum, longest + 1));
}

function sourcesOf(item: ReviewItem, links: SummaryLinks): string {
  return item.sources.map((source) => {
    const href = links.sourceHref(source);
    return href === null ? 'source unavailable' : `[source](${href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
  }).join(' · ');
}

function itemLine(item: ReviewItem, checked: boolean, links: SummaryLinks): string {
  const box = checked ? '- [x]' : '- [ ]';
  const head = `${box} **${inlineMd(item.title, true)}** —${locationOf(item)} · ${authorsOf(item)} — ${sourcesOf(item, links)}`;
  const extra: string[] = [];
  if (item.context !== undefined) extra.push(`  ${inlineMd(item.context)}`);
  if (item.fix !== undefined) {
    const fence = fenceFor(item.fix.text, 3);
    extra.push(`  <details><summary>Suggested fix (${item.fix.source})</summary>`, '', `  ${fence}suggestion`, ...item.fix.text.split('\n').map((line) => `  ${line}`), `  ${fence}`, '', '  </details>');
  }
  return [head, ...extra].join('\n');
}

/** One native concern for a clipboard handoff, without a published-summary frame or payload. */
export function renderProviderItemMarkdown(item: ReviewItem, subject: ProviderReviewSubject, options: {
  readonly showFix: boolean;
  readonly sourceStatus?: ReviewItem['status'];
  readonly reviewedOnDevice?: boolean;
}): string {
  providerReviewUrl(subject);
  const status = options.sourceStatus ?? item.status;
  const location = item.path === undefined ? '' : `${item.path}${item.line === undefined ? '' : `:${item.line}`}`;
  const displayedLocation = /[\r\n]|^\s|\s$/.test(location) ? JSON.stringify(location) : location;
  const ticks = fenceFor(displayedLocation, 1);
  const padding = displayedLocation.includes('`') ? ' ' : '';
  const path = location === '' ? '' : ` ${ticks}${padding}${displayedLocation}${padding}${ticks}`;
  const sources = sourcesOf(item, { sourceHref: (source) => sourceLink(source, subject), openHref: providerReviewUrl(subject), openLabel: '', reviewNoun: subject.provider === 'gitlab' ? 'merge request' : 'pull request' });
  const authors = [...new Set(item.sources.map((source) => source.author))].map((author) => `@${author}`).join(', ');
  const lines = [`- [${isOpenStatus(status) ? ' ' : 'x'}] **${inlineMd(item.title, true)}**${path} · ${escapeMd(authors)}`, `  Source status: ${status}.`];
  if (item.rewritten) lines.push('  AI triage wording. Original sources linked below.');
  if (item.status !== status) lines.push(`  Geld triage status: ${item.status}.`);
  if (options.reviewedOnDevice) lines.push('  Reviewed on this device.');
  if (item.context !== undefined) lines.push(`  ${inlineMd(item.context)}`);
  if (item.addressed !== undefined) lines.push(`  AI assessment: ${item.addressed.verdict}. ${item.addressed.evidence.map((evidence) => inlineMd(evidence)).join(' ')}`);
  if (options.showFix && item.fix !== undefined) {
    const fence = fenceFor(item.fix.text, 3);
    lines.push(`  Suggested fix (${item.fix.source}):`, `  ${fence}suggestion`, ...item.fix.text.split('\n').map((line) => `  ${line}`), `  ${fence}`);
  }
  lines.push(`  Sources: ${sources}`);
  return lines.join('\n');
}

function groupItems(items: readonly ReviewItem[]): { open: ReviewItem[]; done: ReviewItem[] } {
  const open: ReviewItem[] = [];
  const done: ReviewItem[] = [];
  for (const item of items) {
    if (isOpenStatus(item.status)) open.push(item);
    else done.push(item);
  }
  const rank = (status: ReviewItem['status']): number => {
    if (status === 'open') return 0;
    if (status === 'needs-reply') return 1;
    if (status === 'addressed') return 2;
    return 3;
  };
  open.sort((a, b) => rank(a.status) - rank(b.status) || a.title.localeCompare(b.title));
  return { open, done };
}

function freshness(bot: BotVerdictRecord, headSha: string): string {
  const current = bot.reviewedSha.toLowerCase() === headSha.toLowerCase() || headSha.toLowerCase().startsWith(bot.reviewedSha.toLowerCase());
  if (current) return 'current';
  return 'behind';
}

function botPhrase(bot: BotVerdictRecord, headSha: string): string {
  const title = botTitle(bot.id, bot.login);
  const tag = freshness(bot, headSha);
  if (bot.verdict === 'running') return `${title} running (${tag})`;
  if (bot.verdict === 'loading') return `${title} loading (${tag})`;
  if (bot.verdict === 'unknown') return `${title} no word (${tag})`;
  // A run the bot refused ("disabled for this repository") is skipped, in the bot's words; a run that broke is failed.
  if (bot.verdict === 'failed') return bot.reason === undefined ? `${title} failed (${tag})` : `${title} skipped (${tag}): ${bot.reason}`;
  if (bot.verdict === 'clean') return `${title} clean (${tag})`;
  if (bot.score !== undefined) return `${title} ${bot.score}/5 (${tag})`;
  if (bot.count !== undefined) return `${title} ${bot.count} issue${bot.count === 1 ? '' : 's'} (${tag})`;
  return `${title} findings (${tag})`;
}

function reviewerPhrase(reviewer: ReviewerRecord): string {
  if (reviewer.state === 'approved') return `@${reviewer.login} approved`;
  if (reviewer.state === 'changes_requested') return `@${reviewer.login} requested changes`;
  if (reviewer.state === 'pending') return `@${reviewer.login} pending`;
  return `@${reviewer.login} commented`;
}

function headerLine(meta: GeldPrMeta): string {
  const open = openItemCount(meta.items);
  const done = doneItemCount(meta.items);
  const total = meta.items.length;
  const parts = [`**${done} of ${total} done**`];
  for (const bot of meta.bots) parts.push(botPhrase(bot, meta.headSha));
  if (open > 0 && total > 0) {
    // The counts already lead; bots follow.
  }
  return parts.join(' · ');
}

/**
 * Render the comment body. `owner`/`repo`/`number` feed the "Open in Geld"
 * deeplink; omit them to skip the URL (tests, crawler).
 */
export function renderSummary(
  meta: GeldPrMeta,
  subject?: { readonly owner: string; readonly repo: string; readonly number: number },
): string {
  return renderSummaryBody(meta, {
    sourceHref: (source) => `#${source.anchor}`,
    openHref: subject === undefined ? howItWorksUrl() : geldPrUrl(subject.owner, subject.repo, subject.number, meta),
    openLabel: 'Open in Geld',
    reviewNoun: 'pull request',
  });
}

export function renderProviderSummary(meta: GeldPrMeta, subject: ProviderReviewSubject, options: { readonly notes?: readonly string[] } = {}): string {
  const noun = subject.provider === 'gitlab' ? 'merge request' : 'pull request';
  return renderSummaryBody(meta, {
    sourceHref: (source) => sourceLink(source, subject),
    openHref: providerReviewUrl(subject),
    openLabel: `Open ${noun}`,
    reviewNoun: noun,
  }, options.notes);
}

function renderSummaryBody(meta: GeldPrMeta, links: SummaryLinks, notes: readonly string[] = []): string {
  const { open, done } = groupItems(meta.items);
  const lines: string[] = [
    SUMMARY_MARKER,
    `### ${SUMMARY_HEADING}`,
    headerLine(meta),
    '',
  ];
  if (meta.summary !== undefined) {
    lines.push(meta.summary.tldr, '');
  }
  if (open.length > 0) {
    lines.push(`**Open (${open.length})**`);
    for (const item of open) lines.push(itemLine(item, false, links));
    lines.push('');
  }
  if (done.length > 0) {
    lines.push(`<details><summary>Done (${done.length})</summary>`);
    lines.push('');
    for (const item of done) lines.push(itemLine(item, true, links));
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (meta.reviewers.length > 0) {
    lines.push(meta.reviewers.map(reviewerPhrase).join(' · '));
    lines.push('');
  }
  if (meta.truncated === true) {
    lines.push(`_List truncated; open the ${links.reviewNoun} with Geld to see the rest._`);
    lines.push('');
  }
  if (notes.length > 0) lines.push(...notes, '');
  // The payload's carrier sits inside the footer's own line, so it adds no paragraph (an empty inline is sizeless).
  lines.push(publishedSummaryFooter(JSON.stringify(meta), links.openHref, links.openLabel));
  lines.push('');
  return lines.join('\n');
}

export function statusLabel(status: ReviewItem['status']): string {
  return STATUS_LABEL[status];
}
