import type { AnyCategoryId, Catalog, CategoryId, CustomCategory, GroupKey, HiddenCategory } from './categories';
import { BUNDLED_CATALOG, CATEGORY_IDS, categoryById, groupKey, hiddenCategoryFromCustom, isCategoryId, isCustomCategoryId, isWellFormedGroupKey } from './categories';
import { isCategoryIconName } from './category-icons';
import type { TestPatternGroupId } from './test-patterns';
import { isTestPatternGroupId } from './test-patterns';

/**
 * User settings. Everything here is persisted to `browser.storage.sync` so it
 * follows the user across devices.
 */
export interface GeldSettings {
  /** Master switch. When off, GitHub pages are left untouched. */
  readonly enabled: boolean;
  /**
   * Which categories of files to hide (built-in or custom ids); missing keys
   * fall back to the category default (tests and custom categories on, the
   * other built-ins off).
   */
  readonly categories: Readonly<Partial<Record<AnyCategoryId, boolean>>>;
  /**
   * Built-in pattern groups switched off, keyed `category/group`
   * (`tests/snapshots`, `generated/lockfiles`); missing keys mean enabled.
   */
  readonly groups: Readonly<Partial<Record<GroupKey, boolean>>>;
  /**
   * Extra patterns per built-in category (one per line in the UI). Lines
   * starting with `!` rescue paths from that category; `[owner/repo]` lines
   * scope the patterns that follow to matching repositories (`[*]` returns to
   * global). Custom categories keep their patterns on the category itself.
   */
  readonly categoryPatterns: Readonly<Partial<Record<CategoryId, readonly string[]>>>;
  /** Categories the user defined, in the order they are matched (before built-ins). */
  readonly customCategories: readonly CustomCategory[];
  /**
   * Repositories where Geld stays off, with gitignore semantics: `owner/repo`
   * or `owner` (= `owner/*`) excludes, `!owner/repo` re-includes, last match
   * wins, `*` excludes everything (use with `!acme/*` for an allowlist).
   */
  readonly repoRules: readonly string[];
  /**
   * Layout for hidden files. `true`: moved to a collapsible section at the
   * bottom of the diff and to their own sidebar panels (the accordion).
   * `false`: left in place, collapsed and faded, with their category's icon
   * in the file tree. Counts are adjusted either way.
   */
  readonly groupHidden: boolean;
  /** Show hidden files expanded instead of collapsed. Counts are adjusted either way. */
  readonly expandedByDefault: boolean;
  /**
   * Inside files that stay visible, collapse changed lines that only touch
   * code comments (or are blank), with a row that says how many and shows
   * them on click. Header counts exclude those lines.
   */
  readonly hideCommentLines: boolean;
  /** Show `+N −M` (excluding hidden files) next to each pull request in PR lists. */
  readonly showListStats: boolean;
  /** Ask GitHub to hide whitespace-only changes (`?w=1`) on diff pages. */
  readonly hideWhitespace: boolean;
  /** Honour the browser keyboard shortcut that toggles hidden files. */
  readonly shortcutEnabled: boolean;
  /** Show the hidden-file count on the toolbar icon. */
  readonly showBadge: boolean;
  /**
   * Fetch the signed pattern catalog from the Geld repository (daily) and use
   * it when it is newer than the bundled one. Off: only the patterns that
   * shipped with this build are used.
   */
  readonly autoUpdatePatterns: boolean;
  /** GitHub Enterprise Server hostnames Geld also runs on (permission granted by the user). */
  readonly enterpriseHosts: readonly string[];
  /**
   * Whether a repository's own `.github/geld.yml` (and its organisation's
   * defaults) may add to these settings on that repository. `ask` waits for a
   * one-time decision per repository, made in the popup.
   */
  readonly repoConfigs: RepoConfigMode;
}

export const REPO_CONFIG_MODES = ['always', 'ask', 'never'] as const;
export type RepoConfigMode = (typeof REPO_CONFIG_MODES)[number];

export function isRepoConfigMode(value: unknown): value is RepoConfigMode {
  return typeof value === 'string' && REPO_CONFIG_MODES.some((mode) => mode === value);
}

export const DEFAULT_SETTINGS: GeldSettings = {
  enabled: true,
  categories: {},
  groups: {},
  categoryPatterns: {},
  customCategories: [],
  repoRules: [],
  groupHidden: true,
  expandedByDefault: false,
  hideCommentLines: false,
  showListStats: true,
  hideWhitespace: false,
  shortcutEnabled: true,
  showBadge: true,
  autoUpdatePatterns: true,
  enterpriseHosts: [],
  repoConfigs: 'ask',
};

