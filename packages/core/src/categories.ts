import type { CategoryIconName } from './category-icons';
import type { ListSurfaceSpec } from './list-surfaces';
import { BUNDLED_LIST_SURFACES } from './list-surfaces';
import { TEST_PATTERN_GROUPS } from './test-patterns';

/**
 * Built-in categories of files Geld can hide. "tests" is on by default; the
 * rest are opt-in. Order matters: a path is attributed to the first matching
 * category. Users can add their own categories on top (see {@link CustomCategoryId}).
 */
export type CategoryId = 'tests' | 'generated' | 'vendored' | 'agents' | 'docs' | 'tooling' | 'stories' | 'trivial';

/** Ids of user-defined categories are namespaced so they can never collide with built-ins. */
export type CustomCategoryId = `custom:${string}`;

export type AnyCategoryId = CategoryId | CustomCategoryId;

export function isCustomCategoryId(value: unknown): value is CustomCategoryId {
  return typeof value === 'string' && /^custom:[a-z0-9][a-z0-9-]{0,40}$/.test(value);
}

export function isAnyCategoryId(value: unknown): value is AnyCategoryId {
  return isCategoryId(value) || isCustomCategoryId(value);
}

/** Ids of built-in categories and pattern groups: short, lower-case, stable forever. */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Whether a string could be a built-in category or group id (see {@link ID_PATTERN}). */
export function isWellFormedId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export interface PatternGroup {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly patterns: readonly string[];
}

/** Everything a category carries besides its id. */
export interface CategoryShape {
  /** Human title, used for the tree section ("Tests"). */
  readonly title: string;
  readonly description: string;
  /** Octicon shown next to the title in the sidebar, popup and settings. */
  readonly icon: CategoryIconName;
  /** Long nouns for sentences, e.g. "test file" / "test files". */
  readonly noun: string;
  readonly nounPlural: string;
  /** Compact nouns for the count label, e.g. "test" / "tests". */
  readonly shortNoun: string;
  readonly shortNounPlural: string;
  readonly defaultEnabled: boolean;
  readonly groups: readonly PatternGroup[];
}

export interface HiddenCategory extends CategoryShape {
  readonly id: AnyCategoryId;
}

/** A built-in category: same shape, but its id is one of the fixed {@link CategoryId}s. */
export interface BuiltInCategory extends HiddenCategory {
  readonly id: CategoryId;
}

/**
 * The pattern catalog: the built-in categories with their groups and globs.
 * One copy is compiled into every build ({@link BUNDLED_CATALOG}); the
 * extension may swap in a newer, signed copy fetched from the repository
 * (see `catalog.ts`), which is why everything that lists or matches built-in
 * categories takes a catalog instead of reading the constant.
 */
export interface Catalog {
  /**
   * Monotonic integer; a fetched catalog is used only when its version is
   * higher than the bundled one. Convention: the publication date as
   * `YYYYMMDD` (shown as `2026.09.08`), or that number plus one for a second
   * release on the same day.
   */
  readonly version: number;
  /** Lowest extension version (first three numeric parts) that may use this catalog. */
  readonly minExtensionVersion: string;
  readonly categories: readonly BuiltInCategory[];
  /** How PR lists are recognised and where chips go, per GitHub UI (see `list-surfaces.ts`); updatable like the patterns. */
  readonly listSurfaces: readonly ListSurfaceSpec[];
}

/**
 * Bump whenever {@link CATEGORIES}, {@link TEST_PATTERN_GROUPS} or the list
 * surfaces (`list-surfaces.ts`) change and
 * run `pnpm catalog:build` (which refuses a stale version) and `pnpm catalog:sign`.
 */
export const CATALOG_VERSION = 20260912;

/** The extension version that introduced the updatable catalog; older builds never fetch it. */
export const CATALOG_MIN_EXTENSION_VERSION = '0.1.1';

