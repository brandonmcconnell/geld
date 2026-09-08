import { DEFAULT_SETTINGS } from '@geld/core';
import { describe, expect, it } from 'vitest';

import { applyPatch, isSettingsPatch, SITE_LIST_KEYS, SITE_TOGGLE_KEYS, validateCustomCategory, validateList, validatePatternLines } from './patch';

describe('isSettingsPatch', () => {
  it('accepts the shapes the settings page sends', () => {
    expect(isSettingsPatch({ kind: 'toggle', key: 'enabled', value: false })).toBe(true);
    expect(isSettingsPatch({ kind: 'category', id: 'docs', value: true })).toBe(true);
    expect(isSettingsPatch({ kind: 'category', id: 'custom:tokens', value: false })).toBe(true);
    expect(isSettingsPatch({ kind: 'group', categoryId: 'tests', groupId: 'e2e', value: false })).toBe(true);
    expect(isSettingsPatch({ kind: 'category-patterns', categoryId: 'docs', lines: ['*.golden'] })).toBe(true);
    expect(isSettingsPatch({ kind: 'custom-category', category: { id: 'custom:tokens', title: 'Tokens', icon: 'paintbrush', patterns: ['tokens/**'] } })).toBe(true);
    expect(isSettingsPatch({ kind: 'remove-custom-category', id: 'custom:tokens' })).toBe(true);
    expect(isSettingsPatch({ kind: 'list', key: 'repoRules', lines: ['acme/*'] })).toBe(true);
  });

  it('refuses unknown keys, extension-only fields and malformed input', () => {
    expect(SITE_TOGGLE_KEYS).not.toContain('showBadge');
    expect(SITE_LIST_KEYS).not.toContain('enterpriseHosts');
    expect(isSettingsPatch({ kind: 'toggle', key: 'showBadge', value: true })).toBe(false);
    expect(isSettingsPatch({ kind: 'list', key: 'enterpriseHosts', lines: [] })).toBe(false);
    expect(isSettingsPatch({ kind: 'toggle', key: 'enabled', value: 'yes' })).toBe(false);
    expect(isSettingsPatch({ kind: 'category', id: 'nope', value: true })).toBe(false);
    expect(isSettingsPatch({ kind: 'group', categoryId: 'tests', groupId: 'lockfiles', value: false })).toBe(false);
    expect(isSettingsPatch({ kind: 'category-patterns', categoryId: 'custom:tokens', lines: [] })).toBe(false);
    expect(isSettingsPatch({ kind: 'custom-category', category: { id: 'tokens', title: 'Tokens', icon: 'paintbrush', patterns: [] } })).toBe(false);
    expect(isSettingsPatch({ kind: 'custom-category', category: { id: 'custom:tokens', title: 'Tokens', icon: 'unicorn', patterns: [] } })).toBe(false);
    expect(isSettingsPatch({ kind: 'remove-custom-category', id: 'tests' })).toBe(false);
    expect(isSettingsPatch({ kind: 'list', key: 'repoRules', lines: [1] })).toBe(false);
    expect(isSettingsPatch(null)).toBe(false);
    expect(isSettingsPatch({ kind: 'delete-everything' })).toBe(false);
  });
});

