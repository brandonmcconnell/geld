import { parseDocument } from 'yaml';
import type { Catalog, CategoryId, CustomCategory } from './categories';
import { BUNDLED_CATALOG, CATEGORY_IDS, catalogGroupKeys, isCategoryId, isCustomCategoryId, isGroupKey, isWellFormedGroupKey, isWellFormedId } from './categories';
import type { GeldSettings } from './settings';
import { normalizeSettings } from './settings';
import type { SettingsIssue } from './settings-validate';
import { checkBooleanMap, checkCategoryPatterns, checkCustomCategories, describeValue, isRecord } from './settings-validate';

/**
 * Repository-provided configuration: a committed `.github/geld.yml` that adds
 * to every reviewer's own settings on that repository, plus the organisation's
 * defaults in its `.github` repository (`acme/.github`). Nothing is stored by
 * Geld: the file is versioned and reviewed like any other, and whoever may
 * merge to the default branch decides what it says.
 *
 * The vocabulary is the settings document's own (`categories`, `groups`,
 * `categoryPatterns`, `customCategories`) and the same strict validator
 * checks it, plus one key of the repository's own: `reviewBots`, the review
 * bots installed on it (ids from `@geld/review`'s registry, passed in by the
 * caller as `knownBots`), so the "Request a review" menu can offer them on a
 * pull request none of them has run on yet. Personal settings (`enabled`,
 * `repoRules`, layout, …) have no place in a repository config and are
 * reported as problems.
 *
 * Hiding is Geld's whole point, which makes a repository config an attack
 * surface (a `*.ts` pattern in a compromised repository hides a backdoor from
 * reviewers). Two safeguards follow from that: the file is only applied when
 * the user allows it (the `repoConfigs` setting), and files hidden by it are
 * counted and listed exactly like files hidden by the user's own patterns.
 */

/** Path of the config inside a repository. */
export const REPO_CONFIG_PATH = '.github/geld.yml';
/** The repository holding an organisation's defaults, and the paths tried inside it (first hit wins). */
export const ORG_CONFIG_REPO = '.github';
export const ORG_CONFIG_PATHS: readonly string[] = ['geld.yml', '.github/geld.yml'];

/** The part of a settings document a repository is allowed to provide, plus what it declares about itself. */
export interface RepoConfig extends Pick<GeldSettings, 'categories' | 'groups' | 'categoryPatterns' | 'customCategories'> {
  /** Review bots installed on the repository, by registry id (`bugbot`, `coderabbit`, …), in the file's order. */
  readonly reviewBots: readonly string[];
}

export const EMPTY_REPO_CONFIG: RepoConfig = { categories: {}, groups: {}, categoryPatterns: {}, customCategories: [], reviewBots: [] };

export type RepoConfigParse = { readonly ok: true; readonly config: RepoConfig } | { readonly ok: false; readonly issues: readonly SettingsIssue[] };

const ALLOWED_KEYS = ['version', 'categories', 'groups', 'categoryPatterns', 'customCategories', 'reviewBots'] as const;

/** The shape of a bot id: the registry's ids are lowercase words with dashes. */
const BOT_ID = /^[a-z][a-z0-9-]*$/;

/** Settings keys that only make sense per person; a repository naming them is a mistake worth pointing out. */
const PERSONAL_KEYS = [
  'enabled',
  'repoRules',
  'hiddenAuthors',
  'groupHidden',
  'expandedByDefault',
  'hideCommentLines',
  'hideLargeDiffs',
  'showListStats',
  'hideWhitespace',
  'shortcutEnabled',
  'showBadge',
  'autoUpdatePatterns',
  'enterpriseHosts',
  'repoConfigs',
  'hideTests',
  'testGroups',
  'customPatterns',
  'prOverview',
  'compactTimeline',
  'reviewGrouping',
  'collapseDescription',
  'aiBaseUrl',
  'aiModel',
  'suggestedFixes',
] as const;

/**
 * `reviewBots`: a list of registry ids. With `knownBots` the ids are checked
 * against it (the extension passes the registry; an unknown id is a typo or
 * a bot Geld does not know yet, either way worth saying); without it only
 * the shape is checked.
 */
function checkReviewBots(issues: SettingsIssue[], path: string, value: unknown, knownBots: readonly string[] | null): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path, message: `Expected a list of review bot ids, got ${describeValue(value)}.` });
    return;
  }
  const allowed = knownBots === null ? '' : ` Known bots: ${knownBots.map((id) => `"${id}"`).join(', ')}.`;
  value.forEach((entry: unknown, index) => {
    const at = `${path}[${index}]`;
    if (typeof entry !== 'string') {
      issues.push({ path: at, message: `Expected a review bot id, got ${describeValue(entry)}.${allowed}` });
      return;
    }
    if (!BOT_ID.test(entry)) {
      issues.push({ path: at, message: `"${entry}" is not a review bot id (lowercase letters, digits and dashes).${allowed}` });
      return;
    }
    if (knownBots !== null && !knownBots.includes(entry)) issues.push({ path: at, message: `"${entry}" is not a review bot Geld knows.${allowed}` });
  });
}

