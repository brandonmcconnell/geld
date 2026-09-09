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

export type SettingsField = ToggleField | CategoriesField | CustomCategoriesField | ListField | ActionsField;

export type SettingsSectionId = 'general' | 'hide' | 'custom-categories' | 'repositories' | 'enterprise' | 'maintenance';

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
            description: 'Forget the parsed diffs stored on this device; they are fetched again as needed.',
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
