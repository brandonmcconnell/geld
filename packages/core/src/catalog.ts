import type { BuiltInCategory, Catalog, CategoryShape, PatternGroup } from './categories';
import { isWellFormedId } from './categories';
import { isCategoryIconName } from './category-icons';
import { globToRegExp } from './glob';

/**
 * The updatable pattern catalog. `catalog/patterns.json` in the repository is
 * generated from the bundled catalog (`pnpm catalog:build`), signed with the
 * owner's Ed25519 key (`pnpm catalog:sign`) and fetched by the extension so
 * patterns can change without a store release. Everything here is pure so it
 * can be unit tested; the fetching and caching live in the extension.
 *
 * Trust model: a fetched file may change *what a category contains and how it
 * is described* (groups, globs, labels, descriptions, icon, nouns). It can
 * never change what is on by default, add a category, or introduce code — the
 * rest of Geld takes those from the bundled catalog (see {@link resolveCatalog}).
 */

/** Bumped only for incompatible changes to the JSON shape; older extensions ignore other formats. */
export const CATALOG_FORMAT = 1;

/** A category as it appears in the JSON: any well-formed id, not necessarily one this build knows. */
export interface CatalogEntry extends CategoryShape {
  readonly id: string;
}

/** A parsed `patterns.json`, before it is reconciled with the bundled catalog. */
export interface CatalogDocument {
  readonly version: number;
  readonly minExtensionVersion: string;
  readonly categories: readonly CatalogEntry[];
}

