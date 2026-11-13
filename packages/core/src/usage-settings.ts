import type { CategoryId } from './categories';
import { CATEGORY_IDS, isCategoryId } from './categories';
import { ISSUE_TRACKERS } from './trackers';
import type { GeldSettings } from './settings';
import { COMPACT_TIMELINE_MODES, DIGEST_VIEWS, digestViewOf, isAutoViewed, isCategoryEnabled, REPO_CONFIG_MODES, REVIEW_GROUPINGS, SUGGESTED_FIX_MODES, CODING_AGENT_IDS } from './settings';

/**
 * What the weekly usage ping says about settings, and the feature counts the
 * daily one carries. Only choices Geld itself offers are named: switches,
 * built-in category ids, fixed option lists. Anything the reader typed
 * (custom category names and patterns, repository rules, logins, hosts,
 * URLs) is reduced to how many there are, capped at {@link USAGE_COUNT_CAP},
 * so an unusual list does not make one install stand out from the rest.
 */

export const USAGE_COUNT_CAP = 10;
/** A day's count of one feature's use beyond this is reported as this. */
export const USAGE_COUNTER_CAP = 10_000;

/** Every switch the snapshot reports, by its settings key; `usageStats` is left out since it is always on when anything is sent. */
export const USAGE_TOGGLES = [
  'enabled',
  'groupHidden',
  'expandedByDefault',
  'hideCommentLines',
  'testOutline',
  'hideLargeDiffs',
  'expandLargeDiffs',
  'showListStats',
  'hideWhitespace',
  'shortcutEnabled',
  'showBadge',
  'autoUpdatePatterns',
  'errorReports',
  'prOverview',
  'quickReview',
  'holdToMerge',
  'collapseDescription',
  'attachmentLightbox',
  'relatedLinks',
  'aiEnabled',
  'aiJev',
] as const satisfies readonly (keyof GeldSettings)[];
export type UsageToggle = (typeof USAGE_TOGGLES)[number];

export const USAGE_CHOICES = {
  compactTimeline: COMPACT_TIMELINE_MODES,
  reviewGrouping: REVIEW_GROUPINGS,
  repoConfigs: REPO_CONFIG_MODES,
  suggestedFixes: SUGGESTED_FIX_MODES,
  codingAgent: CODING_AGENT_IDS,
  digestView: DIGEST_VIEWS,
  issueTracker: [...ISSUE_TRACKERS, 'none'],
} as const;
export type UsageChoice = keyof typeof USAGE_CHOICES;

export const USAGE_COUNTS = [
  'customCategories',
  'customCategoriesOn',
  'builtInCategoriesOn',
  'categoriesOn',
  'patternGroupsOff',
  'extraPatterns',
  'autoViewedCategories',
  'repoRules',
  'hiddenAuthors',
  'enterpriseHosts',
  'testSyntaxes',
  'reviewBots',
] as const;
export type UsageCount = (typeof USAGE_COUNTS)[number];

export interface UsageSettings {
  readonly toggles: Readonly<Partial<Record<UsageToggle, boolean>>>;
  readonly choices: Readonly<Partial<Record<UsageChoice, string>>>;
  readonly categories: Readonly<Partial<Record<CategoryId, boolean>>>;
  readonly counts: Readonly<Partial<Record<UsageCount, number>>>;
}

/**
 * Feature uses a day's ping counts, since the install's previous ping. `hid_<category>`: diff pages where that
 * category hid at least one file (`hid_custom` for any of the reader's own categories).
 */
export const USAGE_COUNTERS = [
  'diff_pages',
  'diff_pages_hiding',
  'hidden_files_shown',
  'hidden_file_revealed',
  'digest_shown',
  'digest_copied',
  'digest_view_changed',
  'flow_opened',
  'ai_triage_run',
  'ai_triage_failed',
  'ai_fix_applied',
  'ai_fix_discarded',
  'agent_handoff',
  'bot_review_requested',
  'review_approve',
  'review_request_changes',
  'review_comment',
  'comment_posted',
  'status_merge',
  'status_queue',
  'status_auto',
  'status_close',
  'status_ready',
  'status_draft',
  'status_reopen',
  'rollback_feedback',
  'hid_tests',
  'hid_generated',
  'hid_vendored',
  'hid_agents',
  'hid_docs',
  'hid_tooling',
  'hid_stories',
  'hid_trivial',
  'hid_large',
  'hid_custom',
] as const;
export type UsageCounter = (typeof USAGE_COUNTERS)[number];

export function isUsageCounter(value: unknown): value is UsageCounter {
  return USAGE_COUNTERS.some((counter) => counter === value);
}

/** The counter for a category hiding files on a page: its own for a built-in, `hid_custom` for any custom one. */
export function hidCounterFor(categoryId: string): UsageCounter {
  const counter = `hid_${isCategoryId(categoryId) ? categoryId : 'custom'}`;
  return isUsageCounter(counter) ? counter : 'hid_custom';
}

/** A line that is a pattern: not blank, not a `#` note, and not a `[owner/repo]` scope header, which only says where the patterns after it apply. */
function isPatternLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#') && !/^\[.*\]$/.test(trimmed);
}

function capped(count: number): number {
  return Math.min(Math.max(0, Math.floor(count)), USAGE_COUNT_CAP);
}

