import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeAiBaseUrl } from './settings';
import {
  SETTINGS_SCHEMA,
  fieldsFor,
  listFields,
  plainText,
  presetBlank,
  presetGroups,
  presetMatches,
  sectionsFor,
  splitInlineCode,
  toggleFields,
  choiceFields,
  textFields,
} from './settings-schema';

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
    expect(siteKeys.has('errorReports')).toBe(false);
    expect(siteKeys.has('enterpriseHosts')).toBe(false);
    expect(siteKeys.has('enabled')).toBe(true);
    expect(sectionsFor('site').map((section) => section.id)).not.toContain('enterprise');
    expect(sectionsFor('extension').map((section) => section.id)).toContain('enterprise');
  });

  it('covers choice and text keys too', () => {
    expect(choiceFields(allFields).map((field) => field.key).sort()).toEqual(['compactTimeline', 'repoConfigs', 'reviewGrouping', 'suggestedFixes']);
    expect(textFields(allFields).map((field) => field.key).sort()).toEqual(['aiBaseUrl', 'aiDecisionModel', 'aiModel']);
    expect(sectionsFor('site').some((section) => section.id === 'experiments')).toBe(true);
    expect(textFields(fieldsFor('site'))).toEqual([]);
  });

  it('exposes the toolbar popup as a small subset', () => {
    const popup = fieldsFor('extension', true);
    expect(popup.map((field) => (field.kind === 'toggle' ? field.key : field.kind))).toEqual([
      'enabled',
      'prOverview',
      'groupHidden',
      'collapseDescription',
      'expandedByDefault',
      'categories',
    ]);
    expect(sectionsFor('extension').find((section) => section.id === 'general')?.fields.some((field) => field.kind === 'toggle' && field.key === 'prOverview')).toBe(true);
    expect(sectionsFor('extension').find((section) => section.id === 'experiments')?.fields.some((field) => field.kind === 'toggle' && field.key === 'prOverview')).toBe(false);
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

  it('marks **emphasis**, but not inside code', () => {
    expect(splitInlineCode('⚠️ **Are you sure?** Use `a**b`.')).toEqual([
      { kind: 'text', text: '⚠️ ' },
      { kind: 'strong', text: 'Are you sure?' },
      { kind: 'text', text: ' Use ' },
      { kind: 'code', text: 'a**b' },
      { kind: 'text', text: '.' },
    ]);
    expect(plainText('⚠️ **Are you sure?** Use `a**b`.')).toBe('⚠️ Are you sure? Use a**b.');
  });
});

describe('text presets', () => {
  const bedrock = { label: 'Amazon Bedrock', value: 'https://bedrock-mantle.{region}.api.aws' };
  const openai = { label: 'OpenAI', value: 'https://api.openai.com' };

  it('finds the blank to type over', () => {
    expect(presetBlank(bedrock.value)).toEqual({ start: 23, end: 31 });
    expect(bedrock.value.slice(23, 31)).toBe('{region}');
    expect(presetBlank(openai.value)).toBeNull();
  });

  it('recognises a saved value as its preset once the blank is filled', () => {
    expect(presetMatches(bedrock, 'https://bedrock-mantle.us-east-1.api.aws')).toBe(true);
    expect(presetMatches(bedrock, 'https://bedrock-mantle.us.east.api.aws')).toBe(false);
    expect(presetMatches(bedrock, 'https://bedrock-mantle.{region}.api.aws')).toBe(false);
    expect(presetMatches(openai, 'https://api.openai.com')).toBe(true);
    expect(presetMatches(openai, '')).toBe(false);
  });

  it('keeps groups in schema order', () => {
    const groups = presetGroups([
      { group: 'Gateways', label: 'A', value: 'a' },
      { group: 'Providers', label: 'B', value: 'b' },
      { group: 'Gateways', label: 'C', value: 'c' },
      { label: 'D', value: 'd' },
    ]);
    expect(groups.map((entry) => [entry.group, entry.presets.map((preset) => preset.label)])).toEqual([
      ['Gateways', ['A', 'C']],
      ['Providers', ['B']],
      [null, ['D']],
    ]);
  });

  it('gives every gateway preset a value the saved URL keeps', () => {
    const url = textFields(allFields).find((field) => field.key === 'aiBaseUrl');
    for (const preset of url?.presets ?? []) expect(normalizeAiBaseUrl(preset.value)).toBe(preset.value);
  });
});
