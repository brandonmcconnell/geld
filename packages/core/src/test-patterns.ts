/**
 * Built-in patterns describing files that exist to test other files, grouped
 * so users can hide only some kinds (unit vs end-to-end vs snapshots, ...).
 */

export type TestPatternGroupId = 'unit' | 'e2e' | 'directories' | 'snapshots' | 'tooling';

export interface TestPatternGroup {
  readonly id: TestPatternGroupId;
  readonly label: string;
  readonly description: string;
  readonly patterns: readonly string[];
}

/**
 * `*.spec.*` is deliberately restricted to code extensions: OpenAPI/AsyncAPI
 * documents are commonly named `api.spec.yaml`. `*.test.*` and friends are
 * safe to leave open; the only non-test files they catch are configuration
 * for a "test" environment (`appsettings.test.json`), which is test-related.
 */
const CODE_EXTENSIONS =
  '{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte,astro,py,rb,php,dart,kt,kts,swift,scala,sc,ex,exs,lua,cs,fs,fsx,go,rs,java,groovy,clj,cljs,cljc,coffee,res,ml,re,hs,zig,nim,jl,r,R,m,mm,sh,bash,zsh,ps1,sql,elm,gleam,erl,pl,pm,c,cc,cpp,cxx,h,hpp,cu}';

export const TEST_PATTERN_GROUPS: readonly TestPatternGroup[] = [
  {
    id: 'unit',
    label: 'Unit & integration tests',
    description: 'Test files that live next to the code they cover.',
    patterns: [
      '*.test.*',
      '*.tests.*',
      `*.spec.${CODE_EXTENSIONS}`,
      `*.specs.${CODE_EXTENSIONS}`,
      `*.unit.${CODE_EXTENSIONS}`,
      `*.integration.${CODE_EXTENSIONS}`,
      '*_test.*',
      '*_tests.*',
      `*_spec.${CODE_EXTENSIONS}`,
      'test_*.*',
      'tests_*.*',
      '*Test.{java,kt,kts,scala,groovy,php,cs,swift,dart}',
      '*Tests.{java,kt,kts,scala,groovy,php,cs,swift,dart}',
      '*TestCase.{java,kt,php,py,cs,swift}',
      '*Spec.{java,kt,kts,scala,groovy,js,ts}',
      '*IT.java',
      '*.bats',
      '*.robot',
      '*.feature',
    ],
  },
  {
    id: 'e2e',
    label: 'End-to-end tests',
    description: 'Browser and system level tests (Playwright, Cypress, WebdriverIO, ...).',
    patterns: [
      '*.e2e.*',
      '*.e2e-spec.*',
      '*.e2e-test.*',
      '*.cy.*',
      '*.pw.*',
      'e2e/',
      'e2e-tests/',
      'e2e_tests/',
      'cypress/',
      'playwright/',
      'playwright-report/',
      'test-results/',
      'integration-tests/',
      'integration_tests/',
      'acceptance/',
      'acceptance-tests/',
      'acceptance_tests/',
    ],
  },
  {
    id: 'directories',
    label: 'Test directories',
    description: 'Anything inside a directory that conventionally holds tests.',
    patterns: [
      'test/',
      'tests/',
      '__tests__/',
      '__test__/',
      'spec/',
      'specs/',
      '__specs__/',
      '__spec__/',
      '__mocks__/',
      'testing/',
      'testdata/',
      'test-data/',
      'test_data/',
      'test-utils/',
      'test_utils/',
      'testutils/',
      'test-helpers/',
      'test_helpers/',
      'testhelpers/',
      'unit-tests/',
      'unit_tests/',
      'Tests/',
      '*.Tests/',
      '*.Test/',
      '*.UnitTests/',
      '*.IntegrationTests/',
      '*Tests/',
      'androidTest/',
      'androidTestDebug/',
      'testFixtures/',
      'coverage/',
      '.nyc_output/',
      'htmlcov/',
    ],
  },
  {
    id: 'snapshots',
    label: 'Snapshots & recordings',
    description: 'Generated snapshot files, image baselines and HTTP cassettes.',
    patterns: [
      '*.snap',
      '*.snap.*',
      '__snapshots__/',
      '__image_snapshots__/',
      '*-snapshots/',
      '__cassettes__/',
      'cassettes/',
      'vcr_cassettes/',
      '__recordings__/',
    ],
  },
  {
    id: 'tooling',
    label: 'Test tooling & configuration',
    description: 'Test runner configuration, setup files and coverage settings.',
    patterns: [
      'jest.config.*',
      'jest.setup.*',
      'jest-setup.*',
      'jest.preset.*',
      'jest.*.config.*',
      'vitest.config.*',
      'vitest.setup.*',
      'vitest.workspace.*',
      'vitest.*.config.*',
      'playwright.config.*',
      'playwright.*.config.*',
      'cypress.config.*',
      'cypress.json',
      'cypress.env.json',
      'karma.conf.*',
      '.mocharc*',
      'mocha.opts',
      'wdio.conf.*',
      'wdio.*.conf.*',
      'protractor.conf.*',
      'nightwatch.conf.*',
      'nightwatch.json',
      'codecept.conf.*',
      'ava.config.*',
      'jasmine.json',
      'testem.js',
      '.testem.json',
      'setupTests.*',
      'setup-tests.*',
      'setup_tests.*',
      'test-setup.*',
      'test_setup.*',
      'testSetup.*',
      'pytest.ini',
      'conftest.py',
      'tox.ini',
      '.coveragerc',
      'codecov.yml',
      '.codecov.yml',
      '.nycrc',
      '.nycrc.*',
      'phpunit.xml',
      'phpunit.xml.dist',
      'phpunit.dist.xml',
      '.rspec',
      'spec_helper.rb',
      'rails_helper.rb',
      'test_helper.rb',
      '*.runsettings',
      '.testcaferc.*',
      'stryker.conf.*',
      'stryker.config.*',
    ],
  },
];

export const TEST_PATTERN_GROUP_IDS: readonly TestPatternGroupId[] = TEST_PATTERN_GROUPS.map((group) => group.id);

export function isTestPatternGroupId(value: unknown): value is TestPatternGroupId {
  return typeof value === 'string' && TEST_PATTERN_GROUP_IDS.some((id) => id === value);
}

export function allBuiltInTestPatterns(groupIds: ReadonlySet<TestPatternGroupId> | null = null): readonly string[] {
  const patterns: string[] = [];
  for (const group of TEST_PATTERN_GROUPS) {
    if (groupIds !== null && !groupIds.has(group.id)) continue;
    patterns.push(...group.patterns);
  }
  return patterns;
}
