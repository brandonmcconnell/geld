import type { HiddenCategory } from '@geld/core';
import { CATEGORIES } from '@geld/core';
import type { FileStats } from '@geld/core';
import type { ChangeTotals } from '@geld/core';
import { addTotals, EMPTY_TOTALS, formatCount, pluralize, subtractTotals } from '@geld/core';
import type { PathMatcher } from '@geld/core';

export interface CategoryTotals {
  readonly category: HiddenCategory;
  readonly totals: ChangeTotals;
  readonly paths: readonly string[];
}

/** Everything hidden on a page, in total and per category. */
export interface HiddenBreakdown {
  readonly totals: ChangeTotals;
  readonly categories: readonly CategoryTotals[];
  /** Some hidden files could not report their line counts (binary files). */
  readonly incomplete: boolean;
}

export const EMPTY_BREAKDOWN: HiddenBreakdown = { totals: EMPTY_TOTALS, categories: [], incomplete: false };

export interface Classified {
  readonly path: string;
  readonly category: HiddenCategory | null;
  readonly stats: { readonly additions: number; readonly deletions: number } | null;
}

/** Aggregate already-classified files into a breakdown. */
export function buildBreakdown(items: readonly Classified[]): HiddenBreakdown {
  let totals: ChangeTotals = EMPTY_TOTALS;
  let incomplete = false;
  const perCategory = new Map<HiddenCategory, { totals: ChangeTotals; paths: string[] }>();
  for (const item of items) {
    if (item.category === null) continue;
    if (item.stats === null) incomplete = true;
    const delta = { files: 1, additions: item.stats?.additions ?? 0, deletions: item.stats?.deletions ?? 0 };
    totals = addTotals(totals, delta);
    const bucket = perCategory.get(item.category) ?? { totals: EMPTY_TOTALS, paths: [] };
    bucket.totals = addTotals(bucket.totals, delta);
    bucket.paths.push(item.path);
    perCategory.set(item.category, bucket);
  }
  const categories = Array.from(perCategory, ([category, bucket]) => ({ category, totals: bucket.totals, paths: bucket.paths }));
  categories.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
  return { totals, incomplete, categories };
}

/** Classify raw diff statistics (from a `.diff`) with a matcher. */
export function breakdownFromFiles(
  files: readonly FileStats[],
  matcher: PathMatcher,
): { readonly all: ChangeTotals; readonly hidden: HiddenBreakdown } {
  let all: ChangeTotals = EMPTY_TOTALS;
  const classified: Classified[] = [];
  for (const file of files) {
    all = addTotals(all, { files: 1, additions: file.additions, deletions: file.deletions });
    classified.push({ path: file.path, category: matcher.categorize(file.path), stats: file });
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
    nounPlural,
    categories: hidden.categories.length > 1 ? hidden.categories : [],
  };
}
