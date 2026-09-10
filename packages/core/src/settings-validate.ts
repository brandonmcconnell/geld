import type { Catalog } from './categories';
import { BUNDLED_CATALOG, CATEGORY_IDS, catalogGroupKeys, isCategoryId, isCustomCategoryId, isGroupKey, isWellFormedGroupKey, isWellFormedId } from './categories';
import { CATEGORY_ICON_NAMES, isCategoryIconName } from './category-icons';
import { globToRegExp } from './glob';
import type { GeldSettings } from './settings';
import { REPO_CONFIG_MODES, isRepoConfigMode, normalizeHost, normalizeSettings } from './settings';
import { authorRuleProblem } from './pr-authors';
import { TEST_PATTERN_GROUP_IDS, isTestPatternGroupId } from './test-patterns';

/**
 * Strict validation of a settings document, used for anything a person may
 * have edited by hand (the gist, an imported file). Unlike `normalizeSettings`,
 * which silently repairs whatever it can, this collects **every** problem with
 * a path so the UI can list them and send the user to the exact spot.
 *
 * Unknown keys are deliberately not reported: a newer Geld may add settings
 * that an older extension does not know about, and that must not look like
 * corruption. Everything Geld does know about is checked in full.
 *
 * The same reasoning applies to category and group ids. They are checked
 * against `catalog` — the extension passes its active catalog (bundled or the
 * newer fetched one) — but an id that is merely unknown, while well formed
 * (`[a-z][a-z0-9-]*`, `category/group`), is tolerated and ignored rather than
 * reported: the gist is shared between devices, the site and versions of Geld
 * that may know a newer catalog or a newer category, and a slightly older
 * extension must never declare it corrupted for that. The trade-off is that a
 * typo in an id (`test` for `tests`) is no longer caught here; the value's
 * type still is, and the UI never writes ids by hand.
 */

export interface SettingsIssue {
  /** Dot path inside the document, e.g. `settings.categories.tests` or `settings.customPatterns[3]`. `$` is the whole file. */
  readonly path: string;
  readonly message: string;
}

/**
 * Copy every surface shows when the gist fails validation. The wording is the
 * same whether or not individual problems could be pinpointed; the issue list
 * (when there is one) goes underneath.
 */
export const CORRUPTED_SETTINGS_COPY = {
  title: 'Error',
  body: 'Your settings appear to have been corrupted on GitHub Gist. Please correct these errors or reset to default settings to continue.',
  openGist: 'Open gist',
  reset: 'Reset to default settings',
  recheck: 'Check again',
} as const;

export type SettingsValidation =
  | { readonly ok: true; readonly settings: GeldSettings }
  | { readonly ok: false; readonly issues: readonly SettingsIssue[] };

