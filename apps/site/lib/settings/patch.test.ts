import { DEFAULT_SETTINGS } from '@geld/core';
import { describe, expect, it } from 'vitest';

import { applyPatch, isSettingsPatch, SITE_LIST_KEYS, SITE_TOGGLE_KEYS, validateList } from './patch';

describe('isSettingsPatch', () => {
  it('accepts the shapes the settings page sends', () => {
    expect(isSettingsPatch({ kind: 'toggle', key: 'enabled', value: false })).toBe(true);
    expect(isSettingsPatch({ kind: 'category', id: 'docs', value: true })).toBe(true);
    expect(isSettingsPatch({ kind: 'test-group', id: 'e2e', value: false })).toBe(true);
    expect(isSettingsPatch({ kind: 'list', key: 'customPatterns', lines: ['*.golden'] })).toBe(true);
  });

  it('refuses unknown keys, extension-only fields and malformed input', () => {
    expect(SITE_TOGGLE_KEYS).not.toContain('showBadge');
    expect(SITE_LIST_KEYS).not.toContain('enterpriseHosts');
    expect(isSettingsPatch({ kind: 'toggle', key: 'showBadge', value: true })).toBe(false);
    expect(isSettingsPatch({ kind: 'list', key: 'enterpriseHosts', lines: [] })).toBe(false);
    expect(isSettingsPatch({ kind: 'toggle', key: 'enabled', value: 'yes' })).toBe(false);
    expect(isSettingsPatch({ kind: 'category', id: 'nope', value: true })).toBe(false);
    expect(isSettingsPatch({ kind: 'list', key: 'repoRules', lines: [1] })).toBe(false);
    expect(isSettingsPatch(null)).toBe(false);
    expect(isSettingsPatch({ kind: 'delete-everything' })).toBe(false);
  });
});

describe('validateList', () => {
  it('normalises lines and rejects broken globs', () => {
    expect(validateList('customPatterns', ['  *.golden ', '', '# comment', '[acme/*]', 'docs/'])).toEqual({ ok: true, lines: ['*.golden', '[acme/*]', 'docs/'] });
    const bad = validateList('repoRules', ['!acme/[z-a]']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('Invalid pattern');
  });

  it('normalises hosts and refuses github.com or junk', () => {
    expect(validateList('enterpriseHosts', ['https://GitHub.Example.com/org/repo', 'github.example.com'])).toEqual({ ok: true, lines: ['github.example.com'] });
    expect(validateList('enterpriseHosts', ['github.com']).ok).toBe(false);
  });
});

describe('applyPatch', () => {
  it('layers a change on top of the given base without touching other keys', () => {
    const base = { ...DEFAULT_SETTINGS, customPatterns: ['keep-me'] };
    const toggled = applyPatch(base, { kind: 'toggle', key: 'enabled', value: false });
    expect(toggled.ok && toggled.settings.enabled).toBe(false);
    expect(toggled.ok && toggled.settings.customPatterns).toEqual(['keep-me']);
    const category = applyPatch(base, { kind: 'category', id: 'generated', value: true });
    expect(category.ok && category.settings.categories.generated).toBe(true);
    const group = applyPatch(base, { kind: 'test-group', id: 'snapshots', value: false });
    expect(group.ok && group.settings.testGroups.snapshots).toBe(false);
    const list = applyPatch(base, { kind: 'list', key: 'repoRules', lines: ['acme', ' !acme/widgets '] });
    expect(list.ok && list.settings.repoRules).toEqual(['acme', '!acme/widgets']);
  });
});
