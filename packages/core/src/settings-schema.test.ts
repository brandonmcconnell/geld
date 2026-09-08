import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import { SETTINGS_SCHEMA, fieldsFor, listFields, sectionsFor, splitInlineCode, toggleFields } from './settings-schema';

const allFields = SETTINGS_SCHEMA.flatMap((section) => section.fields);

describe('SETTINGS_SCHEMA', () => {
  it('describes every boolean and list setting exactly once', () => {
    const booleanKeys = Object.entries(DEFAULT_SETTINGS)
      .filter(([, value]) => typeof value === 'boolean')
      .map(([key]) => key)
      .sort();
    // Line lists only: customCategories is a list of objects with its own field kind.
    const listKeys = Object.entries(DEFAULT_SETTINGS)
      .filter(([key, value]) => Array.isArray(value) && key !== 'customCategories')
      .map(([key]) => key)
      .sort();
    expect(toggleFields(allFields).map((field) => field.key).sort()).toEqual(booleanKeys);
    expect(listFields(allFields).map((field) => field.key).sort()).toEqual(listKeys);
  });

  it('covers categories and custom categories with one field each', () => {
    expect(allFields.filter((field) => field.kind === 'categories')).toHaveLength(1);
    expect(allFields.filter((field) => field.kind === 'custom-categories')).toHaveLength(1);
  });

  it('keeps browser-only settings off the site', () => {
    const siteKeys = new Set([...toggleFields(fieldsFor('site')), ...listFields(fieldsFor('site'))].map((field) => field.key));
    expect(siteKeys.has('showBadge')).toBe(false);
    expect(siteKeys.has('shortcutEnabled')).toBe(false);
    expect(siteKeys.has('enterpriseHosts')).toBe(false);
    expect(siteKeys.has('enabled')).toBe(true);
    expect(sectionsFor('site').map((section) => section.id)).not.toContain('enterprise');
    expect(sectionsFor('extension').map((section) => section.id)).toContain('enterprise');
  });

  it('exposes the toolbar popup as a small subset', () => {
    const popup = fieldsFor('extension', true);
    expect(popup.map((field) => (field.kind === 'toggle' ? field.key : field.kind))).toEqual([
      'enabled',
      'groupHidden',
      'expandedByDefault',
      'categories',
    ]);
  });
});

describe('splitInlineCode', () => {
  it('alternates text and code runs', () => {
    expect(splitInlineCode('use `*.snap` or `fixtures/`.')).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: '*.snap' },
      { kind: 'text', text: ' or ' },
      { kind: 'code', text: 'fixtures/' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('returns plain text untouched', () => {
    expect(splitInlineCode('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
  });
});
