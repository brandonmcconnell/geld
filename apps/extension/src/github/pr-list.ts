import { formatCount } from '@geld/core';
import type { PathMatcher } from '@geld/core';
import type { RepoRule } from '@geld/core';
import { decideRepo } from '@geld/core';
import { breakdownFromFiles, hiddenLabel, hiddenNounPlural, statsBreakdown } from './breakdown';
import type { DiffSource } from './diff-source';
import { createElement, OWN_UI_ATTRIBUTE } from './dom';
import { TESTS_COUNT_CLASS } from './header-stats';
import { attachBreakdownTooltip, detachBreakdownTooltip } from './ui/tooltip';

export const PR_STAT_CLASS = 'geld-pr-stat';

const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

export interface ListRow {
  readonly key: string;
  readonly repo: string;
  readonly number: string;
  readonly diffUrl: string;
  readonly row: HTMLElement;
  readonly titleLink: HTMLAnchorElement;
}

/**
 * The list row a PR title link belongs to. Issue/PR lists (classic and React)
 * and the "Stack #N" popover of stacked pull requests, whose items are
 * ActionList entries linking to each PR with a "#N · branch" description. The
 * popover mounts lazily and may virtualise; both are covered because chips
 * are re-applied on every DOM mutation.
 */
function rowOf(link: HTMLAnchorElement): HTMLElement | null {
  const listRow = link.closest<HTMLElement>('.js-issue-row, li[role="listitem"]');
  if (listRow !== null) return listRow;
  const item = link.closest<HTMLElement>('li[data-component="ActionList.Item"]');
  if (item !== null && item.closest('[class*="StackState"]') !== null) return item;
  return null;
}

/** Find every pull request row in an issues/PR list on the current page. */
export function findRows(): ListRow[] {
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
    const row = rowOf(link);
    if (row === null || rows.has(row)) continue;
    // Skip links that are clearly not the row's title (comments count, etc.).
    if (link.querySelector('svg') !== null && (link.textContent ?? '').trim().length < 4) continue;
    const [, owner, repo, number] = match;
    if (owner === undefined || repo === undefined || number === undefined) continue;
    rows.set(row, {
      key: `${owner}/${repo}#${number}`,
      repo: `${owner}/${repo}`,
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
    // ActionList descriptions (stack popover) are block-level: append inside to stay on the "#N · branch" line.
    if (anchor.getAttribute('data-component') === 'ActionList.Description') anchor.append(chip);
    else anchor.insertAdjacentElement('afterend', chip);
  } else {
    row.titleLink.insertAdjacentElement('afterend', chip);
    chip.classList.add(`${PR_STAT_CLASS}--inline`);
  }
  return chip;
}

export interface PrListOptions {
  /** Matcher for a given repository (custom patterns can be repo-scoped). */
  readonly matcherFor: (repo: string) => PathMatcher;
  /** Leave comment-only lines of visible files out of the chip's numbers, as the header does. */
  readonly hideCommentLines: boolean;
  readonly repoRules: readonly RepoRule[];
  readonly diffSource: DiffSource;
  /** Called when a row scrolls near the viewport and its diff should be requested. */
  readonly onRowVisible: () => void;
}

const SEEN_ATTRIBUTE = 'data-geld-seen';
let visibilityObserver: IntersectionObserver | null = null;

/**
 * Only fetch diffs for rows the user can (almost) see. Long lists and quick
 * pagination would otherwise fire dozens of requests per page.
 */
function watchVisibility(rows: readonly ListRow[], onRowVisible: () => void): void {
  if (typeof IntersectionObserver === 'undefined') {
    for (const row of rows) row.row.setAttribute(SEEN_ATTRIBUTE, '');
    return;
  }
  if (visibilityObserver === null) {
    visibilityObserver = new IntersectionObserver(
      (entries, observer) => {
        let anyVisible = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute(SEEN_ATTRIBUTE, '');
          observer.unobserve(entry.target);
          anyVisible = true;
        }
        if (anyVisible) onRowVisible();
      },
      { rootMargin: '300px 0px' },
    );
  }
  for (const row of rows) {
    if (!row.row.hasAttribute(SEEN_ATTRIBUTE)) visibilityObserver.observe(row.row);
  }
}

/** Add `+N −M` (excluding hidden files) to every PR row currently on the page. */
export function applyPrListStats(options: PrListOptions): void {
  const rows = findRows();
  watchVisibility(rows, options.onRowVisible);
  for (const row of rows) {
    if (!row.row.hasAttribute(SEEN_ATTRIBUTE)) continue;
    // Repositories excluded by the rules get no chip at all (the global PR
    // dashboard mixes repositories, so this is decided per row).
    if (!decideRepo(options.repoRules, row.repo).allowed) {
      row.row.querySelector(`.${PR_STAT_CLASS}`)?.remove();
      continue;
    }
    const state = options.diffSource.request(row.diffUrl);
    if (state.status !== 'ready') continue;

    const matcher = options.matcherFor(row.repo);
    const chip = ensureChip(row);
    const { all, hidden } = breakdownFromFiles(state.files, matcher, options.hideCommentLines);
    const breakdown = statsBreakdown(all, hidden, hiddenNounPlural(matcher.activeCategories));
    const label = hiddenLabel(hidden, matcher.activeCategories);
    const text = `${label} +${formatCount(breakdown.visible.additions)} \u2212${formatCount(breakdown.visible.deletions)}`;
    if (chip.dataset.rendered !== text) {
      chip.dataset.rendered = text;
      const tests = createElement('span', { class: `${PR_STAT_CLASS}__tests ${TESTS_COUNT_CLASS}` }, [label]);
      tests.toggleAttribute('data-has-tests', hidden.totals.files > 0);
      chip.replaceChildren(
        createElement('span', { class: `${PR_STAT_CLASS}__sep`, 'aria-hidden': 'true' }, ['\u2022']),
        tests,
        createElement('span', { class: `${PR_STAT_CLASS}__add` }, [`+${formatCount(breakdown.visible.additions)}`]),
        createElement('span', { class: `${PR_STAT_CLASS}__del` }, [`\u2212${formatCount(breakdown.visible.deletions)}`]),
      );
    }

    if (hidden.totals.files > 0) {
      attachBreakdownTooltip(chip, () => breakdown);
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
  visibilityObserver?.disconnect();
  visibilityObserver = null;
  for (const row of document.querySelectorAll(`[${SEEN_ATTRIBUTE}]`)) row.removeAttribute(SEEN_ATTRIBUTE);
}
