import type { GeldSettings } from './settings';

/**
 * Declarative description of every user-facing setting. The extension's popup
 * and options page and the geld.sh account page render from this, so the
 * three surfaces cannot drift. Behaviour that needs browser APIs (permission
 * prompts, keyboard-shortcut hints) is attached by the surface, keyed by `key`.
 *
 * Copy may use `backticks` for inline code; render with {@link splitInlineCode}.
 */

/** Boolean settings, addressable by key. */
export type BooleanSettingKey = {
  [K in keyof GeldSettings]: GeldSettings[K] extends boolean ? K : never;
}[keyof GeldSettings];

/** Line-list settings (one entry per line in the UI). */
export type ListSettingKey = {
  [K in keyof GeldSettings]: GeldSettings[K] extends readonly string[] ? K : never;
}[keyof GeldSettings];

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

/** One switch per {@link import('./categories').HiddenCategory}. */
export interface CategoriesField extends FieldBase {
  readonly kind: 'categories';
}

/** One checkbox per test pattern group, nested under the Tests category. */
export interface TestGroupsField extends FieldBase {
  readonly kind: 'test-groups';
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

export type SettingsField = ToggleField | CategoriesField | TestGroupsField | ListField;

export type SettingsSectionId = 'general' | 'hide' | 'custom-patterns' | 'repositories' | 'enterprise';

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
        key: 'expandedByDefault',
        label: 'Show hidden files expanded',
        description:
          'Hidden files still move to the bottom and are excluded from the counts, but stay visible. Pages where every file is hidden always start expanded.',
        popup: true,
        popupDescription: 'Grouped at the bottom, but not collapsed.',
      },
      {
        kind: 'toggle',
        key: 'showListStats',
        label: 'Line counts in pull request lists',
        description:
          'Adds "N tests +A −D" to each PR on list pages such as /pulls, with the breakdown on hover. Diffs are fetched only for rows you scroll to.',
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
    ],
  },
  {
    id: 'hide',
    title: 'What to hide',
    intro:
      'Each category has its own switch. Expand one to see the built-in patterns it uses. Tests are on by default; everything else is opt-in.',
    fields: [
      {
        kind: 'categories',
        label: 'Hide',
        description: 'Kinds of files to move out of the way.',
        popup: true,
      },
      {
        kind: 'test-groups',
        label: 'Kinds of tests',
        description: 'Fine-grained control over which built-in test patterns apply.',
        popup: false,
      },
    ],
  },
  {
    id: 'custom-patterns',
    title: 'Custom patterns',
    intro:
      'One glob per line, matched against the repository-relative path with gitignore rules: `*.snap` matches a file name anywhere, `fixtures/` a directory anywhere, `src/**/*.gen.ts` a full path, `{a,b}` alternatives, and a leading `!` rescues files that a built-in pattern would hide. Matching files are treated as tests. A line like `[acme/*]` scopes the lines below it to those repositories; `[*]` returns to all repositories.',
    fields: [
      {
        kind: 'list',
        key: 'customPatterns',
        label: 'Custom patterns',
        description: 'Extra globs treated as tests.',
        popup: false,
        rows: 8,
        placeholder: '# everywhere\n*.generated.ts\n!tests/contracts/**\n\n[acme/*]\n# only in Acme repositories\ndocs/adr/',
        syntax: [
          '`*.snap` matches a file name anywhere; `fixtures/` a directory anywhere; `src/**/*.gen.ts` a full path.',
          '`{a,b}` expands alternatives; a leading `!` rescues files a built-in pattern would hide.',
          '`[acme/*]` scopes the lines below it to those repositories; `[*]` returns to all.',
        ],
        saveLabel: 'Save patterns',
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

export function toggleFields(fields: readonly SettingsField[]): readonly ToggleField[] {
  return fields.filter((field): field is ToggleField => field.kind === 'toggle');
}

export function listFields(fields: readonly SettingsField[]): readonly ListField[] {
  return fields.filter((field): field is ListField => field.kind === 'list');
}

export type InlineRun = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'code'; readonly text: string };

/** Split copy on `backticks` so each surface can render inline code its own way. */
export function splitInlineCode(copy: string): readonly InlineRun[] {
  const runs: InlineRun[] = [];
  const parts = copy.split('`');
  parts.forEach((part, index) => {
    if (part === '') return;
    runs.push({ kind: index % 2 === 1 ? 'code' : 'text', text: part });
  });
  return runs;
}
