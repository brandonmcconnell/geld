import type { AnyCategoryId, BooleanSettingKey, CategoryId, ChoiceSettingKey, CustomCategory, GeldSettings, ListSettingKey } from '@geld/core';
import {
  authorRuleProblem,
  compileGlobs,
  fieldsFor,
  isAnyCategoryId,
  isCategoryIconName,
  isCategoryId,
  isCustomCategoryId,
  isGroupKey,
  groupKey,
  normalizeHost,
  parsePatternList,
  validateSettingsValue,
  withCustomCategory,
  withoutCustomCategory,
} from '@geld/core';

/**
 * A single change made on the settings page. Patches are applied on top of a
 * freshly read gist, so two surfaces editing at once cannot clobber each other.
 * Everything arriving from the browser is validated with the guards below.
 */
export type SettingsPatch =
  | { readonly kind: 'toggle'; readonly key: BooleanSettingKey; readonly value: boolean }
  | { readonly kind: 'choice'; readonly key: ChoiceSettingKey; readonly value: GeldSettings[ChoiceSettingKey] }
  | { readonly kind: 'category'; readonly id: AnyCategoryId; readonly value: boolean }
  | { readonly kind: 'group'; readonly categoryId: CategoryId; readonly groupId: string; readonly value: boolean }
  | { readonly kind: 'category-patterns'; readonly categoryId: CategoryId; readonly lines: readonly string[] }
  | { readonly kind: 'custom-category'; readonly category: CustomCategory }
  | { readonly kind: 'remove-custom-category'; readonly id: AnyCategoryId }
  | { readonly kind: 'list'; readonly key: ListSettingKey; readonly lines: readonly string[] }
  /** Whole-document replacement: an imported file or the defaults. Validated strictly, never merged. */
  | { readonly kind: 'replace'; readonly settings: unknown };

const SITE_FIELDS = fieldsFor('site');

/** Boolean keys the site is allowed to edit (schema-driven, so extension-only keys are refused). */
export const SITE_TOGGLE_KEYS: readonly BooleanSettingKey[] = SITE_FIELDS.flatMap((field) => (field.kind === 'toggle' ? [field.key] : []));
export const SITE_LIST_KEYS: readonly ListSettingKey[] = SITE_FIELDS.flatMap((field) => (field.kind === 'list' ? [field.key] : []));
const SITE_CHOICE_FIELDS = SITE_FIELDS.flatMap((field) => (field.kind === 'choice' ? [field] : []));

export const MAX_CATEGORY_TITLE = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSiteToggleKey(value: unknown): value is BooleanSettingKey {
  return typeof value === 'string' && SITE_TOGGLE_KEYS.some((key) => key === value);
}

/** A choice key the site may edit, with a value among the field's options. */
function isSiteChoice(key: unknown, value: unknown): key is ChoiceSettingKey {
  const field = SITE_CHOICE_FIELDS.find((candidate) => candidate.key === key);
  return field !== undefined && field.options.some((option) => option.value === value);
}

