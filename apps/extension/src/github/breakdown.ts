import type { HiddenCategory } from '@geld/core';
import { CATEGORY_IDS } from '@geld/core';
import type { CommentLines, FileStats } from '@geld/core';
import type { ChangeTotals } from '@geld/core';
import { addTotals, EMPTY_TOTALS, formatCount, pluralize, subtractTotals } from '@geld/core';
import type { PathMatcher } from '@geld/core';

export interface CategoryTotals {
  readonly category: HiddenCategory;
  readonly totals: ChangeTotals;
  readonly paths: readonly string[];
}

/** Comment-only lines collapsed inside files that stay visible. */
export interface HiddenLines {
  readonly additions: number;
  readonly deletions: number;
}

export const NO_LINES: HiddenLines = { additions: 0, deletions: 0 };

/** Everything hidden on a page, in total and per category. */
export interface HiddenBreakdown {
  /** Hidden files (`files`) and every hidden line, including {@link lines}. */
  readonly totals: ChangeTotals;
  readonly categories: readonly CategoryTotals[];
  /** Some hidden files could not report their line counts (binary files). */
  readonly incomplete: boolean;
  /** The part of `totals` that is comment-only lines inside visible files. */
  readonly lines: HiddenLines;
}

export const EMPTY_BREAKDOWN: HiddenBreakdown = { totals: EMPTY_TOTALS, categories: [], incomplete: false, lines: NO_LINES };

/** Whether a breakdown changes any number on the page. */
export function hidesAnything(breakdown: HiddenBreakdown): boolean {
  return breakdown.totals.files > 0 || breakdown.lines.additions + breakdown.lines.deletions > 0;
}

export interface Classified {
  readonly path: string;
  readonly category: HiddenCategory | null;
  readonly stats: { readonly additions: number; readonly deletions: number } | null;
  /** Comment-only lines to collapse when the file stays visible (only set when that setting is on). */
  readonly commentLines?: CommentLines;
}

/** Aggregate already-classified files into a breakdown. */
export function buildBreakdown(items: readonly Classified[]): HiddenBreakdown {
  let totals: ChangeTotals = EMPTY_TOTALS;
  let incomplete = false;
  let lines: HiddenLines = NO_LINES;
  const perCategory = new Map<HiddenCategory, { totals: ChangeTotals; paths: string[] }>();
  for (const item of items) {
    if (item.category === null) {
      if (item.commentLines !== undefined) {
        const delta = { files: 0, additions: item.commentLines.added.length, deletions: item.commentLines.removed.length };
        totals = addTotals(totals, delta);
        lines = { additions: lines.additions + delta.additions, deletions: lines.deletions + delta.deletions };
      }
      continue;
    }
    if (item.stats === null) incomplete = true;
    const delta = { files: 1, additions: item.stats?.additions ?? 0, deletions: item.stats?.deletions ?? 0 };
    totals = addTotals(totals, delta);
    const bucket = perCategory.get(item.category) ?? { totals: EMPTY_TOTALS, paths: [] };
    bucket.totals = addTotals(bucket.totals, delta);
    bucket.paths.push(item.path);
    perCategory.set(item.category, bucket);
  }
  const categories = Array.from(perCategory, ([category, bucket]) => ({ category, totals: bucket.totals, paths: bucket.paths }));
  // Built-ins keep their fixed order (the same in every catalog, since a fetched
  // one cannot add or reorder categories); custom categories sort first, as they match first.
  const order = (category: HiddenCategory): number => CATEGORY_IDS.findIndex((id) => id === category.id);
  categories.sort((a, b) => order(a.category) - order(b.category));
  return { totals, incomplete, categories, lines };
}

/** Classify raw diff statistics (from a `.diff`) with a matcher; `hideCommentLines` also collapses comment-only lines of visible files. */
export function breakdownFromFiles(
  files: readonly FileStats[],
  matcher: PathMatcher,
  hideCommentLines = false,
): { readonly all: ChangeTotals; readonly hidden: HiddenBreakdown } {
  let all: ChangeTotals = EMPTY_TOTALS;
  const classified: Classified[] = [];
  for (const file of files) {
    all = addTotals(all, { files: 1, additions: file.additions, deletions: file.deletions });
    const item: Classified = { path: file.path, category: matcher.categorizeFile(file), stats: file };
    classified.push(hideCommentLines && file.commentLines !== undefined ? { ...item, commentLines: file.commentLines } : item);
  }
  return { all, hidden: buildBreakdown(classified) };
}

/**
 * Wording for a set of hidden files: "6 tests" when only one category can be
 * hidden, otherwise "9 hidden" (the tooltip carries the per-category split).
 */
export function hiddenLabel(breakdown: HiddenBreakdown, activeCategories: readonly HiddenCategory[]): string {
  const only = activeCategories.length === 1 ? activeCategories[0] : undefined;
  if (only !== undefined) return pluralize(breakdown.totals.files, only.shortNoun, only.shortNounPlural);
  return `${formatCount(breakdown.totals.files)} hidden`;
}

/** Long-form noun for sentences ("test files" vs "hidden files"). */
export function hiddenNounPlural(activeCategories: readonly HiddenCategory[]): string {
  const only = activeCategories.length === 1 ? activeCategories[0] : undefined;
  return only === undefined ? 'hidden files' : only.nounPlural;
}

export function hiddenNoun(activeCategories: readonly HiddenCategory[]): string {
  const only = activeCategories.length === 1 ? activeCategories[0] : undefined;
  return only === undefined ? 'hidden file' : only.noun;
}

/** "6 tests · 3 generated" for the chips row; empty when only one category is present. */
export function categoryChips(breakdown: HiddenBreakdown): string {
  if (breakdown.categories.length <= 1) return '';
  return breakdown.categories
    .map((entry) => pluralize(entry.totals.files, entry.category.shortNoun, entry.category.shortNounPlural))
    .join(' \u00b7 ');
}

export interface StatsBreakdown {
  readonly visible: ChangeTotals;
  readonly hidden: ChangeTotals;
  readonly all: ChangeTotals;
  /** Comment-only lines collapsed inside visible files (part of `hidden`'s line counts). */
  readonly lines: HiddenLines;
  /** Long noun for the hidden set ("test files" / "hidden files"). */
  readonly nounPlural: string;
  /** Per-category rows when more than one category is present. */
  readonly categories: readonly CategoryTotals[];
}

export function statsBreakdown(all: ChangeTotals, hidden: HiddenBreakdown, nounPlural: string): StatsBreakdown {
  return {
    all,
    hidden: hidden.totals,
    visible: subtractTotals(all, hidden.totals),
    lines: hidden.lines,
    nounPlural,
    categories: hidden.categories.length > 1 ? hidden.categories : [],
  };
}