const BOOLEAN_KEYS = ['enabled', 'groupHidden', 'expandedByDefault', 'hideCommentLines', 'expandLargeDiffs', 'showListStats', 'hideWhitespace', 'shortcutEnabled', 'showBadge', 'autoUpdatePatterns'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Human description of a wrong value, short enough for a bullet list. */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}…` : value);
  return String(value);
}

function list(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}

/**
 * `isAcceptable` decides which keys are not worth an issue: the ids the
 * catalog knows plus any well-formed id (see the module comment); `known`
 * only feeds the message for the rest.
 */
export function checkBooleanMap(
  issues: SettingsIssue[],
  path: string,
  value: unknown,
  known: readonly string[],
  isAcceptable: (key: string) => boolean,
  noun: string,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path, message: `Expected an object mapping ${noun} ids to true/false, got ${describeValue(value)}.` });
    return;
  }
  for (const [key, enabled] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (!isAcceptable(key)) issues.push({ path: keyPath, message: `Unknown ${noun} "${key}". Known: ${list(known)}.` });
    if (typeof enabled !== 'boolean') issues.push({ path: keyPath, message: `Expected true or false, got ${describeValue(enabled)}.` });
  }
}

export function checkStringList(
  issues: SettingsIssue[],
  path: string,
  value: unknown,
  checkEntry: (entry: string) => string | null,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path, message: `Expected a list of strings, got ${describeValue(value)}.` });
    return;
  }
  value.forEach((entry: unknown, index) => {
    const entryPath = `${path}[${index}]`;
    if (typeof entry !== 'string') {
      issues.push({ path: entryPath, message: `Expected a string, got ${describeValue(entry)}.` });
      return;
    }
    const problem = checkEntry(entry);
    if (problem !== null) issues.push({ path: entryPath, message: problem });
  });
}

function globProblem(pattern: string): string | null {
  try {
    globToRegExp(pattern);
    return null;
  } catch (error) {
    // "Invalid regular expression: /…/: Range out of order in character class" → keep only the reason.
    const raw = error instanceof Error ? error.message : String(error);
    const reason = raw.slice(raw.lastIndexOf(': ') + 2).replace(/\.$/, '');
    return `"${pattern}" is not a valid pattern: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`;
  }
}

function customPatternProblem(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  if (/^\[.*\]$/.test(trimmed)) {
    const scope = trimmed.slice(1, -1).trim();
    return scope === '' ? 'Empty repository scope "[]"; use "[owner/repo]", "[owner/*]" or "[*]".' : globProblem(scope);
  }
  return globProblem(trimmed.startsWith('!') ? trimmed.slice(1) : trimmed);
}

function repoRuleProblem(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  const body = trimmed.startsWith('!') ? trimmed.slice(1) : trimmed;
  if (body.trim() === '') return 'A rule needs a repository or owner after "!".';
  return globProblem(body);
}

function hostProblem(line: string): string | null {
  return normalizeHost(line) === null ? `"${line}" is not a hostname Geld can run on (e.g. "github.example.com").` : null;
}

/** `settings.categoryPatterns`: an object of built-in category id → pattern lines. */
export function checkCategoryPatterns(issues: SettingsIssue[], path: string, value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push({ path, message: `Expected an object mapping category ids to pattern lists, got ${describeValue(value)}.` });
    return;
  }
  for (const [key, lines] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (!isCategoryId(key) && !isWellFormedId(key)) {
      issues.push({ path: keyPath, message: `Unknown built-in category "${key}". Known: ${list(CATEGORY_IDS)}.` });
      continue;
    }
    // Lines under a category this build does not know are still checked: they are patterns wherever they apply.
    checkStringList(issues, keyPath, lines, customPatternProblem);
  }
}

/** `settings.customCategories`: a list of `{ id, title, icon, patterns }`. */
export function checkCustomCategories(issues: SettingsIssue[], path: string, value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push({ path, message: `Expected a list of categories, got ${describeValue(value)}.` });
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry: unknown, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path: entryPath, message: `Expected a category object, got ${describeValue(entry)}.` });
      return;
    }
    if (!isCustomCategoryId(entry.id)) {
      issues.push({ path: `${entryPath}.id`, message: `Expected an id like "custom:design-tokens", got ${describeValue(entry.id)}.` });
    } else if (seen.has(entry.id)) {
      issues.push({ path: `${entryPath}.id`, message: `Duplicate category id "${entry.id}".` });
    } else {
      seen.add(entry.id);
    }
    if (typeof entry.title !== 'string' || entry.title.trim() === '') {
      issues.push({ path: `${entryPath}.title`, message: `Expected a name, got ${describeValue(entry.title)}.` });
    } else if (entry.title.trim().length > 40) {
      issues.push({ path: `${entryPath}.title`, message: `Names are at most 40 characters; got ${entry.title.trim().length}.` });
    }
    if (entry.icon !== undefined && !isCategoryIconName(entry.icon)) {
      issues.push({ path: `${entryPath}.icon`, message: `Unknown icon ${describeValue(entry.icon)}. Known: ${list(CATEGORY_ICON_NAMES)}.` });
    }
    checkStringList(issues, `${entryPath}.patterns`, entry.patterns, customPatternProblem);
    for (const key of ['noun', 'nounPlural'] as const) {
      if (entry[key] !== undefined && typeof entry[key] !== 'string') {
        issues.push({ path: `${entryPath}.${key}`, message: `Expected a string, got ${describeValue(entry[key])}.` });
      }
    }
  });
}

/**
 * Validate a parsed settings object (the value of `settings` in the gist, or a
 * bare settings object). Returns every problem found; an empty list means the
 * object is safe to normalise.
 */
export function collectSettingsIssues(value: unknown, path = 'settings', catalog: Catalog = BUNDLED_CATALOG): readonly SettingsIssue[] {
  const issues: SettingsIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path, message: `Expected an object of settings, got ${describeValue(value)}.` });
    return issues;
  }
  for (const key of BOOLEAN_KEYS) {
    const entry = value[key];
    if (entry !== undefined && typeof entry !== 'boolean') {
      issues.push({ path: `${path}.${key}`, message: `Expected true or false, got ${describeValue(entry)}.` });
    }
  }
  if (value.hideTests !== undefined && typeof value.hideTests !== 'boolean') {
    issues.push({ path: `${path}.hideTests`, message: `Expected true or false, got ${describeValue(value.hideTests)}.` });
  }
  if (value.repoConfigs !== undefined && !isRepoConfigMode(value.repoConfigs)) {
    issues.push({ path: `${path}.repoConfigs`, message: `Expected one of ${list(REPO_CONFIG_MODES)}, got ${describeValue(value.repoConfigs)}.` });
  }
  // Custom ids are accepted here regardless of whether the category still exists: a stale flag is harmless.
  checkBooleanMap(issues, `${path}.categories`, value.categories, CATEGORY_IDS, (key) => isCategoryId(key) || isCustomCategoryId(key) || isWellFormedId(key), 'category');
  checkBooleanMap(issues, `${path}.groups`, value.groups, catalogGroupKeys(catalog), (key) => isGroupKey(key, catalog) || isWellFormedGroupKey(key), 'pattern group');
  checkCategoryPatterns(issues, `${path}.categoryPatterns`, value.categoryPatterns);
  checkCustomCategories(issues, `${path}.customCategories`, value.customCategories);
  // Keys from earlier versions, still accepted and migrated by normalizeSettings.
  checkBooleanMap(issues, `${path}.testGroups`, value.testGroups, TEST_PATTERN_GROUP_IDS, isTestPatternGroupId, 'test group');
  checkStringList(issues, `${path}.customPatterns`, value.customPatterns, customPatternProblem);
  checkStringList(issues, `${path}.repoRules`, value.repoRules, repoRuleProblem);
  checkStringList(issues, `${path}.hiddenAuthors`, value.hiddenAuthors, authorRuleProblem);
  checkStringList(issues, `${path}.enterpriseHosts`, value.enterpriseHosts, hostProblem);
  return issues;
}

/**
 * Locate the first syntax error in JSON text. Engines disagree about whether
 * their error message carries a position (V8 omits it for "unexpected token"),
 * so a small scanner finds it deterministically. Returns the offset and what
 * was expected there.
 */
export function findJsonError(text: string): { readonly offset: number; readonly expected: string } | null {
  let index = 0;
  let failure: { offset: number; expected: string } | null = null;

  const fail = (expected: string): false => {
    if (failure === null) failure = { offset: index, expected };
    return false;
  };
  const skipSpace = (): void => {
    while (index < text.length && /[ \t\r\n]/.test(text.charAt(index))) index += 1;
  };
  const literal = (word: string): boolean => {
    if (text.startsWith(word, index)) {
      index += word.length;
      return true;
    }
    return fail(`a value`);
  };
  const string = (): boolean => {
    if (text.charAt(index) !== '"') return fail('a string in double quotes');
    index += 1;
    while (index < text.length) {
      const char = text.charAt(index);
      if (char === '"') {
        index += 1;
        return true;
      }
      if (char === '\\') {
        index += 1;
        const escape = text.charAt(index);
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index + 1, index + 5))) return fail('four hex digits after \\u');
          index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escape) || escape === '') return fail('a valid escape sequence');
        index += 1;
        continue;
      }
      if (char < ' ') return fail('the string to be closed (control characters must be escaped)');
      index += 1;
    }
    return fail('the closing quote of a string');
  };
  const number = (): boolean => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(index));
    if (match === null) return fail('a value');
    index += match[0].length;
    return true;
  };
  const value = (): boolean => {
    skipSpace();
    const char = text.charAt(index);
    if (char === '{') return object();
    if (char === '[') return array();
    if (char === '"') return string();
    if (char === 't') return literal('true');
    if (char === 'f') return literal('false');
    if (char === 'n') return literal('null');
    if (char === '-' || /\d/.test(char)) return number();
    return fail(index >= text.length ? 'a value before the end of the file' : 'a value');
  };
  const object = (): boolean => {
    index += 1;
    skipSpace();
    if (text.charAt(index) === '}') {
      index += 1;
      return true;
    }
    for (;;) {
      skipSpace();
      if (!string()) return failure === null ? fail('a property name in double quotes') : false;
      skipSpace();
      if (text.charAt(index) !== ':') return fail('":" after the property name');
      index += 1;
      if (!value()) return false;
      skipSpace();
      const next = text.charAt(index);
      if (next === ',') {
        index += 1;
        skipSpace();
        if (text.charAt(index) === '}') return fail('another property after the comma (trailing commas are not allowed)');
        continue;
      }
      if (next === '}') {
        index += 1;
        return true;
      }
      return fail('"," or "}" after the value');
    }
  };
  const array = (): boolean => {
    index += 1;
    skipSpace();
    if (text.charAt(index) === ']') {
      index += 1;
      return true;
    }
    for (;;) {
      if (!value()) return false;
      skipSpace();
      const next = text.charAt(index);
      if (next === ',') {
        index += 1;
        skipSpace();
        if (text.charAt(index) === ']') return fail('another item after the comma (trailing commas are not allowed)');
        continue;
      }
      if (next === ']') {
        index += 1;
        return true;
      }
      return fail('"," or "]" after the item');
    }
  };

  if (!value()) return failure;
  skipSpace();
  if (index < text.length) return { offset: index, expected: 'the end of the file after the top-level value' };
  return null;
}

/** Turn a `JSON.parse` failure into one issue that points at a line and column. */
function jsonIssue(content: string, error: unknown): SettingsIssue {
  const located = findJsonError(content);
  if (located === null) {
    const raw = error instanceof Error ? error.message : String(error);
    return { path: '$', message: `The file is not valid JSON: ${raw}.` };
  }
  const before = content.slice(0, located.offset);
  const line = before.split('\n').length;
  const column = located.offset - before.lastIndexOf('\n');
  return { path: '$', message: `The file is not valid JSON: expected ${located.expected} at line ${line}, column ${column}.` };
}

/**
 * Validate the text of a settings document. Accepts the `{ geld, savedAt,
 * settings }` payload Geld writes or a bare settings object. Ids are checked
 * against `catalog` (see the module comment).
 */
export function validateSettingsDocument(content: string, catalog: Catalog = BUNDLED_CATALOG): SettingsValidation {
  if (content.trim() === '') return { ok: false, issues: [{ path: '$', message: 'The file is empty.' }] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { ok: false, issues: [jsonIssue(content, error)] };
  }
  if (!isRecord(parsed)) {
    return { ok: false, issues: [{ path: '$', message: `Expected a JSON object at the top level, got ${describeValue(parsed)}.` }] };
  }
  const issues: SettingsIssue[] = [];
  const wrapped = 'settings' in parsed;
  if (wrapped && parsed.geld !== undefined && parsed.geld !== 1) {
    issues.push({ path: 'geld', message: `Expected the format version 1, got ${describeValue(parsed.geld)}.` });
  }
  if (wrapped && parsed.savedAt !== undefined && (typeof parsed.savedAt !== 'string' || Number.isNaN(Date.parse(parsed.savedAt)))) {
    issues.push({ path: 'savedAt', message: `Expected an ISO date string, got ${describeValue(parsed.savedAt)}.` });
  }
  const body = wrapped ? parsed.settings : parsed;
  issues.push(...collectSettingsIssues(body, wrapped ? 'settings' : '$', catalog));
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, settings: normalizeSettings(body) };
}

/** Validate an in-memory value the same way (used for imports that were already parsed). */
export function validateSettingsValue(value: unknown, catalog: Catalog = BUNDLED_CATALOG): SettingsValidation {
  const wrapped = isRecord(value) && 'settings' in value;
  const body = wrapped ? value.settings : value;
  const issues = collectSettingsIssues(body, wrapped ? 'settings' : '$', catalog);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, settings: normalizeSettings(body) };
}
