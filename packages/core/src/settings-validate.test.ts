import { describe, expect, it } from 'vitest';
import { serializeSettingsPayload } from './gist-sync';
import { DEFAULT_SETTINGS } from './settings';
import { collectSettingsIssues, describeValue, findJsonError, validateSettingsDocument, validateSettingsValue } from './settings-validate';

function issuesOf(content: string): readonly string[] {
  const result = validateSettingsDocument(content);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

describe('validateSettingsDocument', () => {
  it('accepts what Geld writes', () => {
    const result = validateSettingsDocument(serializeSettingsPayload(DEFAULT_SETTINGS));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts a bare settings object and normalises it', () => {
    const result = validateSettingsDocument('{"enabled": false}');
    expect(result).toEqual({ ok: true, settings: { ...DEFAULT_SETTINGS, enabled: false } });
  });

  it('reports invalid JSON with a location', () => {
    expect(issuesOf('{\n  "geld": 1,\n  "settings": { "enabled": tru }\n}')).toEqual([
      '$: The file is not valid JSON: expected a value at line 3, column 28.',
    ]);
    expect(issuesOf('{"geld": 1,}')).toEqual([
      '$: The file is not valid JSON: expected another property after the comma (trailing commas are not allowed) at line 1, column 12.',
    ]);
    expect(issuesOf('{"a": 1 "b": 2}')).toEqual(['$: The file is not valid JSON: expected "," or "}" after the value at line 1, column 9.']);
    expect(issuesOf('{"a": [1, 2')).toEqual(['$: The file is not valid JSON: expected "," or "]" after the item at line 1, column 12.']);
  });

  it('reports an empty or non-object file', () => {
    expect(issuesOf('   ')).toEqual(['$: The file is empty.']);
    expect(issuesOf('[1, 2]')).toEqual(['$: Expected a JSON object at the top level, got a list of 2.']);
  });

  it('keeps going and lists every problem with its path', () => {
    const issues = issuesOf(
      JSON.stringify({
        geld: 2,
        savedAt: 'yesterday',
        settings: {
          enabled: 'yes',
          categories: { tests: 'on', nope: true },
          testGroups: [],
          customPatterns: ['*.snap', 42, 'a[z-a]', '[]'],
          repoRules: ['acme/*', '!'],
          enterpriseHosts: ['github.example.com', 'not a host'],
          expandedByDefault: 1,
        },
      }),
    );
    expect(issues).toEqual([
      'geld: Expected the format version 1, got 2.',
      'savedAt: Expected an ISO date string, got "yesterday".',
      'settings.enabled: Expected true or false, got "yes".',
      'settings.expandedByDefault: Expected true or false, got 1.',
      'settings.categories.tests: Expected true or false, got "on".',
      expect.stringMatching(/^settings\.categories\.nope: Unknown category "nope"\. Known: "tests", /),
      'settings.testGroups: Expected an object mapping test group ids to true/false, got a list of 0.',
      'settings.customPatterns[1]: Expected a string, got 42.',
      'settings.customPatterns[2]: "a[z-a]" is not a valid pattern: range out of order in character class.',
      'settings.customPatterns[3]: Empty repository scope "[]"; use "[owner/repo]", "[owner/*]" or "[*]".',
      'settings.repoRules[1]: A rule needs a repository or owner after "!".',
      'settings.enterpriseHosts[1]: "not a host" is not a hostname Geld can run on (e.g. "github.example.com").',
    ]);
  });

  it('checks groups, per-category patterns and custom categories', () => {
    const issues = issuesOf(
      JSON.stringify({
        geld: 1,
        settings: {
          categories: { 'custom:mine': true, 'custom:gone-but-fine': false },
          groups: { 'tests/e2e': false, 'tests/nope': false, 'generated/lockfiles': 'no' },
          categoryPatterns: { docs: ['*.md', 'a[z-a]'], bogus: ['x'], tests: 'nope' },
          customCategories: [
            { id: 'custom:mine', title: 'Mine', icon: 'paintbrush', patterns: ['mine/**'] },
            { id: 'custom:mine', title: 'Dup', patterns: [] },
            { id: 'nope', title: '', icon: 'unicorn', patterns: ['[]'], noun: 3 },
            'not an object',
          ],
        },
      }),
    );
    expect(issues).toEqual([
      expect.stringMatching(/^settings\.groups\.tests\/nope: Unknown pattern group "tests\/nope"\./),
      'settings.groups.generated/lockfiles: Expected true or false, got "no".',
      'settings.categoryPatterns.docs[1]: "a[z-a]" is not a valid pattern: range out of order in character class.',
      expect.stringMatching(/^settings\.categoryPatterns\.bogus: Unknown built-in category "bogus"\./),
      'settings.categoryPatterns.tests: Expected a list of strings, got "nope".',
      'settings.customCategories[1].id: Duplicate category id "custom:mine".',
      'settings.customCategories[2].id: Expected an id like "custom:design-tokens", got "nope".',
      'settings.customCategories[2].title: Expected a name, got "".',
      expect.stringMatching(/^settings\.customCategories\[2\]\.icon: Unknown icon "unicorn"\./),
      'settings.customCategories[2].patterns[0]: Empty repository scope "[]"; use "[owner/repo]", "[owner/*]" or "[*]".',
      'settings.customCategories[2].noun: Expected a string, got 3.',
      'settings.customCategories[3]: Expected a category object, got "not an object".',
    ]);
    expect(
      issuesOf(JSON.stringify({ geld: 1, settings: { customCategories: [{ id: 'custom:ok', title: 'Ok', icon: 'tag', patterns: ['ok/**'] }], groups: { 'docs/docs': false } } })),
    ).toEqual([]);
  });

  it('ignores unknown keys so newer settings never look like corruption', () => {
    expect(issuesOf('{"geld":1,"settings":{"enabled":true,"futureSetting":{"x":1}}}')).toEqual([]);
  });

  it('treats a non-object settings value as one issue', () => {
    expect(issuesOf('{"geld":1,"settings":null}')).toEqual(['settings: Expected an object of settings, got null.']);
  });
});

describe('validateSettingsValue', () => {
  it('validates already-parsed exports the same way', () => {
    expect(validateSettingsValue({ geld: 1, settings: DEFAULT_SETTINGS })).toEqual({ ok: true, settings: DEFAULT_SETTINGS });
    expect(validateSettingsValue({ settings: { showBadge: 'no' } })).toEqual({
      ok: false,
      issues: [{ path: 'settings.showBadge', message: 'Expected true or false, got "no".' }],
    });
  });
});

describe('collectSettingsIssues', () => {
  it('finds nothing wrong with the defaults', () => {
    expect(collectSettingsIssues(DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe('describeValue', () => {
  it('summarises values briefly', () => {
    expect(describeValue(null)).toBe('null');
    expect(describeValue(undefined)).toBe('nothing');
    expect(describeValue([1, 2, 3])).toBe('a list of 3');
    expect(describeValue({})).toBe('an object');
    expect(describeValue('x'.repeat(50))).toBe(`"${'x'.repeat(37)}…"`);
    expect(describeValue(true)).toBe('true');
  });
});

describe('findJsonError', () => {
  it('accepts valid documents, including escapes and numbers', () => {
    expect(findJsonError('{"a": [1, -2.5e3, true, null, "x\\u00e9\\n"], "b": {}}')).toBeNull();
    expect(findJsonError('  "just a string"  ')).toBeNull();
  });

  it('agrees with JSON.parse on what is invalid', () => {
    for (const text of ['', '{', '[1,]', '{"a" 1}', '{a: 1}', '"unterminated', '01', '{"a": 1} extra', '"bad \\q escape"', '[1 2]']) {
      expect(() => JSON.parse(text)).toThrow();
      expect(findJsonError(text)).not.toBeNull();
    }
  });
});