export type CatalogParse = { readonly ok: true; readonly document: CatalogDocument } | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 37)}…` : value);
  return String(value);
}

class CatalogError extends Error {}

function requireString(record: Record<string, unknown>, key: string, path: string, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== 'string') throw new CatalogError(`${path}.${key}: expected a string, got ${describe(value)}`);
  if (!allowEmpty && value.trim() === '') throw new CatalogError(`${path}.${key}: must not be empty`);
  return value;
}

function requireId(record: Record<string, unknown>, path: string): string {
  const value = record.id;
  if (!isWellFormedId(value)) throw new CatalogError(`${path}.id: expected an id like "lockfiles", got ${describe(value)}`);
  return value;
}

function parsePattern(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new CatalogError(`${path}: expected a pattern, got ${describe(value)}`);
  const pattern = value.trim();
  if (pattern === '' || pattern !== value) throw new CatalogError(`${path}: pattern ${describe(value)} has surrounding whitespace or is empty`);
  if (pattern.startsWith('#')) throw new CatalogError(`${path}: pattern ${describe(value)} looks like a comment`);
  try {
    globToRegExp(pattern.startsWith('!') ? pattern.slice(1) : pattern);
  } catch (error) {
    throw new CatalogError(`${path}: pattern ${describe(value)} does not compile (${error instanceof Error ? error.message : String(error)})`);
  }
  return pattern;
}

function parseGroup(value: unknown, path: string): PatternGroup {
  if (!isRecord(value)) throw new CatalogError(`${path}: expected a group object, got ${describe(value)}`);
  const id = requireId(value, path);
  const label = requireString(value, 'label', path);
  const description = requireString(value, 'description', path, true);
  if (!Array.isArray(value.patterns)) throw new CatalogError(`${path}.patterns: expected a list, got ${describe(value.patterns)}`);
  const patterns = value.patterns.map((pattern: unknown, index) => parsePattern(pattern, `${path}.patterns[${index}]`));
  return { id, label, description, patterns };
}

function parseEntry(value: unknown, path: string): CatalogEntry {
  if (!isRecord(value)) throw new CatalogError(`${path}: expected a category object, got ${describe(value)}`);
  const id = requireId(value, path);
  const icon = value.icon;
  if (!isCategoryIconName(icon)) throw new CatalogError(`${path}.icon: unknown icon ${describe(icon)}`);
  if (typeof value.defaultEnabled !== 'boolean') throw new CatalogError(`${path}.defaultEnabled: expected true or false, got ${describe(value.defaultEnabled)}`);
  if (!Array.isArray(value.groups)) throw new CatalogError(`${path}.groups: expected a list, got ${describe(value.groups)}`);
  const groups = value.groups.map((group: unknown, index) => parseGroup(group, `${path}.groups[${index}]`));
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.id)) throw new CatalogError(`${path}.groups: duplicate group id "${group.id}"`);
    seen.add(group.id);
  }
  return {
    id,
    title: requireString(value, 'title', path),
    description: requireString(value, 'description', path, true),
    icon,
    noun: requireString(value, 'noun', path),
    nounPlural: requireString(value, 'nounPlural', path),
    shortNoun: requireString(value, 'shortNoun', path),
    shortNounPlural: requireString(value, 'shortNounPlural', path),
    defaultEnabled: value.defaultEnabled,
    groups,
  };
}

const EXTENSION_VERSION = /^\d+\.\d+\.\d+(\.\d+)?$/;

/**
 * Check the shape of a parsed `patterns.json` in full. Unknown keys are
 * ignored (a later format may add some), but everything known must be right:
 * a wrong type, an ill-formed id, a duplicate, an unknown icon or a glob that
 * does not compile rejects the whole document — the extension then keeps
 * what it has.
 */
export function parseCatalog(value: unknown): CatalogParse {
  try {
    if (!isRecord(value)) throw new CatalogError(`expected a catalog object, got ${describe(value)}`);
    if (value.geldCatalog !== CATALOG_FORMAT) throw new CatalogError(`geldCatalog: expected format ${CATALOG_FORMAT}, got ${describe(value.geldCatalog)}`);
    const version = value.version;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version <= 0) {
      throw new CatalogError(`version: expected a positive integer, got ${describe(version)}`);
    }
    const minExtensionVersion = requireString(value, 'minExtensionVersion', 'catalog');
    if (!EXTENSION_VERSION.test(minExtensionVersion)) throw new CatalogError(`minExtensionVersion: expected "x.y.z", got ${describe(minExtensionVersion)}`);
    if (!Array.isArray(value.categories)) throw new CatalogError(`categories: expected a list, got ${describe(value.categories)}`);
    const categories = value.categories.map((entry: unknown, index) => parseEntry(entry, `categories[${index}]`));
    const seen = new Set<string>();
    for (const category of categories) {
      if (seen.has(category.id)) throw new CatalogError(`categories: duplicate category id "${category.id}"`);
      seen.add(category.id);
    }
    return { ok: true, document: { version, minExtensionVersion, categories } };
  } catch (error) {
    if (error instanceof CatalogError) return { ok: false, reason: error.message };
    throw error;
  }
}

/** Parse JSON text and validate it as a catalog. */
export function parseCatalogText(text: string): CatalogParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  return parseCatalog(value);
}

/**
 * Compare two extension versions on their first three numeric parts only, so
 * `0.1.1` equals `0.1.1.4` (store builds may carry a fourth number). Negative
 * when `a` is older, positive when newer.
 */
export function compareExtensionVersions(a: string, b: string): number {
  const parts = (version: string): number[] => version.split('.').slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export interface AcceptanceContext {
  /** The running extension's manifest version. */
  readonly extensionVersion: string;
  /** Version of the catalog in use (bundled or cached); the document must be newer. */
  readonly currentVersion: number;
}

/**
 * Why a well-formed document should still not be adopted, or `null` when it
 * should. `not-newer` is not an error worth showing: it just means the
 * repository has nothing this build does not already have.
 */
export function catalogRejection(document: CatalogDocument, context: AcceptanceContext): { readonly kind: 'not-newer' | 'too-new'; readonly reason: string } | null {
  if (compareExtensionVersions(document.minExtensionVersion, context.extensionVersion) > 0) {
    return { kind: 'too-new', reason: `catalog ${formatCatalogVersion(document.version)} needs Geld ${document.minExtensionVersion} or newer (this is ${context.extensionVersion})` };
  }
  if (document.version <= context.currentVersion) {
    return { kind: 'not-newer', reason: `catalog ${formatCatalogVersion(document.version)} is not newer than ${formatCatalogVersion(context.currentVersion)}` };
  }
  return null;
}

/**
 * The categories the extension should use given the bundled catalog and a
 * fetched document (or none). The fetched side wins on content — groups,
 * globs, titles, descriptions, icon, nouns — and the bundled side on policy:
 * `defaultEnabled` and the set of categories, both of which need code to
 * change. Groups are the union so a bundled group the document forgot keeps
 * working (deprecation is an empty pattern list, never removal — settings
 * refer to group ids), and groups the document adds start enabled like every
 * built-in group. A document that is not newer than the bundled catalog is
 * ignored outright: after an extension update the build knows at least as
 * much as the cache.
 */
export function resolveCatalog(bundled: Catalog, fetched: CatalogDocument | null): Catalog {
  if (fetched === null || fetched.version <= bundled.version) return bundled;
  const categories: BuiltInCategory[] = bundled.categories.map((base) => {
    const entry = fetched.categories.find((candidate) => candidate.id === base.id);
    if (entry === undefined) return base;
    const groups: PatternGroup[] = [...entry.groups, ...base.groups.filter((group) => !entry.groups.some((candidate) => candidate.id === group.id))];
    return {
      id: base.id,
      title: entry.title,
      description: entry.description,
      icon: entry.icon,
      noun: entry.noun,
      nounPlural: entry.nounPlural,
      shortNoun: entry.shortNoun,
      shortNounPlural: entry.shortNounPlural,
      defaultEnabled: base.defaultEnabled,
      groups,
    };
  });
  return { version: fetched.version, minExtensionVersion: fetched.minExtensionVersion, categories };
}

/** `20260908` → `2026.09.08`; anything that is not a plausible date stays a plain number. */
export function formatCatalogVersion(version: number): string {
  const text = String(version);
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match !== null) {
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${match[1]}.${match[2]}.${match[3]}`;
  }
  return text;
}

