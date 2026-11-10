import type { GeldSettings } from './settings';

/**
 * Declarative description of every user-facing setting. The extension's popup
 * and options page and the geld.sh account page render from this, so the
 * three surfaces cannot drift. Behaviour that needs browser APIs (permission
 * prompts, keyboard-shortcut hints) is attached by the surface, keyed by `key`.
 *
 * Copy may use `backticks` for inline code and **double asterisks** for emphasis; render with {@link splitInlineCode}.
 */

/** Boolean settings, addressable by key. */
export type BooleanSettingKey = {
  [K in keyof GeldSettings]: GeldSettings[K] extends boolean ? K : never;
}[keyof GeldSettings];

/** Line-list settings (one entry per line in the UI). */
export type ListSettingKey = {
  [K in keyof GeldSettings]: GeldSettings[K] extends readonly string[] ? K : never;
}[keyof GeldSettings];

/** Settings that pick one of a fixed set of string values. */
export type ChoiceSettingKey = 'repoConfigs' | 'compactTimeline' | 'reviewGrouping' | 'suggestedFixes';

/** Freeform string settings (URLs, model ids). Distinct from {@link ChoiceSettingKey}. */
export type TextSettingKey = 'aiBaseUrl' | 'aiModel' | 'aiDecisionModel';

export type SettingsSurface = 'extension' | 'site';

interface FieldBase {
  readonly label: string;
  readonly description: string;
  /** Also show in the toolbar popup (the compact view; the options page shows everything). */
  readonly popup: boolean;
  /** Shorter copy for the popup; falls back to `description`. */
  readonly popupDescription?: string;
  /** Surfaces that can meaningfully edit this field. Omitted means both. */
  readonly surfaces?: readonly SettingsSurface[];
}

export interface ToggleField extends FieldBase {
  readonly kind: 'toggle';
  readonly key: BooleanSettingKey;
}

export interface ChoiceOption<K extends ChoiceSettingKey = ChoiceSettingKey> {
  readonly value: GeldSettings[K];
  readonly label: string;
  readonly description: string;
}

/** One of a few values, shown as a segmented control. */
export interface ChoiceField<K extends ChoiceSettingKey = ChoiceSettingKey> extends FieldBase {
  readonly kind: 'choice';
  readonly key: K;
  readonly options: readonly ChoiceOption<K>[];
}

/** Copy for a pattern editor (a textarea with syntax help and a save button). */
export interface PatternEditorCopy {
  readonly label: string;
  readonly description: string;
  readonly placeholder: string;
  readonly rows: number;
  /** Short syntax help shown next to the editor. */
  readonly syntax: readonly string[];
  /** Verb for the save button ("Save patterns"). */
  readonly saveLabel: string;
}

/**
 * One row per category (built-in and custom) with its switch. Each built-in
 * row has an "advanced" disclosure holding the group checkboxes and the extra
 * patterns editor; surfaces open it by default when
 * `hasAdvancedSettings` is true for that category.
 */
export interface CategoriesField extends FieldBase {
  readonly kind: 'categories';
  readonly advanced: {
    readonly description: string;
    readonly groupsLabel: string;
    readonly groupsDescription: string;
  };
  readonly extraPatterns: PatternEditorCopy;
  /**
   * The per-category "mark hidden files as viewed" checkbox, also shown in each custom category's editor. The popup
   * has one switch for every category at once, with its own copy.
   */
  readonly autoViewed: { readonly label: string; readonly description: string; readonly popupLabel: string; readonly popupDescription: string };
}

/** Editor for user-defined categories: title, icon and patterns. */
export interface CustomCategoriesField extends FieldBase {
  readonly kind: 'custom-categories';
  readonly addLabel: string;
  readonly emptyLabel: string;
  readonly titleLabel: string;
  readonly titlePlaceholder: string;
  readonly iconLabel: string;
  readonly nounLabel: string;
  readonly nounDescription: string;
  readonly patterns: PatternEditorCopy;
  readonly deleteLabel: string;
  readonly deleteConfirm: string;
}

export interface ListField extends FieldBase {
  readonly kind: 'list';
  readonly key: ListSettingKey;
  readonly placeholder: string;
  readonly rows: number;
  /** Short syntax help shown next to the editor. */
  readonly syntax: readonly string[];
  /** Verb for the save button ("Save patterns"). */
  readonly saveLabel: string;
}

export interface TextField extends FieldBase {
  readonly kind: 'text';
  readonly key: TextSettingKey;
  readonly placeholder: string;
  readonly autocomplete?: string;
  /** Ready-made values offered under the field, applied with one click. */
  readonly presets?: readonly TextPreset[];
}

