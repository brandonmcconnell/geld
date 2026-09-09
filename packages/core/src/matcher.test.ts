import { createMatcher, TESTS_CATEGORY } from './matcher';
import { DEFAULT_SETTINGS } from './settings';

const matcher = createMatcher(DEFAULT_SETTINGS);
const isTest = (path: string): boolean => matcher.categorize(path) === TESTS_CATEGORY;

describe('built-in test detection', () => {
  it.each([
    // JavaScript / TypeScript
    'src/utils.test.ts',
    'src/components/Button.spec.tsx',
    'packages/wxt/src/core/package-managers/__tests__/npm.test.ts',
    'packages/wxt/e2e/tests/auto-imports.test.ts',
    'packages/wxt/e2e/utils.ts',
    'playground/lazy-compilation/__tests__/lazy-compilation.spec.ts',
    'src/__mocks__/fs.ts',
    'src/__snapshots__/render.test.ts.snap',
    'cypress/e2e/login.cy.ts',
    'e2e/checkout.spec.ts-snapshots/checkout-1-chromium.png',
    'jest.config.js',
    'vitest.config.mts',
    'vitest.workspace.ts',
    'playwright.config.ts',
    'src/setupTests.ts',
    'test/fixtures/data.json',
    'tests/integration/api.int.test.ts',
    'apps/web/src/features/cart/cart.e2e.ts',
    // Python
    'tests/test_models.py',
    'app/test_views.py',
    'app/models_test.py',
    'conftest.py',
    'pytest.ini',
    'tox.ini',
    // Go
    'pkg/server/server_test.go',
    'pkg/server/testdata/golden.json',
    // Ruby
    'spec/models/user_spec.rb',
    'spec/spec_helper.rb',
    '.rspec',
    // JVM
    'src/test/java/com/example/FooTest.java',
    'app/src/androidTest/java/com/example/ExampleInstrumentedTest.kt',
    'core/src/main/kotlin/FooTest.kt',
    'service/src/it/java/FooIT.java',
    // .NET / Swift
    'src/MyApp.Tests/UnitTest1.cs',
    'MyAppTests/MyAppTests.swift',
    'Tests/GeldTests/GeldTests.swift',
    // PHP / Dart / Elixir
    'tests/Feature/LoginTest.php',
    'phpunit.xml.dist',
    'test/widget_test.dart',
    'test/geld_test.exs',
    // Misc
    'features/login.feature',
    'coverage/lcov.info',
    'scripts/deploy.bats',
  ])('hides %s', (path) => {
    expect(isTest(path)).toBe(true);
  });

  it.each([
    'src/index.ts',
    'README.md',
    'package.json',
    'bun.lock',
    'docs/.vitepress/loaders/cli.data.ts',
    'src/latest.java',
    'src/contest/results.ts',
    'src/testimonials/list.tsx',
    'openapi/api.spec.yaml',
    'src/components/Button.stories.tsx',
    'vite.config.ts',
    'src/attestation.ts',
    'src/protester.py',
    'lib/testable.rb',
    'assets/latest.png',
    'src/manifest.json',
  ])('keeps %s', (path) => {
    expect(isTest(path)).toBe(false);
  });
});