describe('validateList', () => {
  it('normalises lines and rejects broken globs', () => {
    expect(validatePatternLines(['  *.golden ', '', '# comment', '[acme/*]', 'docs/', '!keep/**'])).toEqual({ ok: true, lines: ['*.golden', '[acme/*]', 'docs/', '!keep/**'] });
    expect(validatePatternLines(['[]']).ok).toBe(false);
    const bad = validateList('repoRules', ['!acme/[z-a]']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('Invalid pattern');
  });

  it('normalises hosts and refuses github.com or junk', () => {
    expect(validateList('enterpriseHosts', ['https://GitHub.Example.com/org/repo', 'github.example.com'])).toEqual({ ok: true, lines: ['github.example.com'] });
    expect(validateList('enterpriseHosts', ['github.com']).ok).toBe(false);
  });
});

describe('validateCustomCategory', () => {
  it('trims, drops empty nouns and refuses bad input', () => {
    expect(validateCustomCategory({ id: 'custom:tokens', title: ' Design tokens ', icon: 'paintbrush', patterns: [' tokens/** ', ''], noun: ' ', nounPlural: 'tokens' })).toEqual({
      ok: true,
      category: { id: 'custom:tokens', title: 'Design tokens', icon: 'paintbrush', patterns: ['tokens/**'], nounPlural: 'tokens' },
    });
    expect(validateCustomCategory({ id: 'custom:x', title: '  ', icon: 'tag', patterns: [] }).ok).toBe(false);
    expect(validateCustomCategory({ id: 'custom:x', title: 'x'.repeat(41), icon: 'tag', patterns: [] }).ok).toBe(false);
    expect(validateCustomCategory({ id: 'custom:x', title: 'X', icon: 'tag', patterns: ['a[z-a]'] }).ok).toBe(false);
  });
});

describe('applyPatch', () => {
  it('layers a change on top of the given base without touching other keys', () => {
    const base = { ...DEFAULT_SETTINGS, categoryPatterns: { tests: ['keep-me'] } };
    const toggled = applyPatch(base, { kind: 'toggle', key: 'enabled', value: false });
    expect(toggled.ok && toggled.settings.enabled).toBe(false);
    expect(toggled.ok && toggled.settings.categoryPatterns).toEqual({ tests: ['keep-me'] });
    const category = applyPatch(base, { kind: 'category', id: 'generated', value: true });
    expect(category.ok && category.settings.categories.generated).toBe(true);
    const group = applyPatch(base, { kind: 'group', categoryId: 'tests', groupId: 'snapshots', value: false });
    expect(group.ok && group.settings.groups['tests/snapshots']).toBe(false);
    const list = applyPatch(base, { kind: 'list', key: 'repoRules', lines: ['acme', ' !acme/widgets '] });
    expect(list.ok && list.settings.repoRules).toEqual(['acme', '!acme/widgets']);
  });

  it('adds, replaces and removes extra patterns per category', () => {
    const added = applyPatch(DEFAULT_SETTINGS, { kind: 'category-patterns', categoryId: 'docs', lines: ['*.golden', ''] });
    expect(added.ok && added.settings.categoryPatterns).toEqual({ docs: ['*.golden'] });
    if (!added.ok) throw new Error(added.message);
    const cleared = applyPatch(added.settings, { kind: 'category-patterns', categoryId: 'docs', lines: [] });
    expect(cleared.ok && cleared.settings.categoryPatterns).toEqual({});
    expect(applyPatch(DEFAULT_SETTINGS, { kind: 'category-patterns', categoryId: 'docs', lines: ['a[z-a]'] }).ok).toBe(false);
  });

  it('adds, updates and removes custom categories', () => {
    const tokens = { id: 'custom:tokens', title: 'Tokens', icon: 'paintbrush', patterns: ['tokens/**'] } as const;
    const added = applyPatch(DEFAULT_SETTINGS, { kind: 'custom-category', category: tokens });
    if (!added.ok) throw new Error(added.message);
    expect(added.settings.customCategories).toEqual([tokens]);
    const off = applyPatch(added.settings, { kind: 'category', id: 'custom:tokens', value: false });
    if (!off.ok) throw new Error(off.message);
    const renamed = applyPatch(off.settings, { kind: 'custom-category', category: { ...tokens, title: 'Design tokens' } });
    if (!renamed.ok) throw new Error(renamed.message);
    expect(renamed.settings.customCategories).toEqual([{ ...tokens, title: 'Design tokens' }]);
    expect(renamed.settings.categories).toEqual({ 'custom:tokens': false });
    const removed = applyPatch(renamed.settings, { kind: 'remove-custom-category', id: 'custom:tokens' });
    expect(removed.ok && removed.settings.customCategories).toEqual([]);
    expect(removed.ok && removed.settings.categories).toEqual({});
  });
});