export const CATEGORIES: readonly BuiltInCategory[] = [
  {
    id: 'tests',
    title: 'Tests',
    description: 'Unit, integration and end-to-end tests, snapshots and test tooling.',
    icon: 'beaker',
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
    icon: 'package-dependencies',
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
    icon: 'package',
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
    icon: 'copilot',
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
    icon: 'book',
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
    icon: 'tools',
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
    title: 'Fixtures',
    description: 'Storybook stories, test fixtures, mock data and translation catalogues.',
    icon: 'stack',
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
  {
    id: 'trivial',
    title: 'Trivial changes',
    description:
      'Files hidden for what changed in them rather than where they live: renames and permission changes with no edits, binary and deleted files, whitespace-only or comment-only edits and very large diffs. Decided from the diff, so these groups have no patterns.',
    icon: 'filter',
    noun: 'trivial change',
    nounPlural: 'trivial changes',
    shortNoun: 'trivial',
    shortNounPlural: 'trivial',
    defaultEnabled: false,
    groups: [
      { id: 'renames', label: 'Renamed or moved without edits', description: 'The path changed, the contents did not.', patterns: [] },
      { id: 'modes', label: 'Permission changes only', description: 'File mode flipped (100644 → 100755), no lines changed.', patterns: [] },
      { id: 'binary', label: 'Binary files', description: 'Images, fonts, archives and anything else GitHub cannot show as text.', patterns: [] },
      { id: 'deleted', label: 'Deleted files', description: 'Files removed by the change.', patterns: [] },
      { id: 'whitespace', label: 'Whitespace-only edits', description: 'Every changed line differs only in spaces, tabs or line endings.', patterns: [] },
      { id: 'comments', label: 'Comment-only edits', description: 'Every changed line is a code comment (or blank), in a language Geld knows.', patterns: [] },
      {
        id: 'large',
        label: 'Very large diffs',
        description: 'More than a thousand changed lines in one file; GitHub stops rendering these by default too.',
        patterns: [],
      },
    ],
  },
];

/** The catalog compiled into this build: the fallback, and where category defaults come from. */
export const BUNDLED_CATALOG: Catalog = {
  version: CATALOG_VERSION,
  minExtensionVersion: CATALOG_MIN_EXTENSION_VERSION,
  categories: CATEGORIES,
  listSurfaces: BUNDLED_LIST_SURFACES,
};

export const CATEGORY_IDS: readonly CategoryId[] = ['tests', 'generated', 'vendored', 'agents', 'docs', 'tooling', 'stories', 'trivial'];

/**
 * The category whose groups are change kinds (see `change-kinds.ts`) rather
 * than path patterns. It is matched last, so a file that a path category
 * claims is attributed there even when its change is also trivial.
 */
export const CHANGE_KINDS_CATEGORY_ID: CategoryId = 'trivial';

/**
 * Look a built-in category up in a catalog. The set of category ids is fixed
 * by the bundled catalog (a new category needs an extension release, because
 * it needs a default and copy), so this never fails; the fetched catalog can
 * only change what a category contains.
 */
export function categoryById(id: CategoryId, catalog: Catalog = BUNDLED_CATALOG): BuiltInCategory {
  const category = catalog.categories.find((candidate) => candidate.id === id);
  if (category === undefined) throw new Error(`Unknown category: ${id}`);
  return category;
}

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && CATEGORY_IDS.some((id) => id === value);
}

/**
 * Key of a built-in pattern group inside its category (`tests/unit`,
 * `generated/lockfiles`). Group ids are only unique within a category.
 */
export type GroupKey = `${CategoryId}/${string}`;

export function groupKey(categoryId: CategoryId, groupId: string): GroupKey {
  return `${categoryId}/${groupId}`;
}

/** Split a group key; `null` unless both the category and the group exist in `catalog`. */
export function parseGroupKey(value: unknown, catalog: Catalog = BUNDLED_CATALOG): { readonly category: BuiltInCategory; readonly group: PatternGroup } | null {
  if (typeof value !== 'string') return null;
  const slash = value.indexOf('/');
  if (slash === -1) return null;
  const categoryId = value.slice(0, slash);
  const groupId = value.slice(slash + 1);
  if (!isCategoryId(categoryId)) return null;
  const category = categoryById(categoryId, catalog);
  const group = category.groups.find((candidate) => candidate.id === groupId);
  return group === undefined ? null : { category, group };
}

export function isGroupKey(value: unknown, catalog: Catalog = BUNDLED_CATALOG): value is GroupKey {
  return parseGroupKey(value, catalog) !== null;
}

/**
 * `category/group` where the category is a built-in and the group id is
 * well formed, whether or not this build knows the group. Settings keep such
 * keys because a newer catalog (or a newer extension writing the same gist)
 * may have introduced the group; dropping the key would silently re-enable it
 * there.
 */
export function isWellFormedGroupKey(value: unknown): value is GroupKey {
  if (typeof value !== 'string') return false;
  const slash = value.indexOf('/');
  if (slash === -1) return false;
  return isCategoryId(value.slice(0, slash)) && isWellFormedId(value.slice(slash + 1));
}

/** Every `category/group` key a catalog defines, in catalog order. */
export function catalogGroupKeys(catalog: Catalog = BUNDLED_CATALOG): readonly GroupKey[] {
  return catalog.categories.flatMap((category) => category.groups.map((group) => groupKey(category.id, group.id)));
}

/** A category the user defined: a title, an icon and the patterns that belong to it. */
export interface CustomCategory {
  readonly id: CustomCategoryId;
  readonly title: string;
  readonly icon: CategoryIconName;
  /**
   * Same syntax as every other pattern list: globs, `!` rescues and
   * `[owner/repo]` scope headers.
   */
  readonly patterns: readonly string[];
  /** Compact nouns for count labels ("2 tokens"); default to the lower-cased title. */
  readonly noun?: string;
  readonly nounPlural?: string;
}

/** The single pattern group a custom category exposes to UIs that list groups. */
export const CUSTOM_GROUP_ID = 'patterns';

/** View a custom category the way the rest of Geld sees categories. */
export function hiddenCategoryFromCustom(custom: CustomCategory): HiddenCategory {
  const nounPlural = custom.nounPlural ?? custom.title.toLowerCase();
  const noun = custom.noun ?? nounPlural;
  return {
    id: custom.id,
    title: custom.title,
    description: '',
    icon: custom.icon,
    noun,
    nounPlural,
    shortNoun: noun,
    shortNounPlural: nounPlural,
    defaultEnabled: true,
    groups: [{ id: CUSTOM_GROUP_ID, label: 'Patterns', description: 'Your patterns for this category.', patterns: custom.patterns }],
  };
}

/** Turn a title into a fresh id, avoiding the ids already taken. */
export function customCategoryId(title: string, taken: ReadonlySet<string> = new Set()): CustomCategoryId {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'category';
  let candidate: CustomCategoryId = `custom:${slug}`;
  for (let counter = 2; taken.has(candidate); counter += 1) candidate = `custom:${slug}-${counter}`;
  return candidate;
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