describe('settings interplay', () => {
  it('matches nothing when disabled', () => {
    const disabled = createMatcher({ ...DEFAULT_SETTINGS, enabled: false });
    expect(disabled.categorize('src/a.test.ts')).toBeNull();
  });

  it('turning a category off also drops its extra patterns', () => {
    const custom = createMatcher({
      ...DEFAULT_SETTINGS,
      categories: { tests: false },
      categoryPatterns: { tests: ['*.generated.ts'] },
    });
    expect(custom.categorize('src/a.test.ts')).toBeNull();
    expect(custom.categorize('src/schema.generated.ts')).toBeNull();
  });

  it('extra patterns extend a built-in category and are attributed to it', () => {
    const matcher = createMatcher({
      ...DEFAULT_SETTINGS,
      categories: { generated: true },
      categoryPatterns: { generated: ['*.golden'], tests: ['*.spec.yaml'] },
    });
    expect(matcher.explain('lib/a.golden')).toMatchObject({ category: { id: 'generated' }, source: 'custom', pattern: '*.golden' });
    expect(matcher.explain('api.spec.yaml')).toMatchObject({ category: TESTS_CATEGORY, source: 'custom' });
  });

  it('honours group toggles on every built-in category', () => {
    const noE2e = createMatcher({ ...DEFAULT_SETTINGS, groups: { 'tests/e2e': false } });
    expect(noE2e.categorize('cypress/e2e/login.cy.ts')).toBeNull();
    expect(noE2e.categorize('src/a.test.ts')).toBe(TESTS_CATEGORY);
    const noLockfiles = createMatcher({ ...DEFAULT_SETTINGS, categories: { generated: true }, groups: { 'generated/lockfiles': false } });
    expect(noLockfiles.categorize('pnpm-lock.yaml')).toBeNull();
    expect(noLockfiles.categorize('dist/bundle.min.js')?.id).toBe('generated');
  });

  it('matches custom categories before built-ins, with their own icon and nouns', () => {
    const matcher = createMatcher({
      ...DEFAULT_SETTINGS,
      customCategories: [{ id: 'custom:tokens', title: 'Design tokens', icon: 'paintbrush', patterns: ['tokens/**', '*.test.tsx'], noun: 'token', nounPlural: 'tokens' }],
    });
    expect(matcher.activeCategories.map((category) => category.id)).toEqual(['custom:tokens', 'tests']);
    const hit = matcher.explain('tokens/colors.json');
    expect(hit).toMatchObject({ source: 'custom', pattern: 'tokens/**', category: { id: 'custom:tokens', title: 'Design tokens', icon: 'paintbrush', shortNounPlural: 'tokens' } });
    // A file both a custom and a built-in category match goes to the custom one.
    expect(matcher.categorize('src/Button.test.tsx')?.id).toBe('custom:tokens');
    const off = createMatcher({ ...DEFAULT_SETTINGS, categories: { 'custom:tokens': false }, customCategories: [{ id: 'custom:tokens', title: 'T', icon: 'tag', patterns: ['tokens/**'] }] });
    expect(off.categorize('tokens/colors.json')).toBeNull();
  });

  it('attributes paths to the first matching enabled category', () => {
    const all = createMatcher({
      ...DEFAULT_SETTINGS,
      categories: { tests: true, generated: true, vendored: true, agents: true, docs: true, tooling: true, stories: true },
    });
    expect(all.categorize('pnpm-lock.yaml')?.id).toBe('generated');
    expect(all.categorize('vendor/lib/thing.js')?.id).toBe('vendored');
    expect(all.categorize('.cursor/rules/style.mdc')?.id).toBe('agents');
    expect(all.categorize('CLAUDE.md')?.id).toBe('agents');
    expect(all.categorize('README.md')?.id).toBe('docs');
    expect(all.categorize('.github/workflows/ci.yml')?.id).toBe('tooling');
    expect(all.categorize('src/Button.stories.tsx')?.id).toBe('stories');
    expect(all.categorize('src/index.ts')).toBeNull();
    expect(all.activeCategories.map((category) => category.id)).toEqual([
      'tests',
      'generated',
      'vendored',
      'agents',
      'docs',
      'tooling',
      'stories',
    ]);
  });

  it('applies repo-scoped custom patterns only to matching repositories', () => {
    const settings = { ...DEFAULT_SETTINGS, categoryPatterns: { tests: ['*.generated.ts', '[acme/*]', 'docs/adr/', '[*]', '!src/keep.test.ts'] } };
    const acme = createMatcher(settings, 'acme/widgets');
    const other = createMatcher(settings, 'someone/else');
    expect(acme.categorize('docs/adr/0001.md')).toBe(TESTS_CATEGORY);
    expect(other.categorize('docs/adr/0001.md')).toBeNull();
    expect(other.categorize('x.generated.ts')).toBe(TESTS_CATEGORY);
    expect(acme.categorize('src/keep.test.ts')).toBeNull();
    expect(other.categorize('src/keep.test.ts')).toBeNull();
  });

  it('explains its decisions', () => {
    const matcher = createMatcher({ ...DEFAULT_SETTINGS, categoryPatterns: { tests: ['*.gen.ts', '!src/keep.test.ts'] } });
    expect(matcher.explain('src/a.test.ts')).toMatchObject({ source: 'built-in', pattern: '*.test.*' });
    expect(matcher.explain('src/x.gen.ts')).toMatchObject({ source: 'custom', pattern: '*.gen.ts' });
    expect(matcher.explain('src/keep.test.ts')).toEqual({ category: null, rescuedBy: '!src/keep.test.ts' });
    expect(matcher.explain('src/index.ts')).toEqual({ category: null, rescuedBy: null });
  });

  it('lets a rescue keep files out of one category without affecting others', () => {
    const rescued = createMatcher({
      ...DEFAULT_SETTINGS,
      categories: { docs: true },
      categoryPatterns: { tests: ['!tests/important/**'] },
    });
    expect(rescued.categorize('tests/important/keep.ts')).toBeNull();
    expect(rescued.categorize('tests/other/hide.ts')).toBe(TESTS_CATEGORY);
    // The rescue is scoped to Tests: a docs file inside that folder is still docs.
    expect(rescued.categorize('tests/important/README.md')?.id).toBe('docs');
  });
});

describe('change kinds (Trivial changes category)', () => {
  const on = { ...DEFAULT_SETTINGS, categories: { trivial: true } };

  it('attributes files by what changed only when the category is on', () => {
    const matcher = createMatcher(on);
    expect(matcher.usesChangeKinds).toBe(true);
    expect(matcher.categorizeFile({ path: 'src/moved.ts', kinds: ['renames'] })?.id).toBe('trivial');
    expect(matcher.categorizeFile({ path: 'src/big.ts', additions: 900, deletions: 200 })?.id).toBe('trivial');
    expect(matcher.categorizeFile({ path: 'src/plain.ts', additions: 3, deletions: 1 })).toBeNull();
    expect(matcher.categorize('src/moved.ts')).toBeNull();
    expect(createMatcher(DEFAULT_SETTINGS).categorizeFile({ path: 'src/moved.ts', kinds: ['renames'] })).toBeNull();
  });

  it('lets path categories win and honours group toggles and rescues', () => {
    const matcher = createMatcher({ ...on, groups: { 'trivial/binary': false }, categoryPatterns: { trivial: ['!keep/**'] } });
    expect(matcher.categorizeFile({ path: 'src/a.test.ts', kinds: ['renames'] })?.id).toBe('tests');
    expect(matcher.categorizeFile({ path: 'logo.png', kinds: ['binary'] })).toBeNull();
    expect(matcher.categorizeFile({ path: 'keep/moved.ts', kinds: ['renames'] })).toBeNull();
    const verdict = matcher.explainFile({ path: 'src/moved.ts', kinds: ['renames'] });
    expect(verdict.category !== null && verdict.source === 'kind' ? verdict.kind : null).toBe('renames');
  });
});
