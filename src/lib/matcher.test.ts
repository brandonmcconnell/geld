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

  it('matches only custom patterns when built-in tests are off', () => {
    const custom = createMatcher({
      ...DEFAULT_SETTINGS,
      categories: { tests: false },
      customPatterns: ['*.generated.ts'],
    });
    expect(custom.categorize('src/a.test.ts')).toBeNull();
    expect(custom.categorize('src/schema.generated.ts')).toBe(TESTS_CATEGORY);
  });

  it('honours test sub-group toggles', () => {
    const noE2e = createMatcher({ ...DEFAULT_SETTINGS, testGroups: { e2e: false } });
    expect(noE2e.categorize('cypress/e2e/login.cy.ts')).toBeNull();
    expect(noE2e.categorize('src/a.test.ts')).toBe(TESTS_CATEGORY);
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
    const settings = { ...DEFAULT_SETTINGS, customPatterns: ['*.generated.ts', '[acme/*]', 'docs/adr/', '[*]', '!src/keep.test.ts'] };
    const acme = createMatcher(settings, 'acme/widgets');
    const other = createMatcher(settings, 'someone/else');
    expect(acme.categorize('docs/adr/0001.md')).toBe(TESTS_CATEGORY);
    expect(other.categorize('docs/adr/0001.md')).toBeNull();
    expect(other.categorize('x.generated.ts')).toBe(TESTS_CATEGORY);
    expect(acme.categorize('src/keep.test.ts')).toBeNull();
    expect(other.categorize('src/keep.test.ts')).toBeNull();
  });

  it('explains its decisions', () => {
    const matcher = createMatcher({ ...DEFAULT_SETTINGS, customPatterns: ['*.gen.ts', '!src/keep.test.ts'] });
    expect(matcher.explain('src/a.test.ts')).toMatchObject({ source: 'built-in', pattern: '*.test.*' });
    expect(matcher.explain('src/x.gen.ts')).toMatchObject({ source: 'custom', pattern: '*.gen.ts' });
    expect(matcher.explain('src/keep.test.ts')).toEqual({ category: null, rescuedBy: '!src/keep.test.ts' });
    expect(matcher.explain('src/index.ts')).toEqual({ category: null, rescuedBy: null });
  });

  it('lets custom negations rescue files from the built-in patterns', () => {
    const rescued = createMatcher({
      ...DEFAULT_SETTINGS,
      customPatterns: ['!tests/important/**'],
    });
    expect(rescued.categorize('tests/important/keep.ts')).toBeNull();
    expect(rescued.categorize('tests/other/hide.ts')).toBe(TESTS_CATEGORY);
  });
});