export interface TextPreset {
  readonly label: string;
  /** May hold `{blanks}` the reader fills in (a region, a resource name) before it is saved. */
  readonly value: string;
  /** Presets sharing a group are listed on one labelled line, in schema order. */
  readonly group?: string;
  /** Shown under the presets while this one is the saved value. Copy may use `backticks`. */
  readonly note?: string;
}

const PRESET_BLANK = /\{[a-z]+\}/i;

/** Where the first `{blank}` sits in a preset value, so a click can select it for typing over. */
export function presetBlank(value: string): { readonly start: number; readonly end: number } | null {
  const match = PRESET_BLANK.exec(value);
  return match === null ? null : { start: match.index, end: match.index + match[0].length };
}

/** Whether a saved value is this preset, with its blanks filled in by anything that stays inside one URL segment. */
export function presetMatches(preset: TextPreset, value: string): boolean {
  if (value === '') return false;
  if (presetBlank(preset.value) === null) return value === preset.value;
  const pattern = preset.value
    .split(/(\{[a-z]+\})/i)
    .map((part) => (PRESET_BLANK.test(part) ? '[^/.{}\\s]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${pattern}$`, 'i').test(value);
}

/** Presets grouped for display: one entry per group in first-seen order, ungrouped presets under `null`. */
export function presetGroups(presets: readonly TextPreset[]): readonly { readonly group: string | null; readonly presets: readonly TextPreset[] }[] {
  const groups = new Map<string | null, TextPreset[]>();
  for (const preset of presets) {
    const key = preset.group ?? null;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [preset]);
    else list.push(preset);
  }
  return [...groups].map(([group, list]) => ({ group, presets: list }));
}

export type MaintenanceActionId = 'export' | 'import' | 'clear-cache' | 'copy-diagnostics' | 'report-diagnostics' | 'reset';

/** A one-off operation on the whole settings document. */
export interface MaintenanceAction {
  readonly id: MaintenanceActionId;
  readonly label: string;
  readonly description: string;
  /** Destructive: styled as such and confirmed before running. */
  readonly danger?: boolean;
  /** Ask before running, with this question. */
  readonly confirm?: string;
  /** Surfaces where the action exists. Omitted means both. */
  readonly surfaces?: readonly SettingsSurface[];
}

/** Buttons that act on the whole settings document (backup, restore, reset). */
export interface ActionsField extends FieldBase {
  readonly kind: 'actions';
  readonly actions: readonly MaintenanceAction[];
}

export interface IssueTrackerField extends FieldBase {
  readonly kind: 'issue-tracker';
  readonly key: 'issueTracker';
  readonly providerLabel: string;
  readonly noneLabel: string;
  readonly keysLabel: string;
  readonly keysDescription: string;
  readonly keysPlaceholder: string;
  readonly baseUrlLabel: string;
  readonly workspaceLabel: string;
  readonly saveLabel: string;
}

export type SettingsField = IssueTrackerField | ToggleField | ChoiceField | CategoriesField | CustomCategoriesField | ListField | TextField | ActionsField;

export type SettingsSectionId = 'general' | 'hide' | 'tests' | 'large-diffs' | 'custom-categories' | 'repositories' | 'lists' | 'experiments' | 'enterprise' | 'maintenance';

export interface SettingsSection {
  readonly id: SettingsSectionId;
  readonly title: string;
  readonly intro: string;
  readonly fields: readonly SettingsField[];
}

export const SETTINGS_SCHEMA: readonly SettingsSection[] = [
  {
    id: 'general',
    title: 'General',
    intro: '',
    fields: [
      {
        kind: 'toggle',
        key: 'enabled',
        label: 'Enabled on GitHub',
        description: 'Turn Geld off to see GitHub exactly as it ships.',
        popup: true,
        popupDescription: 'Changes apply instantly to open tabs.',
      },
      {
        kind: 'toggle',
        key: 'prOverview',
        label: 'Pull request digest',
        description:
          'A panel under the description on the conversation tab: reviews, what each review bot concluded, CI, reports and previews, then the open threads round by round, so what needs you is clear at a glance.',
        popup: true,
        popupDescription: 'Reviews, bots, CI and open threads at a glance.',
      },
      {
        kind: 'toggle',
        key: 'groupHidden',
        label: 'Group hidden files',
        description:
          'On: hidden files move to a collapsible section at the bottom of the diff and get their own panels in the file tree. Off: they stay where they are, collapsed and faded, with their category’s icon in the tree.',
        popup: true,
        popupDescription: 'Off: keep them in place, collapsed and faded.',
      },
      {
        kind: 'toggle',
        key: 'collapseDescription',
        label: 'Shorten the description',
        description: 'Fold each section of the pull request description under its heading. A description still taller than 500px is cut there with a control to show the rest.',
        popup: true,
        popupDescription: 'Fold its sections under their headings.',
      },
      {
        kind: 'toggle',
        key: 'relatedLinks',
        label: 'Related links',
        description:
          'Related links lists tickets, conversations, agent sessions, reviews and documents linked in the description. Related work shows linked issues and pull or merge requests, plus a native stack when the provider supplies one.',
        popup: false,
      },
      {
        kind: 'toggle',
        key: 'attachmentLightbox',
        label: 'Attachment lightbox',
        description: 'View image and video attachments in a larger player in issues and pull requests.',
        popup: false,
        surfaces: ['extension'],
      },
      {
        kind: 'toggle',
        key: 'expandedByDefault',
        label: 'Show hidden files expanded',
        description:
          'Hidden files still move to the bottom and are excluded from the counts, but stay visible. Pages where every file is hidden always start expanded.',
        popup: true,
        popupDescription: 'Grouped at the bottom, but not collapsed.',
      },
      {
        kind: 'toggle',
        key: 'hideCommentLines',
        label: 'Hide comment-only lines',
        description:
          'Inside files that stay visible, collapse changed lines that only add, remove or edit code comments (in a language Geld knows). A row in the diff says how many and shows them on click; the header counts leave them out.',
        popup: false,
      },
      {
        kind: 'toggle',
        key: 'expandLargeDiffs',
        label: 'Expand large diffs',
        description:
          'GitHub collapses files with 1000+ changed lines behind a "Load diff" button. Load them as soon as the page renders, unless Geld hides the file. Generated files GitHub collapses stay collapsed.',
        popup: false,
      },
      {
        kind: 'toggle',
        key: 'showListStats',
        label: 'Line counts in lists and on commits',
        description:
          'Adds "N tests +A −D" to each PR on list pages such as /pulls, with the breakdown on hover, and shows the same breakdown when you rest on a commit link (the PR timeline, the Commits tab) for a moment. Diffs are fetched only for rows you scroll to and commits you hover.',
        popup: false,
      },
      {
        kind: 'toggle',
        key: 'hideWhitespace',
        label: 'Hide whitespace changes',
        description:
          "Uses GitHub's own “hide whitespace” option (the ?w=1 view) on every diff you open, so indentation-only changes never clutter a review. GitHub does not remember it, so Geld adds it on your way in. Turn it off in GitHub's diff settings on a pull request and Geld leaves that one alone until you turn it back on there.",
        popup: false,
      },
      {
        kind: 'toggle',
        key: 'shortcutEnabled',
        label: 'Keyboard shortcut (Alt+Shift+T)',
        description: 'Shows or hides the hidden files on the current page until you leave it; it never changes your saved settings.',
        popup: false,
        surfaces: ['extension'],
      },
      {
        kind: 'toggle',
        key: 'showBadge',
        label: 'Count on the toolbar icon',
        description: 'Shows how many files are hidden on the current tab.',
        popup: false,
        surfaces: ['extension'],
      },
      {
        kind: 'toggle',
        key: 'autoUpdatePatterns',
        label: 'Keep built-in patterns up to date',
        description:
          'Once a day Geld fetches the built-in pattern catalog from its GitHub repository (`api.github.com`, no sign-in) and uses it if it is newer, so new conventions are recognised without waiting for a store release. The file is signed; anything that does not verify is ignored. Which categories are on, and your own patterns, never change this way.',
        popup: false,
        surfaces: ['extension'],
      },
      {
        kind: 'toggle',
        key: 'errorReports',
        label: 'Send error reports',
        description:
          'When part of Geld breaks, send the error and where in Geld’s code it happened to `geld.sh`, with the version and browser. Addresses, repository and file names, people and page text are removed first. Off: errors stay on this device, in Copy diagnostics.',
        popup: false,
        surfaces: ['extension'],
      },
    ],
  },
  {
    id: 'hide',
    title: 'What to hide',
    intro:
      'Each category has its own switch. Tests are on by default; everything else is opt-in. Open a category to turn off some of its built-in pattern groups or add patterns of your own.',
    fields: [
      {
        kind: 'categories',
        label: 'Hide',
        description: 'Kinds of files to move out of the way.',
        popup: true,
        advanced: {
          description: 'Built-in pattern groups and your own patterns for this category.',
          groupsLabel: 'Built-in patterns',
          groupsDescription: 'Untick a group to stop hiding the files it matches.',
        },
        extraPatterns: {
          label: 'Extra patterns',
          description: 'Your own globs for this category.',
          rows: 5,
          placeholder: '*.golden\n!src/keep/**\n\n[acme/*]\nfixtures/**/*.json',
          syntax: [
            '`*.snap` matches a file name anywhere; `fixtures/` a directory anywhere; `src/**/*.gen.ts` a full path.',
            '`{a,b}` expands alternatives; a leading `!` keeps a file visible even if a built-in pattern of this category would hide it.',
            '`[acme/*]` scopes the lines below it to those repositories; `[*]` returns to all.',
          ],
          saveLabel: 'Save patterns',
        },
        autoViewed: {
          label: 'Mark as viewed automatically',
          popupLabel: 'Mark hidden files viewed',
          popupDescription: 'Tick GitHub’s Viewed box for every hidden file on a pull request. Set it per category in Settings.',
          description:
            'On pull requests, tick GitHub’s Viewed box for this category’s hidden files, so “N of M files viewed” only waits on what is left to review. Untick one by hand and it stays unticked until the next push.',
        },
      },
    ],
  },
  {
    id: 'tests',
    title: 'Test files',
    intro:
      'In a test file Geld folds each test’s body under its line, so the diff reads as the tests that were added, removed, renamed or changed. Open a test to read its source. Suites stay open so titles nest, and hooks such as `beforeEach` fold too.',
    fields: [
      {
        kind: 'toggle',
        key: 'testOutline',
        label: 'Fold tests to their titles',
        description:
          'Applies to the files the Tests category recognises, whether hidden or not. Each fold says what changed inside it. Known syntaxes: Jest, Vitest, Mocha, Jasmine, Bun, node:test, Playwright, Cypress, Deno, pytest and unittest, Go and its subtests, Rust, JUnit, TestNG, Kotest, xUnit, NUnit, MSTest, XCTest and Swift Testing, PHPUnit and Pest, RSpec and minitest, ExUnit, Dart, busted, hspec, ScalaTest, clojure.test, testthat and Gherkin.',
        popup: false,
      },
      {
        kind: 'list',
        key: 'testSyntaxes',
        label: 'Your test syntaxes',
        description: 'Declarations Geld does not know yet, one per line. They are read before the built-in ones.',
        popup: false,
        rows: 4,
        placeholder: 'scenario\nsuite: feature\nhook: givenEach\ntest: /^\\s*verify\\s+"(?<title>[^"]+)"/',
        syntax: [
          'A name, such as `scenario` or `t.test`: a call or keyword followed by a quoted title declares a test.',
          '`suite: feature` declares a suite, which stays open with titles nested under it. `hook: givenEach` declares a hook, which folds under its own name.',
          'A `/regex/` matches the whole declaration line, with the title in a `(?<title>…)` group or the first group; put a kind before it the same way.',
        ],
        saveLabel: 'Save syntaxes',
      },
    ],
  },
  {
    id: 'large-diffs',
    title: 'Large diffs',
    intro: 'Large diffs are often the real work. Hiding them is a separate, deliberate opt-in rather than another routine filter.',
    fields: [
      {
        kind: 'toggle',
        key: 'hideLargeDiffs',
        label: 'Hide large diffs ⚠️',
        description:
          'Move files with 1000+ changed lines out of the initial review and exclude them from the visible counts. Enable this carefully: size alone does not make a change unimportant.',
        // A deliberate opt-in with a warning to read: the options page and geld.sh only, not the toolbar popup.
        popup: false,
      },
    ],
  },
  {
    id: 'custom-categories',
    title: 'Your categories',
    intro:
      'Add categories of your own — say, `Migrations` or `Design tokens`. Each gets a switch, its own panel in the file tree and its own count, and is matched before the built-in categories.',
    fields: [
      {
        kind: 'custom-categories',
        label: 'Custom categories',
        description: 'Categories you defined.',
        popup: false,
        addLabel: 'Add category',
        emptyLabel: 'No custom categories yet.',
        titleLabel: 'Name',
        titlePlaceholder: 'Design tokens',
        iconLabel: 'Icon',
        nounLabel: 'Count label (singular, plural)',
        nounDescription: 'Used in counts such as “3 tokens”. Defaults to the name.',
        patterns: {
          label: 'Patterns',
          description: 'Files that belong to this category.',
          rows: 5,
          placeholder: 'tokens/**\n*.tokens.json\n!tokens/README.md',
          syntax: [
            '`*.snap` matches a file name anywhere; `fixtures/` a directory anywhere; `src/**/*.gen.ts` a full path.',
            '`{a,b}` expands alternatives; a leading `!` keeps a file visible.',
            '`[acme/*]` scopes the lines below it to those repositories; `[*]` returns to all.',
          ],
          saveLabel: 'Save category',
        },
        deleteLabel: 'Delete category',
        deleteConfirm: 'Delete this category? Files it matched will show again.',
      },
    ],
  },
  {
    id: 'repositories',
    title: 'Repositories',
    intro:
      'Where Geld should stay off, one rule per line, like a `.gitignore` for repositories: `acme/widgets` turns Geld off in that repository, `acme` (or `acme/*`) in the whole organisation, a leading `!` turns it back on, and the last matching line wins. Leave empty to run everywhere. For an allowlist, start with `*` and add `!acme/*` below it.',
    fields: [
      {
        kind: 'list',
        key: 'repoRules',
        label: 'Repository rules',
        description: 'Repositories and organisations where Geld stays off.',
        popup: false,
        rows: 5,
        placeholder: 'acme/legacy-app\nbig-corp\n!big-corp/the-one-repo-i-review',
        syntax: [
          '`acme/widgets` turns Geld off in that repository; `acme` (or `acme/*`) in the whole organisation.',
          'A leading `!` turns it back on; the last matching line wins.',
          'For an allowlist, start with `*` and add `!acme/*` below it.',
        ],
        saveLabel: 'Save rules',
      },
      {
        kind: 'choice',
        key: 'repoConfigs',
        label: 'Repository configs',
        description:
          'A repository can ship a `.github/geld.yml` (and an organisation its defaults in its `.github` repository) that adds categories and patterns for everyone reviewing it, and names the review bots installed on it (`reviewBots`) so Request a review offers them on every pull request. Repository-provided rules are counted and listed like your own; the popup says whose config is in use. Every key: geld.sh/repo-config',
        popup: false,
        options: [
          { value: 'always', label: 'Always', description: 'Use every repository config without asking.' },
          { value: 'ask', label: 'Ask once per repository', description: 'The popup asks the first time a repository provides one; the answer is remembered on this device.' },
          { value: 'never', label: 'Never', description: 'Only your own settings apply.' },
        ],
      },
      {
        kind: 'issue-tracker', key: 'issueTracker', popup: false,
        label: 'Personal issue tracker',
        description: 'Recognize links using your fallback tracker. Allowed repository configs and a selected Geld team can override it. This does not grant tracker access.',
        providerLabel: 'Tracker', noneLabel: 'No personal tracker',
        keysLabel: 'Allowed project keys, repositories or IDs',
        keysDescription: 'One scope per line. Use project keys for Linear, Jira or YouTrack, owner/repository for Git issues, owner/project-number for GitHub Projects, and workspace or project IDs for Asana or Monday.',
        keysPlaceholder: 'ENG\nacme/repository\n123456',
        baseUrlLabel: 'Tracker HTTPS origin', workspaceLabel: 'Linear workspace', saveLabel: 'Save personal tracker',
      },
    ],
  },
  {
    id: 'lists',
    title: 'Hidden people',
    intro:
      'People and bots you never want to see. Their pull requests are hidden in PR lists and stacks, behind a row that says how many and shows them on click. Their reviews and comments are left out of the pull request digest, where a closed eye on the Reviews or Review bots row lists them with Peek and Unhide. Anyone GitHub shows with a comment hidden as spam or abuse is left out of the digest too. A reply of theirs in someone else’s review thread is folded there. One login or provider-qualified identity per line. `*` matches anything, so `*[bot]` hides every GitHub App (dependabot[bot], renovate[bot], github-actions[bot]).',
    fields: [
      {
        kind: 'list',
        key: 'hiddenAuthors',
        label: 'Hidden people',
        description: 'Logins whose pull requests, reviews and comments Geld hides.',
        popup: false,
        rows: 4,
        placeholder: '*[bot]\nrenovate*',
        syntax: [
          'A login as GitHub shows it: `dependabot[bot]`, `octocat`; a leading `@` is fine.',
          'GitLab uses its native username. Bitbucket Cloud uses `bitbucket.org/uuid/<UUID>` with the canonical account UUID without braces. Names and nicknames are not logins. Authors that cannot be resolved remain visible.',
          '`*` matches any run of characters: `*[bot]` is every GitHub App, `renovate*` every Renovate account.',
          'Matching ignores case. Lines starting with `#` are comments.',
        ],
        saveLabel: 'Save hidden people',
      },
    ],
  },
  {
    id: 'experiments',
    title: 'Experiments',
    intro:
      'Features still taking shape, and liable to change. Most of them fine-tune the pull request digest: how much of the timeline it folds, how it groups, which bots it reads, and the AI that can write for it. The Geld GitHub Action writes the digest as one comment. Without it the extension builds the same panel from the page.',
    fields: [
      {
        kind: 'choice',
        key: 'compactTimeline',
        label: 'Timeline',
        description:
          '`Compact` folds bot reviews and noisy events into accordions. `Minimal` also folds human comments that belong to finished items. `Off` leaves GitHub’s timeline and only shows the panel.',
        popup: false,
        options: [
          { value: 'off', label: 'Off', description: 'Leave the timeline as GitHub shows it; still render the digest panel.' },
          { value: 'compact', label: 'Compact', description: 'Fold bot review comments and low-signal events. Human discussion stays.' },
          { value: 'minimal', label: 'Minimal', description: 'Also fold human comments on done items. Powerful, easy to miss a remark.' },
        ],
      },
      {
        kind: 'choice',
        key: 'reviewGrouping',
        label: 'Group the digest by',
        description: '`Type` lists bots, CI, reviews, review rounds and activity as their own sections. `Push` lists every push as one row holding what landed since the previous one: its threads, reviews, previews and commits.',
        popup: false,
        options: [
          { value: 'type', label: 'Type', description: 'Bots, CI, reviews, rounds and activity, each in its own section.' },
          { value: 'batch', label: 'Push', description: 'One row per push with everything that landed between it and the last.' },
        ],
      },
      {
        kind: 'toggle',
        key: 'quickReview',
        label: 'Submit review from any tab',
        description: 'Put the Submit review button in the pull request’s tab bar, beside the line counts, on every tab. The Files changed tab’s own button gives way to it.',
        popup: false,
      },
      {
        kind: 'toggle',
        key: 'holdToMerge',
        label: 'Hold ⌘ to merge from the status pill',
        description: 'While ⌘ (Ctrl on Windows and Linux) is held, the pull request’s status pill becomes a Merge button whenever GitHub would merge it now. Off, the pill only opens its menu of statuses.',
        popup: false,
      },
      {
        kind: 'list',
        key: 'reviewBots',
        label: 'Extra review bots',
        description: 'Logins to treat as review bots on top of the built-in list (Bugbot, Greptile, Copilot, CodeRabbit, Codex, Devin, Gemini).',
        popup: false,
        rows: 3,
        placeholder: 'my-reviewer[bot]',
        syntax: [
          'A login as GitHub shows it: `my-bot[bot]`. Built-in bots do not need to be listed.',
          '`*` is allowed the same way as hidden authors. Lines starting with `#` are comments.',
        ],
        saveLabel: 'Save bots',
      },
      {
        kind: 'list',
        key: 'trustedReviewAccounts',
        label: 'Trusted review accounts',
        description: 'GitLab and Bitbucket review services use different accounts in each installation. Trust a native account id as a service only in the repository you name. Names and comment markers never establish this trust.',
        popup: false,
        rows: 4,
        placeholder: 'gitlab.com/group/project coderabbit 12345\nbitbucket.org/workspace/repo coderabbit {12345678-1234-1234-1234-123456789abc}',
        syntax: [
          'One exact repository, bot id and native account id per line, separated by spaces. No wildcards or credentials.',
          'GitLab uses a numeric user id. Bitbucket uses an account UUID. Lines starting with `#` are comments.',
          'A trust action on a review records this binding for you. Remove its line to withdraw trust.',
        ],
        saveLabel: 'Save trusted accounts',
      },
      {
        kind: 'list',
        key: 'trustedSummaryPublishers',
        label: 'Trusted summary publishers',
        description: 'Trust an actual GitLab or Bitbucket account to publish Geld summaries in one exact repository. This is separate from review bot identity and does not attest that a CI job ran.',
        popup: false,
        rows: 4,
        placeholder: 'gitlab.com/group/project 12345\nbitbucket.org/workspace/repo {12345678-1234-1234-1234-123456789abc}',
        syntax: [
          'One exact repository and native account id per line, separated by a space. No wildcards or credentials.',
          'GitLab uses a numeric user id. Bitbucket uses an account UUID. A personal token account can publish summaries too.',
          'Only your explicit choice grants trust. Remove a line to withdraw it. Repository configuration cannot grant trust.',
        ],
        saveLabel: 'Save trusted publishers',
      },
      {
        kind: 'choice',
        key: 'suggestedFixes',
        label: 'Suggested fixes',
        description: 'Review bots often attach a fix; with AI on, Geld can propose one too. Choose which appear on an item.',
        popup: false,
        options: [
          { value: 'bots', label: 'From bots', description: 'Show the fix a review bot attached to its comment.' },
          { value: 'ai', label: 'From AI', description: 'Only fixes the consolidation model proposes (needs a gateway key).' },
          { value: 'all', label: 'Both', description: 'Bot fixes and, with AI on, proposed ones.' },
          { value: 'off', label: 'Off', description: 'Never show a suggested fix; the finding alone.' },
        ],
      },
      {
        kind: 'toggle',
        key: 'aiEnabled',
        label: 'AI features',
        description:
          'Consolidate bot findings, write the TL;DR and propose fixes with a model of your choosing. Off, nothing below is used and no request is made; on, it takes effect once a gateway URL, key and model are set.',
        popup: false,
        surfaces: ['extension'],
      },
      {
        kind: 'text',
        key: 'aiBaseUrl',
        label: 'AI gateway URL',
        description:
          'Any OpenAI-compatible base URL: a gateway, a provider, a model on this computer, or your own. Paste it with or without the `/v1`, requests add their own path. The key stays on this device (`storage.local`, never the gist).',
        popup: false,
        placeholder: 'https://ai-gateway.vercel.sh',
        autocomplete: 'off',
        surfaces: ['extension'],
        presets: [
          { group: 'Gateways', label: 'Vercel AI Gateway', value: 'https://ai-gateway.vercel.sh' },
          { group: 'Gateways', label: 'OpenRouter', value: 'https://openrouter.ai/api' },
          {
            group: 'Gateways',
            label: 'Cloudflare AI Gateway',
            value: 'https://api.cloudflare.com/client/v4/accounts/{account}/ai',
            note: 'Fill in your Cloudflare account ID. The key is a Cloudflare API token, and models are named like `openai/gpt-4.1`.',
          },
          { group: 'Providers', label: 'OpenAI', value: 'https://api.openai.com' },
          {
            group: 'Providers',
            label: 'Amazon Bedrock',
            value: 'https://bedrock-mantle.{region}.api.aws',
            note: 'Fill in your AWS region, such as `us-east-1`. The key is an Amazon Bedrock API key.',
          },
          {
            group: 'Providers',
            label: 'Azure OpenAI',
            value: 'https://{resource}.openai.azure.com/openai',
            note: 'Fill in your Azure OpenAI resource name. Models are your deployment names.',
          },
          { group: 'Providers', label: 'Google Gemini', value: 'https://generativelanguage.googleapis.com/v1beta/openai' },
          { group: 'Providers', label: 'Groq', value: 'https://api.groq.com/openai' },
          {
            group: 'On this computer',
            label: 'Ollama',
            value: 'http://localhost:11434',
            note: 'Ollama ignores the key, so any text will do. Start it with `OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*` so it answers browser extensions.',
          },
        ],
      },
      {
        kind: 'text',
        key: 'aiModel',
        label: 'AI model',
        description: 'The model that writes: consolidated findings, the TL;DR, proposed fixes. Listed from the gateway once a URL and key are saved; evaluation models such as Jev are not offered here.',
        popup: false,
        placeholder: 'anthropic/claude-sonnet-4.5',
        autocomplete: 'off',
        surfaces: ['extension'],
      },
      {
        kind: 'toggle',
        key: 'aiJev',
        label: 'Use a decision model',
        description:
          'A decision model answers typed questions with calibrated probabilities instead of prose, in milliseconds and for a fraction of the cost. With it on, Geld asks it which findings report the same problem before the AI model rewrites them, and what each folded comment is. Off, the AI model decides that itself.',
        popup: false,
        surfaces: ['extension'],
      },
      {
        kind: 'text',
        key: 'aiDecisionModel',
        label: 'Decision model',
        description: 'Listed from the gateway when it serves decision models (Vercel AI Gateway, OpenRouter, OpenAI). Leave it on automatic for TypeSafe’s Jev where the gateway offers it, the gateway’s own decision model otherwise, or Jev with a TypeSafe key of your own.',
        popup: false,
        placeholder: 'Automatic',
        autocomplete: 'off',
        surfaces: ['extension'],
      },
    ],
  },
  {
    id: 'enterprise',
    title: 'GitHub Enterprise Server',
    intro:
      "Geld runs on `github.com` out of the box. Add the hostname of your company's GitHub Enterprise Server (one per line, e.g. `github.example.com`) and your browser will ask you to allow Geld on that site. Geld never contacts anything other than the GitHub hosts you list here.",
    fields: [
      {
        kind: 'list',
        key: 'enterpriseHosts',
        label: 'GitHub Enterprise Server hosts',
        description: 'Extra GitHub hosts Geld runs on.',
        popup: false,
        rows: 3,
        placeholder: 'github.example.com',
        syntax: ['Hostnames only. Permission to run on a host is granted in the browser, so this is edited in the extension.'],
        saveLabel: 'Save hosts',
        surfaces: ['extension'],
      },
    ],
  },
  {
    id: 'maintenance',
    title: 'Backup & maintenance',
    intro: '',
    fields: [
      {
        kind: 'actions',
        label: 'Backup & maintenance',
        description: 'Export, import or reset every setting at once.',
        popup: false,
        actions: [
          {
            id: 'export',
            label: 'Export settings (JSON)',
            description: 'Download every setting as geld-settings.json, the same document the settings gist holds.',
          },
          {
            id: 'import',
            label: 'Import settings…',
            description: 'Replace every setting with those in an exported file. The file is checked first and problems are listed.',
          },
          {
            id: 'clear-cache',
            label: 'Clear cached diffs',
            description: 'Forget the parsed diffs and repository config files stored on this device; they are fetched again as needed.',
            surfaces: ['extension'],
          },
          {
            id: 'copy-diagnostics',
            label: 'Copy diagnostics',
            description:
              'Copies a short log of this session\'s diff fetches (which pull request, outcome, timing, rate budget) and each GitHub tab\'s timings and lifecycle to the clipboard, for bug reports. No URLs, content or tokens.',
            surfaces: ['extension'],
          },
          {
            id: 'report-diagnostics',
            label: 'Report with diagnostics',
            description:
              'Opens GitHub\'s new-issue form with the same report filled in, plus a place to say what was happening. The report goes to GitHub alone, as the form\'s prefilled text, and nothing is posted until you submit the issue there; it is also copied to the clipboard in case the link had to trim it.',
            surfaces: ['extension'],
          },
          {
            id: 'reset',
            label: 'Reset to defaults',
            description: 'Put every setting back to how Geld ships.',
            danger: true,
            confirm: 'Reset every setting to the defaults? Custom categories, patterns and repository rules will be removed.',
          },
        ],
      },
    ],
  },
];

function visibleOn(field: SettingsField, surface: SettingsSurface): boolean {
  return field.surfaces === undefined || field.surfaces.includes(surface);
}

/** Fields to show on a surface, optionally only those flagged for the toolbar popup, in schema order. */
export function fieldsFor(surface: SettingsSurface, popupOnly = false): readonly SettingsField[] {
  const fields: SettingsField[] = [];
  for (const section of SETTINGS_SCHEMA) {
    for (const field of section.fields) {
      if (!visibleOn(field, surface)) continue;
      if (popupOnly && !field.popup) continue;
      fields.push(field);
    }
  }
  return fields;
}

/** Sections with only the fields a surface can edit; empty sections are dropped. */
export function sectionsFor(surface: SettingsSurface): readonly SettingsSection[] {
  return SETTINGS_SCHEMA.map((section) => ({
    ...section,
    fields: section.fields.filter((field) => visibleOn(field, surface)),
  })).filter((section) => section.fields.length > 0);
}

/** The actions of an {@link ActionsField} that exist on a surface. */
export function actionsFor(field: ActionsField, surface: SettingsSurface): readonly MaintenanceAction[] {
  return field.actions.filter((action) => action.surfaces === undefined || action.surfaces.includes(surface));
}

export function toggleFields(fields: readonly SettingsField[]): readonly ToggleField[] {
  return fields.filter((field): field is ToggleField => field.kind === 'toggle');
}

export function choiceFields(fields: readonly SettingsField[]): readonly ChoiceField[] {
  return fields.filter((field): field is ChoiceField => field.kind === 'choice');
}

export function listFields(fields: readonly SettingsField[]): readonly ListField[] {
  return fields.filter((field): field is ListField => field.kind === 'list');
}

export function textFields(fields: readonly SettingsField[]): readonly TextField[] {
  return fields.filter((field): field is TextField => field.kind === 'text');
}

export type InlineRun =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string };

/**
 * Split copy on `backticks` (inline code) and **double asterisks** (emphasis)
 * so each surface can render them its own way. Code wins inside code: a `**`
 * within backticks is left alone.
 */
export function splitInlineCode(copy: string): readonly InlineRun[] {
  const runs: InlineRun[] = [];
  copy.split('`').forEach((part, index) => {
    if (part === '') return;
    if (index % 2 === 1) {
      runs.push({ kind: 'code', text: part });
      return;
    }
    part.split('**').forEach((piece, pieceIndex) => {
      if (piece === '') return;
      runs.push({ kind: pieceIndex % 2 === 1 ? 'strong' : 'text', text: piece });
    });
  });
  return runs;
}

/** The same copy with the markup removed, for places that only take text (tooltips, aria labels). */
export function plainText(copy: string): string {
  return splitInlineCode(copy)
    .map((run) => run.text)
    .join('');
}
