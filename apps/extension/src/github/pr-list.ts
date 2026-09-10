import { formatCount } from '@geld/core';
import type { PathMatcher } from '@geld/core';
import type { RepoRule } from '@geld/core';
import { decideRepo } from '@geld/core';
import { breakdownFromFiles, hiddenLabel, hiddenNounPlural, statsBreakdown } from './breakdown';
import type { DiffSource } from './diff-source';
import { createElement, OWN_UI_ATTRIBUTE } from './dom';
import { TESTS_COUNT_CLASS } from './header-stats';
import type { ListSurface } from './list-surfaces';
import { ATTR_SURFACE, surfaceOf } from './list-surfaces';
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
  /** Which GitHub list UI the row belongs to (see `list-surfaces.ts`). */
  readonly surface: ListSurface;
}

/**
 * Find every pull request row on the current page: issue/PR lists (classic
 * and React) and the "Stack #N" popover. Which UI a row belongs to is decided
 * by the catalog's list surfaces (`list-surfaces.ts`); rows are stamped with `data-geld-surface` so CSS can
 * address each UI on its own. Rows are re-discovered on every DOM mutation, so
 * lazily mounted or virtualised lists are covered.
 */
export function findRows(surfaces: readonly ListSurface[]): ListRow[] {
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
    const owner = surfaceOf(surfaces, link);
    if (owner === null || rows.has(owner.row)) continue;
    // Skip links that are clearly not the row's title (comments count, etc.).
    if (link.querySelector('svg') !== null && (link.textContent ?? '').trim().length < 4) continue;
    const [, repoOwner, repo, number] = match;
    if (repoOwner === undefined || repo === undefined || number === undefined) continue;
    owner.row.setAttribute(ATTR_SURFACE, owner.surface.id);
    rows.set(owner.row, {
      key: `${repoOwner}/${repo}#${number}`,
      repo: `${repoOwner}/${repo}`,
      number,
      diffUrl: `${url.origin}/${repoOwner}/${repo}/pull/${number}.diff`,
      row: owner.row,
      titleLink: link,
      surface: owner.surface,
    });
  }
  return Array.from(rows.values());
}

function ensureChip(row: ListRow): HTMLElement {
  const existing = row.row.querySelector<HTMLElement>(`.${PR_STAT_CLASS}`);
  if (existing !== null) {
    if (existing.dataset.geldPr === row.key) return existing;
    existing.remove();
  }
  const chip = createElement('span', {
    class: PR_STAT_CLASS,
    [OWN_UI_ATTRIBUTE]: '',
    'data-geld-pr': row.key,
    [ATTR_SURFACE]: row.surface.id,
    'aria-label': 'Lines changed excluding test files',
  });
  const anchor = row.surface.chipAnchor(row.row, row.number);
  if (anchor === null) {
    row.titleLink.insertAdjacentElement('afterend', chip);
    chip.classList.add(`${PR_STAT_CLASS}--inline`);
  } else if (anchor.placement === 'append') {
    anchor.element.append(chip);
  } else {
    anchor.element.insertAdjacentElement('afterend', chip);
  }
  return chip;
}

export interface PrListOptions {
  /** Matcher for a given repository (custom patterns can be repo-scoped). */
  readonly matcherFor: (repo: string) => PathMatcher;
  /** The list UIs to recognise (from the active catalog). */
  readonly surfaces: readonly ListSurface[];
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
  const rows = findRows(options.surfaces);
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
    // With nothing that could be hidden the chip is plain line counts: "0 hidden" would be noise.
    const label = matcher.activeCategories.length === 0 ? null : hiddenLabel(hidden, matcher.activeCategories);
    const text = `${label ?? ''} +${formatCount(breakdown.visible.additions)} \u2212${formatCount(breakdown.visible.deletions)}`;
    if (chip.dataset.rendered !== text) {
      chip.dataset.rendered = text;
      const tests = label === null ? [] : [createElement('span', { class: `${PR_STAT_CLASS}__tests ${TESTS_COUNT_CLASS}` }, [label])];
      tests[0]?.toggleAttribute('data-has-tests', hidden.totals.files > 0);
      chip.replaceChildren(
        createElement('span', { class: `${PR_STAT_CLASS}__sep`, 'aria-hidden': 'true' }, ['\u2022']),
        ...tests,
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