/**
 * Every problem in a parsed repository config. Unknown keys are ignored (a
 * newer Geld may understand more), personal settings are reported.
 */
export function collectRepoConfigIssues(value: unknown, catalog: Catalog = BUNDLED_CATALOG, path = '$', knownBots: readonly string[] | null = null): readonly SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  if (value === null || value === undefined) return issues;
  if (!isRecord(value)) {
    issues.push({ path, message: `Expected a mapping of settings, got ${describeValue(value)}.` });
    return issues;
  }
  const at = (key: string): string => (path === '$' ? key : `${path}.${key}`);
  if (value.version !== undefined && value.version !== 1) {
    issues.push({ path: at('version'), message: `Only version 1 is understood, got ${describeValue(value.version)}.` });
  }
  for (const key of PERSONAL_KEYS) {
    if (value[key] !== undefined) {
      issues.push({ path: at(key), message: `"${key}" is a personal setting and cannot be set by a repository. Allowed keys: ${ALLOWED_KEYS.map((k) => `"${k}"`).join(', ')}.` });
    }
  }
  checkBooleanMap(issues, at('categories'), value.categories, CATEGORY_IDS, (key) => isCategoryId(key) || isCustomCategoryId(key) || isWellFormedId(key), 'category');
  checkBooleanMap(issues, at('groups'), value.groups, catalogGroupKeys(catalog), (key) => isGroupKey(key, catalog) || isWellFormedGroupKey(key), 'pattern group');
  checkCategoryPatterns(issues, at('categoryPatterns'), value.categoryPatterns);
  checkCustomCategories(issues, at('customCategories'), value.customCategories);
  checkReviewBots(issues, at('reviewBots'), value.reviewBots, knownBots);
  return issues;
}

/** The `reviewBots` list of a validated document: each id once, in the file's order. */
function reviewBotsOf(value: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(value.reviewBots)) return [];
  const ids: string[] = [];
  for (const entry of value.reviewBots) if (typeof entry === 'string' && !ids.includes(entry)) ids.push(entry);
  return ids;
}

/**
 * Parse and validate the text of a `geld.yml`. An empty file is a valid,
 * empty config. `knownBots` is the review-bot registry's ids (see
 * {@link collectRepoConfigIssues}).
 */
export function parseRepoConfig(text: string, catalog: Catalog = BUNDLED_CATALOG, knownBots: readonly string[] | null = null): RepoConfigParse {
  const doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      issues: doc.errors.map((error) => {
        const pos = error.linePos?.[0];
        // Pretty errors append " at line L, column C:" plus a code excerpt; the position is reported as the path instead.
        const message = (error.message.split(/ at line \d+, column \d+:/)[0] ?? error.message).replace(/\s+/g, ' ').trim();
        return { path: pos === undefined ? '$' : `line ${pos.line}, column ${pos.col}`, message: `Not valid YAML: ${message}` };
      }),
    };
  }
  const value: unknown = doc.toJS();
  const issues = collectRepoConfigIssues(value, catalog, '$', knownBots);
  if (issues.length > 0) return { ok: false, issues };
  if (value === null || value === undefined || !isRecord(value)) return { ok: true, config: EMPTY_REPO_CONFIG };
  const normalized = normalizeSettings(value);
  return {
    ok: true,
    config: {
      categories: normalized.categories,
      groups: normalized.groups,
      categoryPatterns: normalized.categoryPatterns,
      customCategories: normalized.customCategories,
      reviewBots: reviewBotsOf(value),
    },
  };
}

/** Whether a config changes anything at all. */
export function isEmptyRepoConfig(config: RepoConfig): boolean {
  return (
    Object.keys(config.categories).length === 0 &&
    Object.keys(config.groups).length === 0 &&
    Object.values(config.categoryPatterns).every((lines) => lines === undefined || lines.length === 0) &&
    config.customCategories.length === 0 &&
    config.reviewBots.length === 0
  );
}