function isSiteListKey(value: unknown): value is ListSettingKey {
  return typeof value === 'string' && SITE_LIST_KEYS.some((key) => key === value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

/** Shape check only; content (title length, patterns) is validated in {@link validateCustomCategory}. */
export function isCustomCategory(value: unknown): value is CustomCategory {
  return (
    isRecord(value) &&
    isCustomCategoryId(value.id) &&
    typeof value.title === 'string' &&
    isCategoryIconName(value.icon) &&
    isStringArray(value.patterns) &&
    isOptionalString(value.noun) &&
    isOptionalString(value.nounPlural)
  );
}

export function isSettingsPatch(value: unknown): value is SettingsPatch {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'toggle':
      return isSiteToggleKey(value.key) && typeof value.value === 'boolean';
    case 'choice':
      return isSiteChoice(value.key, value.value);
    case 'category':
      return isAnyCategoryId(value.id) && typeof value.value === 'boolean';
    case 'group':
      return isCategoryId(value.categoryId) && typeof value.groupId === 'string' && isGroupKey(`${value.categoryId}/${value.groupId}`) && typeof value.value === 'boolean';
    case 'category-patterns':
      return isCategoryId(value.categoryId) && isStringArray(value.lines);
    case 'custom-category':
      return isCustomCategory(value.category);
    case 'remove-custom-category':
      return isCustomCategoryId(value.id);
    case 'list':
      return isSiteListKey(value.key) && isStringArray(value.lines);
    case 'replace':
      return isRecord(value.settings);
    default:
      return false;
  }
}

/** Validate each pattern separately so the message can point at the bad line. */
export function validatePatterns(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (/^\[.*\]$/.test(line)) {
      if (/^\[\s*\]$/.test(line)) return `Empty repository scope "${line}"; use "[owner/repo]", "[owner/*]" or "[*]".`;
      continue;
    }
    try {
      compileGlobs([line.startsWith('!') ? line.slice(1) : line]);
    } catch (error) {
      return `Invalid pattern "${line}": ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return null;
}

export type ListValidation = { readonly ok: true; readonly lines: readonly string[] } | { readonly ok: false; readonly message: string };

/** Normalise and validate a pattern list (extra patterns, custom category patterns). */
export function validatePatternLines(rawLines: readonly string[]): ListValidation {
  const lines = parsePatternList(rawLines.join('\n'));
  const problem = validatePatterns(lines);
  return problem === null ? { ok: true, lines } : { ok: false, message: problem };
}

/** Normalise and validate a list field's lines the way the extension's options page does. */
export function validateList(key: ListSettingKey, rawLines: readonly string[]): ListValidation {
  const lines = parsePatternList(rawLines.join('\n'));
  switch (key) {
    case 'repoRules': {
      const problem = validatePatterns(lines.map((rule) => rule.replace(/^!/, '')));
      return problem === null ? { ok: true, lines } : { ok: false, message: problem };
    }
    case 'enterpriseHosts': {
      const hosts: string[] = [];
      for (const line of lines) {
        const host = normalizeHost(line);
        if (host === null) return { ok: false, message: `"${line}" is not a hostname Geld can use.` };
        if (!hosts.includes(host)) hosts.push(host);
      }
      return { ok: true, lines: hosts };
    }
    case 'hiddenAuthors': {
      const problem = lines.map(authorRuleProblem).find((entry): entry is string => entry !== null) ?? null;
      return problem === null ? { ok: true, lines } : { ok: false, message: problem };
    }
  }
}

export type CustomCategoryValidation = { readonly ok: true; readonly category: CustomCategory } | { readonly ok: false; readonly message: string };

/** Trim and check a custom category before it is saved; drops empty optional nouns. */
export function validateCustomCategory(input: CustomCategory): CustomCategoryValidation {
  const title = input.title.trim();
  if (title === '') return { ok: false, message: 'Give the category a name.' };
  if (title.length > MAX_CATEGORY_TITLE) return { ok: false, message: `Names are at most ${MAX_CATEGORY_TITLE} characters.` };
  const patterns = validatePatternLines(input.patterns);
  if (!patterns.ok) return patterns;
  const noun = input.noun?.trim() ?? '';
  const nounPlural = input.nounPlural?.trim() ?? '';
  return {
    ok: true,
    category: {
      id: input.id,
      title,
      icon: input.icon,
      patterns: patterns.lines,
      ...(noun !== '' ? { noun } : {}),
      ...(nounPlural !== '' ? { nounPlural } : {}),
    },
  };
}

export type PatchResult = { readonly ok: true; readonly settings: GeldSettings } | { readonly ok: false; readonly message: string };

/** Apply a validated patch to `base`, returning the new settings or a validation message. */
export function applyPatch(base: GeldSettings, patch: SettingsPatch): PatchResult {
  switch (patch.kind) {
    case 'toggle':
      return { ok: true, settings: { ...base, [patch.key]: patch.value } };
    case 'choice':
      return { ok: true, settings: { ...base, [patch.key]: patch.value } };
    case 'category':
      return { ok: true, settings: { ...base, categories: { ...base.categories, [patch.id]: patch.value } } };
    case 'group':
      return { ok: true, settings: { ...base, groups: { ...base.groups, [groupKey(patch.categoryId, patch.groupId)]: patch.value } } };
    case 'category-patterns': {
      const validated = validatePatternLines(patch.lines);
      if (!validated.ok) return { ok: false, message: validated.message };
      const categoryPatterns = { ...base.categoryPatterns };
      if (validated.lines.length === 0) delete categoryPatterns[patch.categoryId];
      else categoryPatterns[patch.categoryId] = validated.lines;
      return { ok: true, settings: { ...base, categoryPatterns } };
    }
    case 'custom-category': {
      const validated = validateCustomCategory(patch.category);
      if (!validated.ok) return { ok: false, message: validated.message };
      return { ok: true, settings: withCustomCategory(base, validated.category) };
    }
    case 'remove-custom-category':
      return { ok: true, settings: withoutCustomCategory(base, patch.id) };
    case 'list': {
      const validated = validateList(patch.key, patch.lines);
      if (!validated.ok) return { ok: false, message: validated.message };
      return { ok: true, settings: { ...base, [patch.key]: validated.lines } };
    }
    case 'replace': {
      const validated = validateSettingsValue(patch.settings);
      if (validated.ok) return { ok: true, settings: validated.settings };
      const shown = validated.issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`);
      const more = validated.issues.length - shown.length;
      return { ok: false, message: `That file has problems. ${shown.join(' ')}${more > 0 ? ` (+${more} more)` : ''}` };
    }
  }
}
