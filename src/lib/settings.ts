import type { CategoryId } from './categories';
import { CATEGORY_IDS, categoryById, isCategoryId } from './categories';
import type { TestPatternGroupId } from './test-patterns';
import { isTestPatternGroupId } from './test-patterns';

/**
 * User settings. Everything here is persisted to `browser.storage.sync` so it
 * follows the user across devices.
 */
export interface GeldSettings {
  /** Master switch. When off, GitHub pages are left untouched. */
  readonly enabled: boolean;
  /** Which categories of files to hide; missing keys fall back to the category default. */
  readonly categories: Readonly<Partial<Record<CategoryId, boolean>>>;
  /** Fine-grained toggles for the kinds of tests to hide; missing keys mean enabled. */
  readonly testGroups: Readonly<Partial<Record<TestPatternGroupId, boolean>>>;
  /**
   * Extra glob patterns (one per line in the UI), treated like tests. Lines
   * starting with `!` rescue paths; `[owner/repo]` lines scope the patterns
   * that follow to matching repositories (`[*]` returns to global).
   */
  readonly customPatterns: readonly string[];
  /**
   * Repositories where Geld stays off, with gitignore semantics: `owner/repo`
   * or `owner` (= `owner/*`) excludes, `!owner/repo` re-includes, last match
   * wins, `*` excludes everything (use with `!acme/*` for an allowlist).
   */
  readonly repoRules: readonly string[];
  /** Show hidden files expanded instead of collapsed. Counts are adjusted either way. */
  readonly expandedByDefault: boolean;
  /** Show `+N −M` (excluding hidden files) next to each pull request in PR lists. */
  readonly showListStats: boolean;
  /** Ask GitHub to hide whitespace-only changes (`?w=1`) on diff pages. */
  readonly hideWhitespace: boolean;
  /** Honour the browser keyboard shortcut that toggles hidden files. */
  readonly shortcutEnabled: boolean;
  /** Show the hidden-file count on the toolbar icon. */
  readonly showBadge: boolean;
  /** GitHub Enterprise Server hostnames Geld also runs on (permission granted by the user). */
  readonly enterpriseHosts: readonly string[];
}

export const DEFAULT_SETTINGS: GeldSettings = {
  enabled: true,
  categories: {},
  testGroups: {},
  customPatterns: [],
  repoRules: [],
  expandedByDefault: false,
  showListStats: true,
  hideWhitespace: false,
  shortcutEnabled: true,
  showBadge: true,
  enterpriseHosts: [],
};

export const SETTINGS_STORAGE_KEY = 'sync:settings' as const;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function bool(record: Record<string, unknown>, key: keyof GeldSettings, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readCategories(value: unknown, legacyHideTests: unknown): Partial<Record<CategoryId, boolean>> {
  const result: Partial<Record<CategoryId, boolean>> = {};
  if (typeof value === 'object' && value !== null) {
    for (const [key, enabled] of Object.entries(value)) {
      if (isCategoryId(key) && typeof enabled === 'boolean') result[key] = enabled;
    }
  } else if (typeof legacyHideTests === 'boolean') {
    // Settings saved before categories existed.
    result.tests = legacyHideTests;
  }
  return result;
}

function readTestGroups(value: unknown): Partial<Record<TestPatternGroupId, boolean>> {
  const result: Partial<Record<TestPatternGroupId, boolean>> = {};
  if (typeof value === 'object' && value !== null) {
    for (const [key, enabled] of Object.entries(value)) {
      if (isTestPatternGroupId(key) && typeof enabled === 'boolean') result[key] = enabled;
    }
  }
  return result;
}

export function isCategoryEnabled(settings: GeldSettings, id: CategoryId): boolean {
  return settings.categories[id] ?? categoryById(id).defaultEnabled;
}

export function isTestGroupEnabled(settings: GeldSettings, id: TestPatternGroupId): boolean {
  return settings.testGroups[id] ?? true;
}

/** Merge a possibly partial/unknown stored value with the defaults. */
export function normalizeSettings(value: unknown): GeldSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS;
  const record: Record<string, unknown> = { ...value };
  return {
    enabled: bool(record, 'enabled', DEFAULT_SETTINGS.enabled),
    categories: readCategories(record.categories, record.hideTests),
    testGroups: readTestGroups(record.testGroups),
    customPatterns: isStringArray(record.customPatterns) ? record.customPatterns : DEFAULT_SETTINGS.customPatterns,
    repoRules: isStringArray(record.repoRules) ? record.repoRules : DEFAULT_SETTINGS.repoRules,
    expandedByDefault: bool(record, 'expandedByDefault', DEFAULT_SETTINGS.expandedByDefault),
    showListStats: bool(record, 'showListStats', DEFAULT_SETTINGS.showListStats),
    hideWhitespace: bool(record, 'hideWhitespace', DEFAULT_SETTINGS.hideWhitespace),
    shortcutEnabled: bool(record, 'shortcutEnabled', DEFAULT_SETTINGS.shortcutEnabled),
    showBadge: bool(record, 'showBadge', DEFAULT_SETTINGS.showBadge),
    enterpriseHosts: isStringArray(record.enterpriseHosts)
      ? record.enterpriseHosts.map(normalizeHost).filter((host): host is string => host !== null)
      : DEFAULT_SETTINGS.enterpriseHosts,
  };
}

/**
 * Reduce user input such as `https://ghe.example.com/org/repo` to a bare,
 * lower-case hostname. Returns `null` for anything that is not a plausible host.
 */
export function normalizeHost(input: string): string | null {
  let text = input.trim().toLowerCase();
  if (text === '') return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname;
    if (host === '' || host === 'github.com' || !host.includes('.')) return null;
    return host;
  } catch {
    return null;
  }
}

/** All hosts Geld runs on: github.com plus any configured Enterprise servers. */
export function allHosts(settings: GeldSettings): readonly string[] {
  return ['github.com', ...settings.enterpriseHosts];
}

/** Turn a textarea's contents into a clean list of lines (patterns or rules). */
export function parsePatternList(text: string): readonly string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Keys of {@link CategoryId} in display order, for UIs. */
export const CATEGORY_ORDER: readonly CategoryId[] = CATEGORY_IDS;
