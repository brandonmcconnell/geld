import type { BooleanSettingKey, CategoryId, GeldSettings, ListSettingKey, TestPatternGroupId } from '@geld/core';
import { compileGlobs, fieldsFor, isCategoryId, isTestPatternGroupId, normalizeHost, parsePatternList } from '@geld/core';

/**
 * A single change made on the settings page. Patches are applied on top of a
 * freshly read gist, so two surfaces editing at once cannot clobber each other.
 * Everything arriving from the browser is validated with the guards below.
 */
export type SettingsPatch =
  | { readonly kind: 'toggle'; readonly key: BooleanSettingKey; readonly value: boolean }
  | { readonly kind: 'category'; readonly id: CategoryId; readonly value: boolean }
  | { readonly kind: 'test-group'; readonly id: TestPatternGroupId; readonly value: boolean }
  | { readonly kind: 'list'; readonly key: ListSettingKey; readonly lines: readonly string[] };

const SITE_FIELDS = fieldsFor('site');

/** Boolean keys the site is allowed to edit (schema-driven, so extension-only keys are refused). */
export const SITE_TOGGLE_KEYS: readonly BooleanSettingKey[] = SITE_FIELDS.flatMap((field) => (field.kind === 'toggle' ? [field.key] : []));
export const SITE_LIST_KEYS: readonly ListSettingKey[] = SITE_FIELDS.flatMap((field) => (field.kind === 'list' ? [field.key] : []));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSiteToggleKey(value: unknown): value is BooleanSettingKey {
  return typeof value === 'string' && SITE_TOGGLE_KEYS.some((key) => key === value);
}

function isSiteListKey(value: unknown): value is ListSettingKey {
  return typeof value === 'string' && SITE_LIST_KEYS.some((key) => key === value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function isSettingsPatch(value: unknown): value is SettingsPatch {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'toggle':
      return isSiteToggleKey(value.key) && typeof value.value === 'boolean';
    case 'category':
      return isCategoryId(value.id) && typeof value.value === 'boolean';
    case 'test-group':
      return isTestPatternGroupId(value.id) && typeof value.value === 'boolean';
    case 'list':
      return isSiteListKey(value.key) && isStringArray(value.lines);
    default:
      return false;
  }
}

/** Validate each pattern separately so the message can point at the bad line. */
export function validatePatterns(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (/^\[.*\]$/.test(line)) continue;
    try {
      compileGlobs([line]);
    } catch (error) {
      return `Invalid pattern "${line}": ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return null;
}

export type ListValidation = { readonly ok: true; readonly lines: readonly string[] } | { readonly ok: false; readonly message: string };

/** Normalise and validate a list field's lines the way the extension's options page does. */
export function validateList(key: ListSettingKey, rawLines: readonly string[]): ListValidation {
  const lines = parsePatternList(rawLines.join('\n'));
  switch (key) {
    case 'customPatterns': {
      const problem = validatePatterns(lines);
      return problem === null ? { ok: true, lines } : { ok: false, message: problem };
    }
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
  }
}

export type PatchResult = { readonly ok: true; readonly settings: GeldSettings } | { readonly ok: false; readonly message: string };

/** Apply a validated patch to `base`, returning the new settings or a validation message. */
export function applyPatch(base: GeldSettings, patch: SettingsPatch): PatchResult {
  switch (patch.kind) {
    case 'toggle':
      return { ok: true, settings: { ...base, [patch.key]: patch.value } };
    case 'category':
      return { ok: true, settings: { ...base, categories: { ...base.categories, [patch.id]: patch.value } } };
    case 'test-group':
      return { ok: true, settings: { ...base, testGroups: { ...base.testGroups, [patch.id]: patch.value } } };
    case 'list': {
      const validated = validateList(patch.key, patch.lines);
      if (!validated.ok) return { ok: false, message: validated.message };
      return { ok: true, settings: { ...base, [patch.key]: validated.lines } };
    }
  }
}
