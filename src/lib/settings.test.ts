import { DEFAULT_SETTINGS, isCategoryEnabled, isTestGroupEnabled, normalizeSettings, parsePatternList } from './settings';

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
    const settings = normalizeSettings({ categories: { generated: true, bogus: true }, testGroups: { e2e: false, nope: 1 } });
    expect(settings.categories).toEqual({ generated: true });
    expect(isCategoryEnabled(settings, 'tests')).toBe(true);
    expect(isCategoryEnabled(settings, 'generated')).toBe(true);
    expect(isTestGroupEnabled(settings, 'e2e')).toBe(false);
    expect(isTestGroupEnabled(settings, 'unit')).toBe(true);
  });

  it('parses textarea lists', () => {
    expect(parsePatternList(' a \n\n# c\n b ')).toEqual(['a', 'b']);
  });
});
