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
export type TextSettingKey = 'aiBaseUrl' | 'aiModel';

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
  readonly value: string;
}

export type MaintenanceActionId = 'export' | 'import' | 'clear-cache' | 'reset';

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

export type SettingsField = ToggleField | ChoiceField | CategoriesField | CustomCategoriesField | ListField | TextField | ActionsField;

export type SettingsSectionId = 'general' | 'hide' | 'large-diffs' | 'custom-categories' | 'repositories' | 'lists' | 'experiments' | 'enterprise' | 'maintenance';

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
        key: 'groupHidden',
        label: 'Group hidden files',
        description:
          'On: hidden files move to a collapsible section at the bottom of the diff and get their own panels in the file tree. Off: they stay where they are, collapsed and faded, with their category’s icon in the tree.',
        popup: true,
        popupDescription: 'Off: keep them in place, collapsed and faded.',
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
          "Uses GitHub's own “hide whitespace” option (the ?w=1 view) on every diff you open, so indentation-only changes never clutter a review. GitHub does not remember it, so Geld adds it on your way in.",
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
        popup: true,
        popupDescription: 'Move 1000+ line diffs out of review. Enable carefully.',
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
          'A repository can ship a `.github/geld.yml` (and an organisation its defaults in its `.github` repository) that adds categories and patterns for everyone reviewing it. Repository-provided rules are counted and listed like your own; the popup says whose config is in use.',
        popup: false,
        options: [
          { value: 'always', label: 'Always', description: 'Use every repository config without asking.' },
          { value: 'ask', label: 'Ask once per repository', description: 'The popup asks the first time a repository provides one; the answer is remembered on this device.' },
          { value: 'never', label: 'Never', description: 'Only your own settings apply.' },
        ],
      },
    ],
  },
  {
    id: 'lists',
    title: 'Pull request lists',
    intro:
      'Pull requests opened by these authors are hidden in PR lists and stacks, behind a row that says how many and shows them on click. One login per line; `*` matches anything, so `*[bot]` hides every GitHub App (dependabot[bot], renovate[bot], github-actions[bot]).',
    fields: [
      {
        kind: 'list',
        key: 'hiddenAuthors',
        label: 'Hidden authors',
        description: 'Pull request authors whose PRs are hidden in lists.',
        popup: false,
        rows: 4,
        placeholder: '*[bot]\nrenovate*',
        syntax: [
          'A login as GitHub shows it: `dependabot[bot]`, `octocat`; a leading `@` is fine.',
          '`*` matches any run of characters: `*[bot]` is every GitHub App, `renovate*` every Renovate account.',
          'Matching ignores case. Lines starting with `#` are comments.',
        ],
        saveLabel: 'Save authors',
      },
    ],
  },
  {
    id: 'experiments',
    title: 'Experiments',
    intro:
      'Features still taking shape: off until you turn them on here, and liable to change. The one running now is the review digest for pull request conversations — a panel pinned at the top of the conversation tab that gathers open findings and bot verdicts and folds bot comments out of the timeline. The Geld GitHub Action writes the digest as one comment; without it the extension builds the same panel from the page.',
    fields: [
      {
        kind: 'toggle',
        key: 'prOverview',
        label: 'Review digest on pull requests',
        description: 'Show a review panel on the conversation tab: open findings, bot verdicts, and (when compacting) a quieter timeline.',
        // The one experiment in the popup, under its own "Experiments" heading, so it can be switched while testing.
        popup: true,
      },
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
        key: 'collapseDescription',
        label: 'Collapse the description',
        description: 'In Minimal mode, show the first paragraph of the pull request body and a control to expand the rest.',
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
          'An OpenAI-compatible base URL: Vercel AI Gateway, OpenRouter, OpenAI, or your own. Paste it with or without the `/v1`; requests add their own path. The key stays on this device (`storage.local`, never the gist).',
        popup: false,
        placeholder: 'https://ai-gateway.vercel.sh',
        autocomplete: 'off',
        surfaces: ['extension'],
        presets: [
          { label: 'Vercel AI Gateway', value: 'https://ai-gateway.vercel.sh' },
          { label: 'OpenRouter', value: 'https://openrouter.ai/api' },
          { label: 'OpenAI', value: 'https://api.openai.com' },
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
        label: 'Use Jev for decisions',
        description:
          'TypeSafe’s Jev answers typed questions with calibrated probabilities instead of prose, in milliseconds and for a fraction of the cost. With it on, Geld asks Jev which findings report the same problem before the AI model rewrites them; off, the AI model decides that itself.',
        popup: false,
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