export const SETTINGS_STORAGE_KEY = 'sync:settings' as const;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function bool(record: Record<string, unknown>, key: keyof GeldSettings, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCategories(value: unknown, legacyHideTests: unknown, customIds: ReadonlySet<string>): Partial<Record<AnyCategoryId, boolean>> {
  const result: Partial<Record<AnyCategoryId, boolean>> = {};
  if (isRecord(value)) {
    for (const [key, enabled] of Object.entries(value)) {
      if (typeof enabled !== 'boolean') continue;
      // Flags for custom categories that no longer exist are dropped.
      if (isCategoryId(key) || (isCustomCategoryId(key) && customIds.has(key))) result[key] = enabled;
    }
  } else if (typeof legacyHideTests === 'boolean') {
    // Settings saved before categories existed.
    result.tests = legacyHideTests;
  }
  return result;
}

function readGroups(value: unknown, legacyTestGroups: unknown): Partial<Record<GroupKey, boolean>> {
  const result: Partial<Record<GroupKey, boolean>> = {};
  if (isRecord(value)) {
    for (const [key, enabled] of Object.entries(value)) {
      // Well-formed keys for groups this build does not know are kept, not
      // dropped: they may belong to a newer pattern catalog (or have been
      // written by a newer extension into the shared gist), and losing them
      // would silently turn those groups back on there.
      if (isWellFormedGroupKey(key) && typeof enabled === 'boolean') result[key] = enabled;
    }
  }
  // Settings saved when only test groups could be toggled.
  if (isRecord(legacyTestGroups)) {
    for (const [key, enabled] of Object.entries(legacyTestGroups)) {
      if (isTestPatternGroupId(key) && typeof enabled === 'boolean' && result[groupKey('tests', key)] === undefined) {
        result[groupKey('tests', key)] = enabled;
      }
    }
  }
  return result;
}

function readCategoryPatterns(value: unknown, legacyCustomPatterns: unknown): Partial<Record<CategoryId, readonly string[]>> {
  const result: Partial<Record<CategoryId, readonly string[]>> = {};
  if (isRecord(value)) {
    for (const [key, lines] of Object.entries(value)) {
      if (isCategoryId(key) && isStringArray(lines) && lines.length > 0) result[key] = lines;
    }
  }
  // Settings saved when custom patterns were a single list "treated as tests".
  if (isStringArray(legacyCustomPatterns) && legacyCustomPatterns.length > 0) {
    result.tests = [...legacyCustomPatterns, ...(result.tests ?? [])];
  }
  return result;
}

function readCustomCategory(value: unknown, taken: Set<string>): CustomCategory | null {
  if (!isRecord(value)) return null;
  const { id, title, icon, patterns, noun, nounPlural } = value;
  if (!isCustomCategoryId(id) || taken.has(id)) return null;
  if (typeof title !== 'string' || title.trim() === '') return null;
  taken.add(id);
  const custom: CustomCategory = {
    id,
    title: title.trim().slice(0, 40),
    icon: isCategoryIconName(icon) ? icon : 'tag',
    patterns: isStringArray(patterns) ? patterns : [],
    ...(typeof noun === 'string' && noun.trim() !== '' ? { noun: noun.trim() } : {}),
    ...(typeof nounPlural === 'string' && nounPlural.trim() !== '' ? { nounPlural: nounPlural.trim() } : {}),
  };
  return custom;
}

function readCustomCategories(value: unknown): readonly CustomCategory[] {
  if (!Array.isArray(value)) return [];
  const taken = new Set<string>();
  const result: CustomCategory[] = [];
  for (const entry of value) {
    const custom = readCustomCategory(entry, taken);
    if (custom !== null) result.push(custom);
  }
  return result;
}

/**
 * Whether a category hides anything. Built-in defaults deliberately come from
 * the bundled catalog, never a fetched one: a remote file must not be able to
 * switch a category on for everyone.
 */
export function isCategoryEnabled(settings: GeldSettings, id: AnyCategoryId): boolean {
  const stored = settings.categories[id];
  if (stored !== undefined) return stored;
  return isCategoryId(id) ? categoryById(id, BUNDLED_CATALOG).defaultEnabled : true;
}

/** Whether a built-in pattern group applies (missing keys mean enabled). */
export function isGroupEnabled(settings: GeldSettings, categoryId: CategoryId, groupId: string): boolean {
  return settings.groups[groupKey(categoryId, groupId)] ?? true;
}

/** Shorthand for {@link isGroupEnabled} on the Tests category. */
export function isTestGroupEnabled(settings: GeldSettings, id: TestPatternGroupId): boolean {
  return isGroupEnabled(settings, 'tests', id);
}

/** Extra user patterns for a built-in category (possibly empty). */
export function categoryPatternLines(settings: GeldSettings, categoryId: CategoryId): readonly string[] {
  return settings.categoryPatterns[categoryId] ?? [];
}

export function customCategoryById(settings: GeldSettings, id: AnyCategoryId): CustomCategory | null {
  return settings.customCategories.find((custom) => custom.id === id) ?? null;
}

/**
 * Every category the settings know about, in matching order: custom
 * categories first (a user's own definition beats a built-in), then the
 * built-ins of `catalog` in their fixed order.
 */
export function allCategories(settings: GeldSettings, catalog: Catalog = BUNDLED_CATALOG): readonly HiddenCategory[] {
  return [...settings.customCategories.map(hiddenCategoryFromCustom), ...catalog.categories];
}

/** Look up any category id; `null` when a custom id is not (or no longer) defined. */
export function findCategory(settings: GeldSettings, id: AnyCategoryId, catalog: Catalog = BUNDLED_CATALOG): HiddenCategory | null {
  if (isCategoryId(id)) return categoryById(id, catalog);
  const custom = customCategoryById(settings, id);
  return custom === null ? null : hiddenCategoryFromCustom(custom);
}

/**
 * Whether a built-in category has anything beyond its on/off switch in use:
 * a disabled group or extra patterns. UIs open the "advanced" disclosure
 * when this is true.
 */
export function hasAdvancedSettings(settings: GeldSettings, categoryId: CategoryId, catalog: Catalog = BUNDLED_CATALOG): boolean {
  return describeAdvancedSettings(settings, categoryId, catalog) !== null;
}

/**
 * Short summary of what is customised in a built-in category, for its
 * collapsed row ("1 group off · 3 extra patterns"); `null` when nothing is.
 * Only groups the catalog defines count: a stored key for a group this build
 * does not know is kept but is not something the user can see here.
 */
export function describeAdvancedSettings(settings: GeldSettings, categoryId: CategoryId, catalog: Catalog = BUNDLED_CATALOG): string | null {
  const groupsOff = categoryById(categoryId, catalog).groups.filter((group) => !isGroupEnabled(settings, categoryId, group.id)).length;
  const extra = categoryPatternLines(settings, categoryId).filter((line) => !/^\[.*\]$/.test(line)).length;
  const parts: string[] = [];
  if (groupsOff > 0) parts.push(`${groupsOff} group${groupsOff === 1 ? '' : 's'} off`);
  if (extra > 0) parts.push(`${extra} extra pattern${extra === 1 ? '' : 's'}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** Merge a possibly partial/unknown stored value with the defaults. */
export function normalizeSettings(value: unknown): GeldSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS;
  const record: Record<string, unknown> = { ...value };
  const customCategories = readCustomCategories(record.customCategories);
  return {
    enabled: bool(record, 'enabled', DEFAULT_SETTINGS.enabled),
    categories: readCategories(record.categories, record.hideTests, new Set(customCategories.map((custom) => custom.id))),
    groups: readGroups(record.groups, record.testGroups),
    categoryPatterns: readCategoryPatterns(record.categoryPatterns, record.customPatterns),
    customCategories,
    repoRules: isStringArray(record.repoRules) ? record.repoRules : DEFAULT_SETTINGS.repoRules,
    groupHidden: bool(record, 'groupHidden', DEFAULT_SETTINGS.groupHidden),
    expandedByDefault: bool(record, 'expandedByDefault', DEFAULT_SETTINGS.expandedByDefault),
    hideCommentLines: bool(record, 'hideCommentLines', DEFAULT_SETTINGS.hideCommentLines),
    showListStats: bool(record, 'showListStats', DEFAULT_SETTINGS.showListStats),
    hideWhitespace: bool(record, 'hideWhitespace', DEFAULT_SETTINGS.hideWhitespace),
    shortcutEnabled: bool(record, 'shortcutEnabled', DEFAULT_SETTINGS.shortcutEnabled),
    showBadge: bool(record, 'showBadge', DEFAULT_SETTINGS.showBadge),
    autoUpdatePatterns: bool(record, 'autoUpdatePatterns', DEFAULT_SETTINGS.autoUpdatePatterns),
    enterpriseHosts: isStringArray(record.enterpriseHosts)
      ? record.enterpriseHosts.map(normalizeHost).filter((host): host is string => host !== null)
      : DEFAULT_SETTINGS.enterpriseHosts,
    repoConfigs: isRepoConfigMode(record.repoConfigs) ? record.repoConfigs : DEFAULT_SETTINGS.repoConfigs,
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

/** Remove a custom category and every setting that referred to it. */
export function withoutCustomCategory(settings: GeldSettings, id: AnyCategoryId): GeldSettings {
  const categories: Partial<Record<AnyCategoryId, boolean>> = { ...settings.categories };
  delete categories[id];
  return { ...settings, categories, customCategories: settings.customCategories.filter((custom) => custom.id !== id) };
}

/** Add or replace a custom category (matched by id), keeping the list order for replacements. */
export function withCustomCategory(settings: GeldSettings, custom: CustomCategory): GeldSettings {
  const index = settings.customCategories.findIndex((existing) => existing.id === custom.id);
  const customCategories =
    index === -1 ? [...settings.customCategories, custom] : settings.customCategories.map((existing, position) => (position === index ? custom : existing));
  return { ...settings, customCategories };
}
