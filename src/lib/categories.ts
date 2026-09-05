import { TEST_PATTERN_GROUPS } from './test-patterns';

/**
 * Categories of files Geld can hide. "tests" is on by default; the rest are
 * opt-in. Order matters: a path is attributed to the first matching category.
 */
export type CategoryId = 'tests' | 'generated' | 'vendored' | 'agents' | 'docs' | 'tooling' | 'stories';

export interface PatternGroup {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly patterns: readonly string[];
}

export interface HiddenCategory {
  readonly id: CategoryId;
  /** Human title, used for the tree section ("Tests"). */
  readonly title: string;
  readonly description: string;
  /** Long nouns for sentences, e.g. "test file" / "test files". */
  readonly noun: string;
  readonly nounPlural: string;
  /** Compact nouns for the count label, e.g. "test" / "tests". */
  readonly shortNoun: string;
  readonly shortNounPlural: string;
  readonly defaultEnabled: boolean;
  readonly groups: readonly PatternGroup[];
}

export const CATEGORIES: readonly HiddenCategory[] = [
  {
    id: 'tests',
    title: 'Tests',
    description: 'Unit, integration and end-to-end tests, snapshots and test tooling.',
    noun: 'test file',
    nounPlural: 'test files',
    shortNoun: 'test',
    shortNounPlural: 'tests',
    defaultEnabled: true,
    groups: TEST_PATTERN_GROUPS,
  },
  {
    id: 'generated',
    title: 'Generated',
    description: 'Lockfiles, build output and code produced by generators.',
    noun: 'generated file',
    nounPlural: 'generated files',
    shortNoun: 'generated',
    shortNounPlural: 'generated',
    defaultEnabled: false,
    groups: [
      {
        id: 'lockfiles',
        label: 'Lockfiles',
        description: 'Dependency lockfiles.',
        patterns: [
          'package-lock.json',
          'npm-shrinkwrap.json',
          'pnpm-lock.yaml',
          'yarn.lock',
          'bun.lock',
          'bun.lockb',
          'deno.lock',
          'Cargo.lock',
          'Gemfile.lock',
          'poetry.lock',
          'Pipfile.lock',
          'uv.lock',
          'pdm.lock',
          'composer.lock',
          'go.sum',
          'mix.lock',
          'pubspec.lock',
          'Podfile.lock',
          'Package.resolved',
          'packages.lock.json',
          'flake.lock',
          'gradle.lockfile',
        ],
      },
      {
        id: 'generated-code',
        label: 'Generated code & build output',
        description: 'Files a tool writes for you.',
        patterns: [
          '*.generated.*',
          '*.gen.*',
          '*.g.dart',
          '*.freezed.dart',
          '*.pb.go',
          '*.pb.*',
          '*_pb2.py',
          '*_pb2_grpc.py',
          '*.pb.cc',
          '*.pb.h',
          '*.min.js',
          '*.min.css',
          '*.map',
          '*.bundle.js',
          '*.d.ts.map',
          '__generated__/',
          'generated/',
          '.generated/',
          'dist/',
          'build/',
          'out/',
          '*.snap.js',
          'schema.graphql.json',
          'graphql.schema.json',
          '*.tsbuildinfo',
        ],
      },
    ],
  },
  {
    id: 'vendored',
    title: 'Vendored',
    description: 'Third-party code copied into the repository.',
    noun: 'vendored file',
    nounPlural: 'vendored files',
    shortNoun: 'vendored',
    shortNounPlural: 'vendored',
    defaultEnabled: false,
    groups: [
      {
        id: 'vendored',
        label: 'Vendored directories',
        description: 'Checked-in dependencies.',
        patterns: ['vendor/', 'vendors/', 'node_modules/', 'third_party/', 'third-party/', 'thirdparty/', 'Pods/', 'Carthage/', 'bower_components/', 'jspm_packages/', '.yarn/'],
      },
    ],
  },
  {
    id: 'agents',
    title: 'Agent config',
    description: 'Instructions and configuration for AI coding agents.',
    noun: 'agent config file',
    nounPlural: 'agent config files',
    shortNoun: 'agent',
    shortNounPlural: 'agent',
    defaultEnabled: false,
    groups: [
      {
        id: 'agents',
        label: 'AI agent files',
        description: 'Cursor, Claude, Codex, Copilot, Windsurf, Cline, Aider, ...',
        patterns: [
          '.cursor/',
          '.cursorrules',
          '.cursorignore',
          '.cursorindexingignore',
          'CLAUDE.md',
          'CLAUDE.local.md',
          '.claude/',
          'AGENTS.md',
          'AGENT.md',
          'GEMINI.md',
          '.gemini/',
          '.codex/',
          '.windsurfrules',
          '.windsurf/',
          '.clinerules',
          '.clinerules/',
          '.roo/',
          '.roomodes',
          '.aider*',
          '.github/copilot-instructions.md',
          '.github/instructions/',
          '.github/prompts/',
          '.continue/',
          '.junie/',
          '.kiro/',
          '.mcp.json',
          'mcp.json',
          'llms.txt',
          'llms-full.txt',
        ],
      },
    ],
  },
  {
    id: 'docs',
    title: 'Docs',
    description: 'Markdown, documentation folders and changelogs.',
    noun: 'documentation file',
    nounPlural: 'documentation files',
    shortNoun: 'doc',
    shortNounPlural: 'docs',
    defaultEnabled: false,
    groups: [
      {
        id: 'docs',
        label: 'Documentation',
        description: 'Prose and changelogs.',
        patterns: ['*.md', '*.mdx', '*.markdown', '*.rst', '*.adoc', '*.txt', 'docs/', 'doc/', 'CHANGELOG*', 'CHANGES*', 'HISTORY*', 'RELEASE_NOTES*', '.changeset/', '.changes/', 'LICENSE*', 'LICENCE*', 'NOTICE*', 'AUTHORS*', 'CONTRIBUTORS*'],
      },
    ],
  },
  {
    id: 'tooling',
    title: 'Tooling & CI',
    description: 'CI workflows, linters, formatters and build configuration.',
    noun: 'tooling file',
    nounPlural: 'tooling files',
    shortNoun: 'tooling',
    shortNounPlural: 'tooling',
    defaultEnabled: false,
    groups: [
      {
        id: 'ci',
        label: 'CI & automation',
        description: 'Workflow and bot configuration.',
        patterns: ['.github/workflows/', '.github/actions/', '.github/dependabot.yml', '.github/renovate.json*', 'renovate.json*', '.renovaterc*', '.gitlab-ci.yml', '.circleci/', '.travis.yml', 'azure-pipelines*.yml', 'Jenkinsfile*', 'bitbucket-pipelines.yml', '.buildkite/', 'cloudbuild.yaml', '.drone.yml', 'appveyor.yml', 'codecov.yml', '.codecov.yml', '.pre-commit-config.yaml', '.husky/', 'lefthook.yml', 'CODEOWNERS', '.github/CODEOWNERS', '.github/ISSUE_TEMPLATE/', '.github/PULL_REQUEST_TEMPLATE*', '.github/FUNDING.yml'],
      },
      {
        id: 'lint-format',
        label: 'Linters, formatters & editor config',
        description: 'Style tooling.',
        patterns: ['.eslintrc*', 'eslint.config.*', '.eslintignore', '.prettierrc*', 'prettier.config.*', '.prettierignore', 'biome.json*', '.stylelintrc*', 'stylelint.config.*', '.editorconfig', '.oxlintrc*', 'oxlint.config.*', '.markdownlint*', 'cspell.*', '.cspell*', '.commitlintrc*', 'commitlint.config.*', '.npmrc', '.nvmrc', '.node-version', '.tool-versions', '.ruby-version', '.python-version', 'mise.toml', '.mise.toml', '.gitattributes', '.gitignore', '.dockerignore', '.vscode/', '.idea/', '.devcontainer/'],
      },
      {
        id: 'build-config',
        label: 'Build & compiler configuration',
        description: 'Bundler, TypeScript and container configuration.',
        patterns: ['tsconfig*.json', 'jsconfig*.json', 'babel.config.*', '.babelrc*', 'webpack.config.*', 'webpack.*.js', 'rollup.config.*', 'vite.config.*', 'rolldown.config.*', 'rspack.config.*', 'esbuild.config.*', 'tsup.config.*', 'tsdown.config.*', 'turbo.json', 'nx.json', 'lerna.json', 'pnpm-workspace.yaml', '.swcrc', 'postcss.config.*', 'tailwind.config.*', 'Dockerfile*', 'docker-compose*.yml', 'docker-compose*.yaml', 'compose.yml', 'compose.yaml', 'Makefile', 'Procfile', 'netlify.toml', 'vercel.json', 'wrangler.toml', 'fly.toml', 'app.yaml', 'nixpacks.toml', 'Taskfile.yml', 'justfile'],
      },
    ],
  },
  {
    id: 'stories',
    title: 'Stories, fixtures & i18n',
    description: 'Storybook stories, test fixtures and translation catalogues.',
    noun: 'story or fixture file',
    nounPlural: 'stories, fixtures & i18n files',
    shortNoun: 'fixture',
    shortNounPlural: 'fixtures',
    defaultEnabled: false,
    groups: [
      {
        id: 'stories',
        label: 'Storybook stories',
        description: 'Component stories and Storybook configuration.',
        patterns: ['*.stories.*', '*.story.*', '.storybook/', '__stories__/', 'stories/'],
      },
      {
        id: 'fixtures',
        label: 'Fixtures & mock data',
        description: 'Static data used by tests and demos.',
        patterns: ['__fixtures__/', 'fixtures/', 'fixture/', '__mocks__/', 'mocks/', '__data__/', 'testdata/', 'seeds/', 'seed/'],
      },
      {
        id: 'i18n',
        label: 'Translations',
        description: 'Localisation catalogues.',
        patterns: ['locales/', 'locale/', 'i18n/', 'translations/', 'lang/', '*.po', '*.pot', '*.mo', '*.xlf', '*.xliff', '*.arb', '*.strings', '*.stringsdict', 'messages.*.xlf', 'intl/'],
      },
    ],
  },
];

export const CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map((category) => category.id);

const BY_ID = new Map<CategoryId, HiddenCategory>(CATEGORIES.map((category) => [category.id, category]));

export function categoryById(id: CategoryId): HiddenCategory {
  const category = BY_ID.get(id);
  if (category === undefined) throw new Error(`Unknown category: ${id}`);
  return category;
}

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && CATEGORY_IDS.some((id) => id === value);
}

/** Every pattern of a category, optionally limited to some of its groups. */
export function categoryPatterns(category: HiddenCategory, groupIds: ReadonlySet<string> | null = null): readonly string[] {
  const patterns: string[] = [];
  for (const group of category.groups) {
    if (groupIds !== null && !groupIds.has(group.id)) continue;
    patterns.push(...group.patterns);
  }
  return patterns;
}
