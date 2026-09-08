import type { HiddenCategory } from './categories';
import { CATEGORIES, categoryById, hiddenCategoryFromCustom } from './categories';
import type { CompiledGlobs } from './glob';
import { compileGlobs, globToRegExp } from './glob';
import type { GeldSettings } from './settings';
import { categoryPatternLines, isCategoryEnabled, isGroupEnabled } from './settings';

export const TESTS_CATEGORY: HiddenCategory = categoryById('tests');

export interface PatternMatch {
  readonly category: HiddenCategory;
  /** The pattern that matched, for explaining decisions in the options tester. */
  readonly pattern: string;
  readonly source: 'built-in' | 'custom';
}

export interface PathMatcher {
  /** Returns the category a path belongs to, or `null` if it should stay visible. */
  categorize(path: string): HiddenCategory | null;
  /** Like {@link categorize} but also says which pattern decided. */
  explain(path: string): PatternMatch | { readonly category: null; readonly rescuedBy: string | null };
  /** Categories that can produce matches with the current settings, in matching order. */
  readonly activeCategories: readonly HiddenCategory[];
}

const NEVER_MATCH: PathMatcher = {
  categorize: () => null,
  explain: () => ({ category: null, rescuedBy: null }),
  activeCategories: [],
};

interface ScopedPatterns {
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
}

const SCOPE_HEADER = /^\[(.*)\]$/;

/**
 * Split a user pattern list into the includes/excludes that apply to `repo`.
 * `[acme/*]` headers scope following lines; `[*]` or `[]` reset.
 */
export function resolveCustomPatterns(lines: readonly string[], repo: string | null): ScopedPatterns {
  const includes: string[] = [];
  const excludes: string[] = [];
  let applies = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = SCOPE_HEADER.exec(line);
    if (header !== null) {
      const scopes = (header[1] ?? '')
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope !== '');
      applies =
        scopes.length === 0 ||
        scopes.some((scope) => scope === '*') ||
        (repo !== null && scopes.some((scope) => repoScopeMatches(scope, repo)));
      continue;
    }
    if (!applies) continue;
    if (line.startsWith('!')) excludes.push(line);
    else includes.push(line);
  }
  return { includes, excludes };
}

function repoScopeMatches(scope: string, repo: string): boolean {
  const pattern = scope.includes('/') ? scope : `${scope}/*`;
  return globToRegExp(pattern, { caseSensitive: false }).test(repo);
}

/**
 * One category ready to match: its built-in patterns (enabled groups), the
 * user's extra patterns, and the user's rescues, which only apply to this
 * category.
 */
interface CompiledCategory {
  readonly category: HiddenCategory;
  readonly builtIn: CompiledGlobs | null;
  readonly custom: CompiledGlobs | null;
  readonly excludes: CompiledGlobs;
}

function compileCategory(category: HiddenCategory, builtInPatterns: readonly string[], user: ScopedPatterns): CompiledCategory | null {
  if (builtInPatterns.length === 0 && user.includes.length === 0) return null;
  return {
    category,
    builtIn: builtInPatterns.length > 0 ? compileGlobs(builtInPatterns) : null,
    custom: user.includes.length > 0 ? compileGlobs(user.includes) : null,
    excludes: compileGlobs(user.excludes.map((pattern) => pattern.slice(1))),
  };
}

/**
 * Build the matcher that decides which files are hidden for the given
 * settings and repository. Custom categories are checked first (a user's own
 * definition wins), then the built-ins in their fixed order; within a
 * category, built-in patterns are attributed before the user's extras.
 */
export function createMatcher(settings: GeldSettings, repo: string | null = null): PathMatcher {
  if (!settings.enabled) return NEVER_MATCH;

  const compiled: CompiledCategory[] = [];

  for (const custom of settings.customCategories) {
    if (!isCategoryEnabled(settings, custom.id)) continue;
    const entry = compileCategory(hiddenCategoryFromCustom(custom), [], resolveCustomPatterns(custom.patterns, repo));
    if (entry !== null) compiled.push(entry);
  }

  for (const category of CATEGORIES) {
    if (!isCategoryEnabled(settings, category.id)) continue;
    const builtIn: string[] = [];
    for (const group of category.groups) {
      if (isGroupEnabled(settings, category.id, group.id)) builtIn.push(...group.patterns);
    }
    const entry = compileCategory(category, builtIn, resolveCustomPatterns(categoryPatternLines(settings, category.id), repo));
    if (entry !== null) compiled.push(entry);
  }
  if (compiled.length === 0) return NEVER_MATCH;

  const cache = new Map<string, HiddenCategory | null>();

  const explain = (path: string): ReturnType<PathMatcher['explain']> => {
    let rescuedBy: string | null = null;
    for (const entry of compiled) {
      const rescue = entry.excludes.firstMatch(path);
      if (rescue !== null) {
        rescuedBy = `!${rescue}`;
        continue;
      }
      const builtIn = entry.builtIn?.firstMatch(path) ?? null;
      if (builtIn !== null) return { category: entry.category, pattern: builtIn, source: 'built-in' };
      const custom = entry.custom?.firstMatch(path) ?? null;
      if (custom !== null) return { category: entry.category, pattern: custom, source: 'custom' };
    }
    return { category: null, rescuedBy };
  };

  return {
    activeCategories: compiled.map((entry) => entry.category),
    explain,
    categorize(path: string): HiddenCategory | null {
      let result = cache.get(path);
      if (result === undefined) {
        result = explain(path).category;
        cache.set(path, result);
      }
      return result;
    },
  };
}
