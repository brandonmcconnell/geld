import type { HiddenCategory } from './categories';
import { CATEGORIES, categoryById, categoryPatterns } from './categories';
import type { CompiledGlobs } from './glob';
import { compileGlobs, globToRegExp } from './glob';
import type { GeldSettings } from './settings';
import { isCategoryEnabled, isTestGroupEnabled } from './settings';
import { TEST_PATTERN_GROUP_IDS } from './test-patterns';

export type { HiddenCategory } from './categories';

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
  /** Categories that can produce matches with the current settings. */
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
 * Split the custom pattern list into the includes/excludes that apply to
 * `repo`. `[acme/*]` headers scope following lines; `[*]` or `[]` reset.
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

interface CompiledCategory {
  readonly category: HiddenCategory;
  readonly globs: CompiledGlobs;
  readonly source: PatternMatch['source'];
}

/** Build the matcher that decides which files are hidden for the given settings and repository. */
export function createMatcher(settings: GeldSettings, repo: string | null = null): PathMatcher {
  if (!settings.enabled) return NEVER_MATCH;

  const custom = resolveCustomPatterns(settings.customPatterns, repo);
  const compiled: CompiledCategory[] = [];

  for (const category of CATEGORIES) {
    if (!isCategoryEnabled(settings, category.id)) continue;
    const groupIds =
      category.id === 'tests'
        ? new Set(TEST_PATTERN_GROUP_IDS.filter((id) => isTestGroupEnabled(settings, id)))
        : null;
    const patterns = categoryPatterns(category, groupIds);
    if (patterns.length === 0) continue;
    compiled.push({ category, globs: compileGlobs(patterns), source: 'built-in' });
  }
  // Custom patterns count as tests and are checked last so built-in
  // attribution wins when both match.
  if (custom.includes.length > 0) {
    compiled.push({ category: TESTS_CATEGORY, globs: compileGlobs(custom.includes), source: 'custom' });
  }
  if (compiled.length === 0) return NEVER_MATCH;

  const excludes = compileGlobs(custom.excludes.map((pattern) => pattern.slice(1)));
  const cache = new Map<string, HiddenCategory | null>();

  const explain = (path: string): ReturnType<PathMatcher['explain']> => {
    const rescuedBy = excludes.firstMatch(path);
    if (rescuedBy !== null) return { category: null, rescuedBy: `!${rescuedBy}` };
    for (const entry of compiled) {
      const pattern = entry.globs.firstMatch(path);
      if (pattern !== null) return { category: entry.category, pattern, source: entry.source };
    }
    return { category: null, rescuedBy: null };
  };

  const activeCategories: HiddenCategory[] = [];
  for (const entry of compiled) {
    if (!activeCategories.includes(entry.category)) activeCategories.push(entry.category);
  }

  return {
    activeCategories,
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
