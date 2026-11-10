import { describe, expect, it } from 'vitest';
import { CATEGORY_IDS } from './categories';
import { DEFAULT_SETTINGS } from './settings';
import type { GeldSettings } from './settings';
import { parseUsagePayload, usageCaptures } from './usage-report';
import { hidCounterFor, parseUsageCounts, parseUsageSettings, USAGE_COUNT_CAP, USAGE_COUNTERS, USAGE_TOGGLES, usageCountProperties, usageSettingsOf, usageSettingsProperties } from './usage-settings';

const personal: GeldSettings = {
  ...DEFAULT_SETTINGS,
  categories: { generated: true, docs: true },
  customCategories: Array.from({ length: 12 }, (_, index) => ({ id: `custom:secret-${index}`, title: `Secret project ${index}`, icon: 'code', patterns: ['internal/acme/**'] })),
  categoryPatterns: { tests: ['# a note', 'e2e/**', '', '!e2e/keep.ts'] },
  groups: { 'tests/snapshots': false },
  repoRules: ['acme/private'],
  hiddenAuthors: ['someone'],
  enterpriseHosts: ['git.acme.internal'],
  aiBaseUrl: 'https://gateway.acme.internal',
};

describe('usageSettingsOf', () => {
  it('reports every switch the settings have but usageStats', () => {
    const booleans = Object.entries(DEFAULT_SETTINGS)
      .filter(([key, value]) => typeof value === 'boolean' && key !== 'usageStats')
      .map(([key]) => key)
      .sort();
    expect([...USAGE_TOGGLES].sort()).toEqual(booleans);
  });

  it('counts what the reader typed without saying what it is, capped', () => {
    const snapshot = usageSettingsOf(personal);
    const text = JSON.stringify(snapshot);
    for (const secret of ['Secret project', 'secret-', 'acme', 'someone', 'internal', 'e2e']) expect(text).not.toContain(secret);
    expect(snapshot.counts).toMatchObject({
      customCategories: USAGE_COUNT_CAP,
      customCategoriesOn: USAGE_COUNT_CAP,
      builtInCategoriesOn: 3,
      categoriesOn: USAGE_COUNT_CAP,
      patternGroupsOff: 1,
      extraPatterns: 2,
      repoRules: 1,
      hiddenAuthors: 1,
      enterpriseHosts: 1,
    });
    expect(snapshot.categories).toMatchObject({ tests: true, generated: true, docs: true, vendored: false });
    expect(snapshot.choices).toMatchObject({ digestView: 'digest', issueTracker: 'none' });
  });
});

describe('parsing and properties', () => {
  it('keeps only named switches, options, categories and counts', () => {
    expect(
      parseUsageSettings({
        toggles: { enabled: true, groupHidden: 'yes', secret: true },
        choices: { compactTimeline: 'minimal', reviewGrouping: 'mine', aiBaseUrl: 'https://x' },
        categories: { tests: true, 'custom:secret': true },
        counts: { customCategories: 400, repoRules: -1, builtInCategoriesOn: 9 },
      }),
    ).toEqual({ toggles: { enabled: true }, choices: { compactTimeline: 'minimal' }, categories: { tests: true }, counts: { customCategories: USAGE_COUNT_CAP, builtInCategoriesOn: 9 } });
    expect(parseUsageCounts({ flow_opened: 3, review_approve: 1.5, page_url: 2, status_merge: 0 })).toEqual({ flow_opened: 3 });
  });

  it('names the properties for the analytics store', () => {
    const properties = usageSettingsProperties(usageSettingsOf(personal));
    expect(properties).toMatchObject({ setting_group_hidden: true, setting_pr_overview: true, compact_timeline: 'compact', digest_view: 'digest', category_docs: true, custom_categories: 10, has_custom_categories: true });
    expect(usageCountProperties({ flow_opened: 2 })).toMatchObject({ used_flow_opened: 2, used_digest_shown: 0 });
  });

  it('carries settings only on a week’s first ping, through to the captures', () => {
    const settings = usageSettingsOf(DEFAULT_SETTINGS);
    const payload = parseUsagePayload({
      v: 1,
      version: '0.9.3.412',
      channel: 'stable',
      browser: 'chrome',
      events: [
        { name: 'extension_active', at: 1, firstOfWeek: true, firstOfMonth: false, settings, counts: { digest_shown: 4 } },
        { name: 'extension_active', at: 2, firstOfWeek: false, firstOfMonth: false, settings },
      ],
    });
    if (payload === null) throw new Error('payload refused');
    const [weekly, daily] = usageCaptures(payload, 3);
    expect(weekly?.properties).toMatchObject({ category_tests: true, setting_enabled: true, used_digest_shown: 4, used_flow_opened: 0 });
    expect(daily?.properties).not.toHaveProperty('category_tests');
    expect(daily?.properties).not.toHaveProperty('used_digest_shown');
  });
});

describe('counters', () => {
  it('has one per built-in category and one for custom ones', () => {
    expect(USAGE_COUNTERS.filter((counter) => counter.startsWith('hid_'))).toEqual([...CATEGORY_IDS.map((id) => `hid_${id}`), 'hid_custom']);
    expect(hidCounterFor('docs')).toBe('hid_docs');
    expect(hidCounterFor('custom:secret')).toBe('hid_custom');
  });
});