/**
 * The exact JSON written to `catalog/patterns.json`: stable key order and
 * two-space indentation, so the drift check can compare bytes. `defaultEnabled`
 * is included for readers of the file; the extension ignores it in favour of
 * the bundled value.
 */
export function serializeCatalog(catalog: Catalog): string {
  const document = {
    geldCatalog: CATALOG_FORMAT,
    version: catalog.version,
    minExtensionVersion: catalog.minExtensionVersion,
    categories: catalog.categories.map((category) => ({
      id: category.id,
      title: category.title,
      description: category.description,
      icon: category.icon,
      noun: category.noun,
      nounPlural: category.nounPlural,
      shortNoun: category.shortNoun,
      shortNounPlural: category.shortNounPlural,
      defaultEnabled: category.defaultEnabled,
      groups: category.groups.map((group) => ({ id: group.id, label: group.label, description: group.description, patterns: [...group.patterns] })),
    })),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

function bytesFromBase64(text: string): Uint8Array | null {
  const clean = text.trim();
  if (clean === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) return null;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Copy into a fresh ArrayBuffer so WebCrypto never sees a view onto a shared buffer. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * Verify an Ed25519 signature (base64, as in `catalog/patterns.sig`) over the
 * exact bytes of `patterns.json` with a raw base64 public key. Uses WebCrypto,
 * which every supported browser and Node ≥ 20 provide. Any malformed input
 * verifies as `false`; nothing here throws.
 */
export async function verifyCatalogSignature(payload: Uint8Array, signatureBase64: string, publicKeyBase64: string): Promise<boolean> {
  const signature = bytesFromBase64(signatureBase64);
  const publicKey = bytesFromBase64(publicKeyBase64);
  if (signature === null || publicKey === null || signature.byteLength !== 64 || publicKey.byteLength !== 32) return false;
  try {
    const key = await crypto.subtle.importKey('raw', toArrayBuffer(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, toArrayBuffer(signature), toArrayBuffer(payload));
  } catch {
    return false;
  }
}
