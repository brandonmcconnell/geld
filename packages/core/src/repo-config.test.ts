import { describe, expect, it } from 'vitest';
import { createMatcher } from './matcher';
import { applyRepoConfig, applyRepoConfigs, describeRepoConfig, generatedConfigFrom, linguistGeneratedPatterns, parseRepoConfig } from './repo-config';
import { DEFAULT_SETTINGS } from './settings';

describe('parseRepoConfig', () => {
  it('accepts the settings vocabulary', () => {
    const result = parseRepoConfig(`
version: 1
categories:
  docs: true
groups:
  tests/snapshots: false
categoryPatterns:
  generated:
    - "src/api/__generated__/**"
customCategories:
  - id: custom:fixtures
    title: Fixtures
    icon: package
    patterns: ["fixtures/**"]
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.categories).toEqual({ docs: true });
    expect(result.config.groups).toEqual({ 'tests/snapshots': false });
    expect(result.config.categoryPatterns.generated).toEqual(['src/api/__generated__/**']);
    expect(result.config.customCategories).toHaveLength(1);
    expect(describeRepoConfig(result.config)).toBe('2 categories, 1 group, 2 patterns');
  });

  it('treats an empty file as an empty config', () => {
    const result = parseRepoConfig('# nothing yet\n');
    expect(result).toEqual({ ok: true, config: { categories: {}, groups: {}, categoryPatterns: {}, customCategories: [] } });
  });

  it('reports YAML syntax errors with a position', () => {
    const result = parseRepoConfig('categories:\n  docs: [true\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toMatch(/^line \d+, column \d+$/);
    expect(result.issues[0]?.message).toMatch(/^Not valid YAML/);
  });

  it('collects every problem, including personal settings', () => {
    const result = parseRepoConfig(`
enabled: false
repoRules: ["acme/*"]
categories:
  docs: "yes"
categoryPatterns:
  generated: ["src/[z-a].ts"]
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(['enabled', 'repoRules', 'categories.docs', 'categoryPatterns.generated[0]']);
  });

  it('ignores unknown keys for forward compatibility', () => {
    expect(parseRepoConfig('somethingNewer: 1\n').ok).toBe(true);
  });
});

describe('applyRepoConfig', () => {
  it('lets the repository switch categories and add patterns without dropping user rescues', () => {
    const user = { ...DEFAULT_SETTINGS, categoryPatterns: { generated: ['[acme/other]', 'vendor/**'] }, categories: { generated: false } };
    const parsed = parseRepoConfig('categories:\n  generated: true\ncategoryPatterns:\n  generated: ["dist/**"]\n');
    if (!parsed.ok) throw new Error('expected ok');
    const merged = applyRepoConfig(user, parsed.config);
    expect(merged.categories.generated).toBe(true);
    // A `[*]` reset sits between the user's (scoped) lines and the repository's.
    expect(merged.categoryPatterns.generated).toEqual(['[acme/other]', 'vendor/**', '[*]', 'dist/**']);
    expect(createMatcher(merged, 'acme/widgets').categorize('dist/bundle.js')?.id).toBe('generated');
    expect(createMatcher(merged, 'acme/widgets').categorize('vendor/x.js')).toBeNull();
  });

  it('keeps the user’s custom category when ids collide and layers org before repo', () => {
    const user = { ...DEFAULT_SETTINGS, customCategories: [{ id: 'custom:fixtures' as const, title: 'Mine', icon: 'package' as const, patterns: ['mine/**'] }] };
    const org = parseRepoConfig('customCategories:\n  - id: custom:fixtures\n    title: Theirs\n    icon: package\n    patterns: ["theirs/**"]\ncategories:\n  docs: true\n');
    const repo = parseRepoConfig('categories:\n  docs: false\n');
    if (!org.ok || !repo.ok) throw new Error('expected ok');
    const merged = applyRepoConfigs(user, [org.config, repo.config]);
    expect(merged.customCategories.map((custom) => custom.title)).toEqual(['Mine']);
    expect(merged.categories.docs).toBe(false);
  });
});

describe('linguistGeneratedPatterns', () => {
  it('turns .gitattributes lines into Generated patterns', () => {
    const text = `
# comment
*.pb.go linguist-generated=true
/docs/api/** linguist-generated
"with space/*.js" linguist-generated
vendor/keep.js -linguist-generated
other.js linguist-generated=false
plain.js diff=js
`;
    expect(linguistGeneratedPatterns(text)).toEqual(['*.pb.go', 'docs/api/**', 'with space/*.js', '!vendor/keep.js', '!other.js']);
    // Patterns only add to a category; whether Generated hides anything stays the user's call.
    expect(createMatcher(applyRepoConfig(DEFAULT_SETTINGS, generatedConfigFrom(text))).categorize('a/b/c.pb.go')).toBeNull();
    const merged = applyRepoConfig({ ...DEFAULT_SETTINGS, categories: { generated: true } }, generatedConfigFrom(text));
    expect(createMatcher(merged).categorize('a/b/c.pb.go')?.id).toBe('generated');
    expect(createMatcher(merged).categorize('vendor/keep.js')).toBeNull();
  });
});
