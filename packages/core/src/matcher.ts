import type { Catalog, HiddenCategory } from './categories';
import { BUNDLED_CATALOG, CHANGE_KINDS_CATEGORY_ID, categoryById, hiddenCategoryFromCustom } from './categories';
import type { ChangeKindId, FileFacts } from './change-kinds';
import { changeKindsOf, isChangeKindId } from './change-kinds';
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

/** A file attributed to the Trivial changes category by what changed in it. */
export interface KindMatch {
  readonly category: HiddenCategory;
  readonly kind: ChangeKindId;
  readonly source: 'kind';
}

export type NoMatch = { readonly category: null; readonly rescuedBy: string | null };

export interface PathMatcher {
  /** Returns the category a path belongs to, or `null` if it should stay visible. Path only: change kinds need {@link categorizeFile}. */
  categorize(path: string): HiddenCategory | null;
  /** Like {@link categorize}, but also weighs what changed (renames, binary, whitespace-only, …) when that category is on. */
  categorizeFile(facts: FileFacts): HiddenCategory | null;
  /** Like {@link categorize} but also says which pattern decided. */
  explain(path: string): PatternMatch | NoMatch;
  /** Like {@link categorizeFile} but also says which pattern or change kind decided. */
  explainFile(facts: FileFacts): PatternMatch | KindMatch | NoMatch;
  /** Categories that can produce matches with the current settings, in matching order. */
  readonly activeCategories: readonly HiddenCategory[];
  /** Whether {@link categorizeFile} can say more than {@link categorize}: the Trivial changes category is on with at least one kind. */
  readonly usesChangeKinds: boolean;
}

const NEVER_MATCH: PathMatcher = {
  categorize: () => null,
  categorizeFile: () => null,
  explain: () => ({ category: null, rescuedBy: null }),
  explainFile: () => ({ category: null, rescuedBy: null }),
  activeCategories: [],
  usesChangeKinds: false,
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
  /** Change kinds this category claims (only the Trivial changes category has any). */
  readonly kinds: ReadonlySet<ChangeKindId>;
}

function compileCategory(category: HiddenCategory, builtInPatterns: readonly string[], user: ScopedPatterns, kinds: ReadonlySet<ChangeKindId> = new Set()): CompiledCategory | null {
  if (builtInPatterns.length === 0 && user.includes.length === 0 && kinds.size === 0) return null;
  return {
    category,
    builtIn: builtInPatterns.length > 0 ? compileGlobs(builtInPatterns) : null,
    custom: user.includes.length > 0 ? compileGlobs(user.includes) : null,
    excludes: compileGlobs(user.excludes.map((pattern) => pattern.slice(1))),
    kinds,
  };
}

/**
 * Build the matcher that decides which files are hidden for the given
 * settings and repository. Custom categories are checked first (a user's own
 * definition wins), then the built-ins in their fixed order; within a
 * category, built-in patterns are attributed before the user's extras. The
 * built-in patterns come from `catalog` — the extension passes the active
 * (possibly fetched) one; the site and tests use the bundled default.
 */
export function createMatcher(settings: GeldSettings, repo: string | null = null, catalog: Catalog = BUNDLED_CATALOG): PathMatcher {
  if (!settings.enabled) return NEVER_MATCH;

  const compiled: CompiledCategory[] = [];

  for (const custom of settings.customCategories) {
    if (!isCategoryEnabled(settings, custom.id)) continue;
    const entry = compileCategory(hiddenCategoryFromCustom(custom), [], resolveCustomPatterns(custom.patterns, repo));
    if (entry !== null) compiled.push(entry);
  }

  for (const category of catalog.categories) {
    if (!isCategoryEnabled(settings, category.id)) continue;
    const builtIn: string[] = [];
    const kinds = new Set<ChangeKindId>();
    for (const group of category.groups) {
      if (!isGroupEnabled(settings, category.id, group.id)) continue;
      builtIn.push(...group.patterns);
      if (category.id === CHANGE_KINDS_CATEGORY_ID && isChangeKindId(group.id)) kinds.add(group.id);
    }
    const entry = compileCategory(category, builtIn, resolveCustomPatterns(categoryPatternLines(settings, category.id), repo), kinds);
    if (entry !== null) compiled.push(entry);
  }
  if (compiled.length === 0) return NEVER_MATCH;

  const cache = new Map<string, HiddenCategory | null>();
  const usesChangeKinds = compiled.some((entry) => entry.kinds.size > 0);

  const explainFile = (facts: FileFacts): PatternMatch | KindMatch | NoMatch => {
    const path = facts.path;
    let rescuedBy: string | null = null;
    // Computed lazily: most files never reach a kind-based category.
    let kinds: readonly ChangeKindId[] | null = null;
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
      if (entry.kinds.size > 0) {
        kinds ??= changeKindsOf(facts);
        const kind = kinds.find((candidate) => entry.kinds.has(candidate));
        if (kind !== undefined) return { category: entry.category, kind, source: 'kind' };
      }
    }
    return { category: null, rescuedBy };
  };

  const explain = (path: string): PatternMatch | NoMatch => {
    const verdict = explainFile({ path });
    // A bare path carries no kinds, so a kind match cannot happen here.
    return verdict.category !== null && verdict.source === 'kind' ? { category: null, rescuedBy: null } : verdict;
  };

  const categorize = (path: string): HiddenCategory | null => {
    let result = cache.get(path);
    if (result === undefined) {
      result = explain(path).category;
      cache.set(path, result);
    }
    return result;
  };

  return {
    activeCategories: compiled.map((entry) => entry.category),
    usesChangeKinds,
    explain,
    explainFile,
    categorize,
    categorizeFile(facts: FileFacts): HiddenCategory | null {
      if (!usesChangeKinds) return categorize(facts.path);
      return explainFile(facts).category;
    },
  };
}