/** The review bots every config in `configs` declares, each once, organisation's first. */
export function declaredReviewBots(configs: readonly RepoConfig[]): readonly string[] {
  const ids: string[] = [];
  for (const config of configs) for (const id of config.reviewBots) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/** Pattern lines are scoped by `[owner/repo]` headers; this one returns to "everywhere" before appended lines. */
const SCOPE_RESET = '[*]';

function appendPatterns(base: GeldSettings['categoryPatterns'], extra: GeldSettings['categoryPatterns']): GeldSettings['categoryPatterns'] {
  const merged: Partial<Record<CategoryId, readonly string[]>> = { ...base };
  for (const [key, lines] of Object.entries(extra)) {
    if (!isCategoryId(key) || lines === undefined || lines.length === 0) continue;
    const existing = merged[key] ?? [];
    // The user's lines may end inside a `[acme/x]` scope; never let it leak onto the repository's lines.
    merged[key] = existing.length === 0 ? lines : [...existing, SCOPE_RESET, ...lines];
  }
  return merged;
}

/**
 * Layer a repository config over the user's settings for one repository. The
 * config wins for the categories and groups it names, its patterns are added
 * after the user's (so the user's `!` rescues still apply), and its custom
 * categories follow the user's, skipping ids the user already defines.
 */
export function applyRepoConfig(settings: GeldSettings, config: RepoConfig): GeldSettings {
  const ownIds = new Set(settings.customCategories.map((custom) => custom.id));
  const customCategories: CustomCategory[] = [...settings.customCategories];
  for (const custom of config.customCategories) if (!ownIds.has(custom.id)) customCategories.push(custom);
  return {
    ...settings,
    categories: { ...settings.categories, ...config.categories },
    groups: { ...settings.groups, ...config.groups },
    categoryPatterns: appendPatterns(settings.categoryPatterns, config.categoryPatterns),
    customCategories,
  };
}

/** Several configs in priority order (organisation first, repository last: later ones win). */
export function applyRepoConfigs(settings: GeldSettings, configs: readonly RepoConfig[]): GeldSettings {
  return configs.reduce<GeldSettings>((current, config) => applyRepoConfig(current, config), settings);
}

/**
 * Patterns a repository declares as generated through `.gitattributes`
 * (`linguist-generated`, the attribute GitHub itself reads to collapse files).
 * Returned as pattern lines for the Generated category: `path linguist-generated`
 * becomes `path`, `path -linguist-generated` (or `=false`) becomes `!path`.
 * Attribute patterns follow gitignore rules, which the glob matcher shares.
 */
export function linguistGeneratedPatterns(gitattributes: string): readonly string[] {
  const lines: string[] = [];
  for (const raw of gitattributes.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^("([^"]*)"|\S+)\s+(.*)$/.exec(line);
    const token = match?.[1];
    const attributes = match?.[3];
    if (match === null || token === undefined || attributes === undefined) continue;
    let pattern = match[2] ?? token;
    if (pattern.startsWith('/')) pattern = pattern.slice(1);
    if (pattern === '') continue;
    let state: boolean | null = null;
    for (const attribute of attributes.split(/\s+/)) {
      if (attribute === 'linguist-generated' || attribute === 'linguist-generated=true') state = true;
      else if (attribute === '-linguist-generated' || attribute === 'linguist-generated=false') state = false;
      else if (attribute === '!linguist-generated') state = null;
    }
    if (state === true) lines.push(pattern);
    else if (state === false) lines.push(`!${pattern}`);
  }
  return lines;
}

/** A config holding only the `.gitattributes`-declared generated files. */
export function generatedConfigFrom(gitattributes: string): RepoConfig {
  const lines = linguistGeneratedPatterns(gitattributes);
  return lines.length === 0 ? EMPTY_REPO_CONFIG : { ...EMPTY_REPO_CONFIG, categoryPatterns: { generated: lines } };
}

/** Short summary for the popup: "2 categories, 5 patterns". */
export function describeRepoConfig(config: RepoConfig): string {
  const parts: string[] = [];
  const categories = Object.keys(config.categories).length + config.customCategories.length;
  if (categories > 0) parts.push(`${categories} ${categories === 1 ? 'category' : 'categories'}`);
  const groups = Object.keys(config.groups).length;
  if (groups > 0) parts.push(`${groups} ${groups === 1 ? 'group' : 'groups'}`);
  const patterns = Object.values(config.categoryPatterns).reduce((sum, lines) => sum + (lines?.length ?? 0), 0) + config.customCategories.reduce((sum, custom) => sum + custom.patterns.length, 0);
  if (patterns > 0) parts.push(`${patterns} ${patterns === 1 ? 'pattern' : 'patterns'}`);
  if (config.reviewBots.length > 0) parts.push(`${config.reviewBots.length} review ${config.reviewBots.length === 1 ? 'bot' : 'bots'}`);
  return parts.length === 0 ? 'no changes' : parts.join(', ');
}
