import {
  DEFAULT_SETTINGS,
  allCategories,
  describeAdvancedSettings,
  hasAdvancedSettings,
  isCategoryEnabled,
  isGroupEnabled,
  isTestGroupEnabled,
  normalizeHost,
  normalizeSettings,
  parsePatternList,
  withCustomCategory,
  withoutCustomCategory,
} from './settings';

describe('normalizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ enabled: 'yes', customPatterns: [1, 2] })).toEqual(DEFAULT_SETTINGS);
  });

  it('migrates the old hideTests flag into the tests category', () => {
    const migrated = normalizeSettings({ hideTests: false });
    expect(isCategoryEnabled(migrated, 'tests')).toBe(false);
    expect(isCategoryEnabled(migrated, 'generated')).toBe(false);
  });

  it('keeps unknown category keys out and falls back to category defaults', () => {
    const settings = normalizeSettings({
      categories: { generated: true, bogus: true, 'custom:gone': false },
      groups: { 'tests/e2e': false, 'tests/nope': false, 'tests/Nope': false, 'nope/x': 1, 'tests/x': 'no' },
    });
    expect(settings.categories).toEqual({ generated: true });
    // A well-formed key for a group this build does not know survives (it may
    // belong to a newer catalog); malformed keys and non-boolean values do not.
    expect(settings.groups).toEqual({ 'tests/e2e': false, 'tests/nope': false });
    expect(isCategoryEnabled(settings, 'tests')).toBe(true);
    expect(isCategoryEnabled(settings, 'generated')).toBe(true);
    expect(isGroupEnabled(settings, 'tests', 'e2e')).toBe(false);
    expect(isGroupEnabled(settings, 'tests', 'unit')).toBe(true);
  });

  it('migrates testGroups and customPatterns from earlier versions', () => {
    const migrated = normalizeSettings({ testGroups: { e2e: false, nope: 1 }, customPatterns: ['*.golden', '!keep/**'] });
    expect(isTestGroupEnabled(migrated, 'e2e')).toBe(false);
    expect(migrated.groups).toEqual({ 'tests/e2e': false });
    expect(migrated.categoryPatterns).toEqual({ tests: ['*.golden', '!keep/**'] });
    expect(hasAdvancedSettings(migrated, 'tests')).toBe(true);
    expect(hasAdvancedSettings(migrated, 'docs')).toBe(false);
    expect(describeAdvancedSettings(migrated, 'tests')).toBe('1 group off · 2 extra patterns');
    expect(describeAdvancedSettings({ ...migrated, categoryPatterns: { tests: ['[acme/*]', '*.golden'] } }, 'tests')).toBe('1 group off · 1 extra pattern');
    expect(describeAdvancedSettings(migrated, 'docs')).toBeNull();
  });

  it('reads custom categories, dropping broken or duplicate ones', () => {
    const settings = normalizeSettings({
      customCategories: [
        { id: 'custom:tokens', title: '  Design tokens ', icon: 'paintbrush', patterns: ['tokens/**'], noun: 'token', nounPlural: 'tokens' },
        { id: 'custom:tokens', title: 'Duplicate', icon: 'tag', patterns: [] },
        { id: 'not-namespaced', title: 'Bad id', icon: 'tag', patterns: [] },
        { id: 'custom:no-title', title: '', icon: 'tag', patterns: [] },
        { id: 'custom:odd-icon', title: 'Odd', icon: 'unicorn', patterns: 'nope' },
      ],
      categories: { 'custom:tokens': false, 'custom:odd-icon': true, 'custom:missing': true },
    });
    expect(settings.customCategories).toEqual([
      { id: 'custom:tokens', title: 'Design tokens', icon: 'paintbrush', patterns: ['tokens/**'], noun: 'token', nounPlural: 'tokens' },
      { id: 'custom:odd-icon', title: 'Odd', icon: 'tag', patterns: [] },
    ]);
    expect(settings.categories).toEqual({ 'custom:tokens': false, 'custom:odd-icon': true });
    expect(isCategoryEnabled(settings, 'custom:tokens')).toBe(false);
    expect(isCategoryEnabled(settings, 'custom:odd-icon')).toBe(true);
    expect(allCategories(settings).map((category) => category.id).slice(0, 3)).toEqual(['custom:tokens', 'custom:odd-icon', 'tests']);
    const without = withoutCustomCategory(settings, 'custom:tokens');
    expect(without.customCategories.map((custom) => custom.id)).toEqual(['custom:odd-icon']);
    expect(without.categories).toEqual({ 'custom:odd-icon': true });
    const replaced = withCustomCategory(without, { id: 'custom:odd-icon', title: 'Renamed', icon: 'tag', patterns: ['x/**'] });
    expect(replaced.customCategories).toEqual([{ id: 'custom:odd-icon', title: 'Renamed', icon: 'tag', patterns: ['x/**'] }]);
  });

  it('parses textarea lists', () => {
    expect(parsePatternList(' a \n\n# c\n b ')).toEqual(['a', 'b']);
  });
});

describe('normalizeHost', () => {
  it('accepts hostnames and URLs, lower-cased and stripped', () => {
    expect(normalizeHost('GHE.Example.com')).toBe('ghe.example.com');
    expect(normalizeHost('https://ghe.example.com/acme/repo/pull/1')).toBe('ghe.example.com');
    expect(normalizeHost(' git.corp.internal ')).toBe('git.corp.internal');
  });

  it('rejects github.com, bare words and junk', () => {
    expect(normalizeHost('github.com')).toBeNull();
    expect(normalizeHost('localhost')).toBeNull();
    expect(normalizeHost('')).toBeNull();
    expect(normalizeHost('ftp://x.y')).toBeNull();
  });

  it('normalises stored enterprise hosts', () => {
    expect(normalizeSettings({ enterpriseHosts: ['https://GHE.example.com/x', 'nope', 'git.corp.io'] }).enterpriseHosts).toEqual([
      'ghe.example.com',
      'git.corp.io',
    ]);
  });
});
