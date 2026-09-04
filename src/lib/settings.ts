/**
 * User settings. Kept intentionally small; everything here is persisted to
 * `browser.storage.sync` so it follows the user across devices.
 */
export interface GeldSettings {
  /** Master switch. When off, GitHub pages are left untouched. */
  readonly enabled: boolean;
  /** Hide files matching the built-in test patterns. */
  readonly hideTests: boolean;
  /**
   * Extra glob patterns (one per line in the UI) that should also be treated
   * as tests. Lines starting with `!` exclude paths that would otherwise match.
   */
  readonly customPatterns: readonly string[];
  /**
   * Show the hidden files expanded by default instead of collapsed. Line
   * counts are adjusted either way.
   */
  readonly expandedByDefault: boolean;
  /** Show `+N −M` (excluding tests) next to each pull request in PR lists. */
  readonly showListStats: boolean;
}

export const DEFAULT_SETTINGS: GeldSettings = {
  enabled: true,
  hideTests: true,
  customPatterns: [],
  expandedByDefault: false,
  showListStats: true,
};

export const SETTINGS_STORAGE_KEY = 'sync:settings' as const;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Merge a possibly partial/unknown stored value with the defaults. */
export function normalizeSettings(value: unknown): GeldSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS;
  const record: Record<string, unknown> = { ...value };
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled,
    hideTests: typeof record.hideTests === 'boolean' ? record.hideTests : DEFAULT_SETTINGS.hideTests,
    customPatterns: isStringArray(record.customPatterns)
      ? record.customPatterns
      : DEFAULT_SETTINGS.customPatterns,
    expandedByDefault:
      typeof record.expandedByDefault === 'boolean'
        ? record.expandedByDefault
        : DEFAULT_SETTINGS.expandedByDefault,
    showListStats:
      typeof record.showListStats === 'boolean' ? record.showListStats : DEFAULT_SETTINGS.showListStats,
  };
}

/** Turn the options textarea contents into a clean list of patterns. */
export function parsePatternList(text: string): readonly string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}
