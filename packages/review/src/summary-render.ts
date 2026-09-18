/**
 * GeldPrMeta → the one PR comment body. Deterministic; snapshot-tested.
 * The JSON lives in a collapsed `<details>` fenced as `geld` so GitHub
 * renders `<pre lang="geld">` the extension can read from the DOM.
 */

import type { BotVerdictRecord, GeldPrMeta, ReviewItem, ReviewerRecord } from './model';
import {
  DATA_SUMMARY,
  PAYLOAD_FENCE,
  SUMMARY_HEADING,
  SUMMARY_MARKER,
  doneItemCount,
  geldPrUrl,
  howItWorksUrl,
  isOpenStatus,
  openItemCount,
} from './model';
import { botTitle } from './bots';

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

function sourcesOf(item: ReviewItem): string {
  return item.sources.map((source) => `[source](#${source.anchor})`).join(' · ');
}

function itemLine(item: ReviewItem, checked: boolean): string {
  const box = checked ? '- [x]' : '- [ ]';
  return `${box} **${escapeMd(item.title)}** —${locationOf(item)} · ${authorsOf(item)} — ${sourcesOf(item)}`;
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
  if (bot.verdict === 'failed') return `${title} failed (${tag})`;
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
  const { open, done } = groupItems(meta.items);
  const lines: string[] = [
    SUMMARY_MARKER,
    `### ${SUMMARY_HEADING}`,
    headerLine(meta),
    '',
  ];
  if (open.length > 0) {
    lines.push(`**Open (${open.length})**`);
    for (const item of open) lines.push(itemLine(item, false));
    lines.push('');
  }
  if (done.length > 0) {
    lines.push(`<details><summary>Done (${done.length})</summary>`);
    lines.push('');
    for (const item of done) lines.push(itemLine(item, true));
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (meta.reviewers.length > 0) {
    lines.push(meta.reviewers.map(reviewerPhrase).join(' · '));
    lines.push('');
  }
  if (meta.truncated === true) {
    lines.push('_List truncated; open the pull request with Geld to see the rest._');
    lines.push('');
  }
  lines.push(`<details><summary>${DATA_SUMMARY}</summary>`);
  lines.push('');
  lines.push('```' + PAYLOAD_FENCE);
  lines.push(JSON.stringify(meta));
  lines.push('```');
  lines.push('');
  lines.push('</details>');
  lines.push('');
  const openHref = subject === undefined ? howItWorksUrl() : geldPrUrl(subject.owner, subject.repo, subject.number, meta);
  lines.push(`<sub>Maintained by Geld · <a href="${openHref}">Open in Geld</a> · <a href="${howItWorksUrl()}">what is this?</a></sub>`);
  lines.push('');
  return lines.join('\n');
}

export function statusLabel(status: ReviewItem['status']): string {
  return STATUS_LABEL[status];
}
