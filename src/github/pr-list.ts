import type { FileStats } from '../lib/diff-parse';
import type { ChangeTotals } from '../lib/format';
import { addTotals, EMPTY_TOTALS, formatCount } from '../lib/format';
import type { PathMatcher } from '../lib/matcher';
import type { DiffSource } from './diff-source';
import { createElement, OWN_UI_ATTRIBUTE } from './dom';
import type { StatsBreakdown } from './ui/tooltip';
import { attachBreakdownTooltip, detachBreakdownTooltip } from './ui/tooltip';

export const PR_STAT_CLASS = 'geld-pr-stat';

const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

interface ListRow {
  readonly key: string;
  readonly number: string;
  readonly diffUrl: string;
  readonly row: HTMLElement;
  readonly titleLink: HTMLAnchorElement;
}

/** Find every pull request row in an issues/PR list on the current page. */
function findRows(): ListRow[] {
  const rows = new Map<HTMLElement, ListRow>();
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="/pull/"]')) {
    if (link.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    let url: URL;
    try {
      url = new URL(link.href, window.location.origin);
    } catch {
      continue;
    }
    if (url.origin !== window.location.origin) continue;
    const match = PULL_PATH.exec(url.pathname);
    if (match === null) continue;
    // Only title links: they carry visible text and live in a list row.
    if ((link.textContent ?? '').trim() === '') continue;
    const row = link.closest<HTMLElement>('.js-issue-row, li[role="listitem"]');
    if (row === null || rows.has(row)) continue;
    // Skip links that are clearly not the row's title (comments count, etc.).
    if (link.querySelector('svg') !== null && (link.textContent ?? '').trim().length < 4) continue;
    const [, owner, repo, number] = match;
    if (owner === undefined || repo === undefined || number === undefined) continue;
    rows.set(row, {
      key: `${owner}/${repo}#${number}`,
      number,
      diffUrl: `${url.origin}/${owner}/${repo}/pull/${number}.diff`,
      row,
      titleLink: link,
    });
  }
  return Array.from(rows.values());
}

/**
 * The metadata line ("#123 opened 2 days ago by …"). We look for the element
 * whose own text starts with the PR number, which both GitHub list UIs render.
 */
function findMetaAnchor(row: HTMLElement, number: string): HTMLElement | null {
  const legacy = row.querySelector<HTMLElement>('.opened-by');
  if (legacy !== null) return legacy;
  const prefix = `#${number}`;
  let best: HTMLElement | null = null;
  for (const element of row.querySelectorAll<HTMLElement>('span, div, p')) {
    if (element.closest(`[${OWN_UI_ATTRIBUTE}]`) !== null) continue;
    const text = (element.textContent ?? '').trim();
    if (!text.startsWith(prefix) || text.length > 200) continue;
    if (best === null || text.length <= (best.textContent ?? '').trim().length) best = element;
  }
  return best;
}

interface Breakdown {
  readonly all: ChangeTotals;
  readonly hidden: ChangeTotals;
  readonly visible: ChangeTotals;
}

function breakdownFor(files: readonly FileStats[], matcher: PathMatcher): Breakdown {
  let all: ChangeTotals = EMPTY_TOTALS;
  let hidden: ChangeTotals = EMPTY_TOTALS;
  for (const file of files) {
    const totals = { files: 1, additions: file.additions, deletions: file.deletions };
    all = addTotals(all, totals);
    if (matcher.categorize(file.path) !== null) hidden = addTotals(hidden, totals);
  }
  return {
    all,
    hidden,
    visible: {
      files: all.files - hidden.files,
      additions: all.additions - hidden.additions,
      deletions: all.deletions - hidden.deletions,
    },
  };
}

function ensureChip(row: ListRow): HTMLElement {
  const existing = row.row.querySelector<HTMLElement>(`.${PR_STAT_CLASS}`);
  if (existing !== null) {
    if (existing.dataset.geldPr === row.key) return existing;
    existing.remove();
  }
  const anchor = findMetaAnchor(row.row, row.number);
  const chip = createElement('span', {
    class: PR_STAT_CLASS,
    [OWN_UI_ATTRIBUTE]: '',
    'data-geld-pr': row.key,
    'aria-label': 'Lines changed excluding test files',
  });
  if (anchor !== null) {
    anchor.insertAdjacentElement('afterend', chip);
  } else {
    row.titleLink.insertAdjacentElement('afterend', chip);
    chip.classList.add(`${PR_STAT_CLASS}--inline`);
  }
  return chip;
}

export interface PrListOptions {
  readonly matcher: PathMatcher;
  readonly diffSource: DiffSource;
  readonly nounPlural: string;
}

/** Add `+N −M` (excluding hidden files) to every PR row currently on the page. */
export function applyPrListStats(options: PrListOptions): void {
  for (const row of findRows()) {
    const state = options.diffSource.request(row.diffUrl);
    if (state.status !== 'ready') continue;

    const chip = ensureChip(row);
    const breakdown = breakdownFor(state.files, options.matcher);
    const text = `+${formatCount(breakdown.visible.additions)} \u2212${formatCount(breakdown.visible.deletions)}`;
    if (chip.dataset.rendered !== text) {
      chip.dataset.rendered = text;
      chip.replaceChildren(
        createElement('span', { class: `${PR_STAT_CLASS}__sep`, 'aria-hidden': 'true' }, ['\u2022']),
        createElement('span', { class: `${PR_STAT_CLASS}__add` }, [`+${formatCount(breakdown.visible.additions)}`]),
        createElement('span', { class: `${PR_STAT_CLASS}__del` }, [`\u2212${formatCount(breakdown.visible.deletions)}`]),
      );
    }

    if (breakdown.hidden.files > 0) {
      const tooltip: StatsBreakdown = { ...breakdown, nounPlural: options.nounPlural };
      attachBreakdownTooltip(chip, () => tooltip);
      chip.dataset.hasTests = '';
    } else {
      detachBreakdownTooltip(chip);
      delete chip.dataset.hasTests;
    }
  }
}

export function removePrListStats(): void {
  for (const chip of document.querySelectorAll<HTMLElement>(`.${PR_STAT_CLASS}`)) {
    detachBreakdownTooltip(chip);
    chip.remove();
  }
}