export function usageSettingsOf(settings: GeldSettings): UsageSettings {
  const toggles: Partial<Record<UsageToggle, boolean>> = {};
  for (const key of USAGE_TOGGLES) toggles[key] = settings[key];
  const categories: Partial<Record<CategoryId, boolean>> = {};
  for (const id of CATEGORY_IDS) categories[id] = isCategoryEnabled(settings, id);
  const builtInOn = CATEGORY_IDS.filter((id) => isCategoryEnabled(settings, id)).length;
  const customOn = settings.customCategories.filter((custom) => isCategoryEnabled(settings, custom.id)).length;
  const extraPatterns = Object.values(settings.categoryPatterns).reduce((sum, lines) => sum + (lines?.filter(isPatternLine).length ?? 0), 0);
  const autoViewed = [...CATEGORY_IDS, ...settings.customCategories.map((custom) => custom.id)].filter((id) => isAutoViewed(settings, id)).length;
  const counts: Record<UsageCount, number> = {
    customCategories: capped(settings.customCategories.length),
    customCategoriesOn: capped(customOn),
    builtInCategoriesOn: builtInOn,
    categoriesOn: capped(builtInOn + customOn),
    patternGroupsOff: capped(Object.values(settings.groups).filter((on) => on === false).length),
    extraPatterns: capped(extraPatterns),
    autoViewedCategories: capped(autoViewed),
    repoRules: capped(settings.repoRules.length),
    hiddenAuthors: capped(settings.hiddenAuthors.length),
    enterpriseHosts: capped(settings.enterpriseHosts.length),
    testSyntaxes: capped(settings.testSyntaxes.length),
    reviewBots: capped(settings.reviewBots.length),
  };
  return {
    toggles,
    choices: {
      compactTimeline: settings.compactTimeline,
      reviewGrouping: settings.reviewGrouping,
      repoConfigs: settings.repoConfigs,
      suggestedFixes: settings.suggestedFixes,
      codingAgent: settings.codingAgent,
      digestView: digestViewOf(settings),
      issueTracker: settings.issueTracker?.provider ?? 'none',
    },
    categories,
    counts,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A snapshot as received: only the switches, options, category ids and counts named above, each of its own type, survive. */
export function parseUsageSettings(value: unknown): UsageSettings | null {
  if (!isRecord(value) || !isRecord(value.toggles) || !isRecord(value.choices) || !isRecord(value.categories) || !isRecord(value.counts)) return null;
  const toggles: Partial<Record<UsageToggle, boolean>> = {};
  for (const key of USAGE_TOGGLES) {
    const on = value.toggles[key];
    if (typeof on === 'boolean') toggles[key] = on;
  }
  const choices: Partial<Record<UsageChoice, string>> = {};
  const given = value.choices;
  for (const key of Object.keys(USAGE_CHOICES).filter((name): name is UsageChoice => name in USAGE_CHOICES)) {
    const options: readonly string[] = USAGE_CHOICES[key];
    const chosen = options.find((option) => option === given[key]);
    if (chosen !== undefined) choices[key] = chosen;
  }
  const categories: Partial<Record<CategoryId, boolean>> = {};
  for (const id of CATEGORY_IDS) {
    const on = value.categories[id];
    if (typeof on === 'boolean') categories[id] = on;
  }
  const counts: Partial<Record<UsageCount, number>> = {};
  for (const key of USAGE_COUNTS) {
    const count = value.counts[key];
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0) counts[key] = Math.min(count, key === 'builtInCategoriesOn' ? CATEGORY_IDS.length : USAGE_COUNT_CAP);
  }
  return { toggles, choices, categories, counts };
}

/** A day's feature counts as received: known counters only, whole numbers, capped. */
export function parseUsageCounts(value: unknown): Partial<Record<UsageCounter, number>> | null {
  if (!isRecord(value)) return null;
  const counts: Partial<Record<UsageCounter, number>> = {};
  for (const counter of USAGE_COUNTERS) {
    const count = value[counter];
    if (typeof count === 'number' && Number.isInteger(count) && count > 0) counts[counter] = Math.min(count, USAGE_COUNTER_CAP);
  }
  return counts;
}

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** The analytics property a switch is reported as (`setting_group_hidden`), for dashboards that ask for it by name. */
export function usageToggleProperty(key: UsageToggle): string {
  return `setting_${snake(key)}`;
}

/** Flat analytics properties: `setting_<switch>`, the options by name, `category_<id>`, the counts, and `has_custom_categories`. */
export function usageSettingsProperties(snapshot: UsageSettings): Record<string, string | number | boolean> {
  const properties: Record<string, string | number | boolean> = {};
  for (const key of USAGE_TOGGLES) {
    const on = snapshot.toggles[key];
    if (on !== undefined) properties[usageToggleProperty(key)] = on;
  }
  for (const [key, chosen] of Object.entries(snapshot.choices)) properties[snake(key)] = chosen;
  for (const [id, on] of Object.entries(snapshot.categories)) properties[`category_${id}`] = on;
  for (const [key, count] of Object.entries(snapshot.counts)) properties[snake(key)] = count;
  const custom = snapshot.counts.customCategories;
  if (custom !== undefined) properties.has_custom_categories = custom > 0;
  return properties;
}

/** Flat analytics properties for a day's counts: `used_<counter>`, every counter present (0 when unused) so sums and averages count quiet days too. */
export function usageCountProperties(counts: Partial<Record<UsageCounter, number>>): Record<string, number> {
  return Object.fromEntries(USAGE_COUNTERS.map((counter) => [`used_${counter}`, counts[counter] ?? 0]));
}
