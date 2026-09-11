/**
 * Generate `catalog/patterns.json` from the bundled catalog in `@geld/core`
 * (`pnpm catalog:build`), or with `--check` verify that the committed file and
 * its signature are current (`pnpm catalog:check`, run in CI).
 *
 * The TypeScript in `packages/core/src/categories.ts` and `test-patterns.ts`
 * is the only place patterns are authored; this file is derived from it so the
 * extension's bundled fallback, the fetched file and the site's Patterns page
 * cannot disagree. The build refuses two mistakes that would break installed
 * extensions or their settings:
 *
 * - an id present in the previous committed catalog that is missing now
 *   (settings and gists refer to `category` and `category/group` ids forever;
 *   deprecate a group by emptying its patterns);
 * - a content change without a higher `CATALOG_VERSION` (extensions only adopt
 *   a fetched catalog whose version is higher than the one they have).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUNDLED_CATALOG, CATALOG_PUBLIC_KEY, compareExtensionVersions, parseCatalog, parseCatalogText, serializeCatalog, verifyCatalogSignature } from '@geld/core';
import type { CatalogDocument } from '@geld/core';

const root = new URL('../', import.meta.url);
const jsonPath = fileURLToPath(new URL('catalog/patterns.json', root));
const sigPath = fileURLToPath(new URL('catalog/patterns.sig', root));
const check = process.argv.includes('--check');
/**
 * `--auto-version`: when the patterns changed but CATALOG_VERSION was not
 * bumped, bump it here (today as YYYYMMDD, or previous + 1 if that is not
 * higher) and rewrite the constant in categories.ts. CI uses this so a pattern
 * edit needs no manual version step.
 */
const autoVersion = process.argv.includes('--auto-version');
const categoriesPath = fileURLToPath(new URL('packages/core/src/categories.ts', root));

function todayVersion(): number {
  const now = new Date();
  return now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
}

function fail(message: string): never {
  console.error(`catalog: ${message}`);
  process.exit(1);
}

function readPrevious(): { text: string; document: CatalogDocument } | null {
  let text: string;
  try {
    text = readFileSync(jsonPath, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseCatalogText(text);
  if (!parsed.ok) fail(`the committed catalog/patterns.json is invalid (${parsed.reason}); fix or delete it first`);
  return { text, document: parsed.document };
}

let catalog = BUNDLED_CATALOG;
/** The bundled catalog must itself pass the validation a fetched one goes through. */
let next = serializeCatalog(catalog);
let roundTrip = parseCatalog(JSON.parse(next));
if (!roundTrip.ok) fail(`the bundled catalog does not validate: ${roundTrip.reason}`);

const extensionVersion: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('apps/extension/package.json', root)), 'utf8')).version;
if (typeof extensionVersion !== 'string') fail('apps/extension/package.json has no version');
if (compareExtensionVersions(BUNDLED_CATALOG.minExtensionVersion, extensionVersion) > 0) {
  fail(`CATALOG_MIN_EXTENSION_VERSION ${BUNDLED_CATALOG.minExtensionVersion} is newer than the extension (${extensionVersion}); the extension would reject its own catalog`);
}

/**
 * Group ids that were moved before launch, when nothing referred to them yet.
 * Anything added here after users exist must instead be kept with `patterns: []`.
 */
const MOVED_GROUPS: ReadonlySet<string> = new Set(['trivial/large']);

const previous = readPrevious();
if (previous !== null) {
  for (const before of previous.document.categories) {
    const after = roundTrip.document.categories.find((category) => category.id === before.id);
    if (after === undefined) fail(`category "${before.id}" was removed; ids are permanent (settings refer to them). Keep it and empty its groups instead.`);
    for (const group of before.groups) {
      if (MOVED_GROUPS.has(`${before.id}/${group.id}`)) continue;
      if (!after.groups.some((candidate) => candidate.id === group.id)) {
        fail(`group "${before.id}/${group.id}" was removed; ids are permanent (settings refer to them). Keep it with "patterns": [] instead.`);
      }
    }
  }
  const contentChanged =
    JSON.stringify(roundTrip.document.categories) !== JSON.stringify(previous.document.categories) ||
    JSON.stringify(roundTrip.document.listSurfaces ?? null) !== JSON.stringify(previous.document.listSurfaces ?? null) ||
    JSON.stringify(roundTrip.document.diffstatSurfaces ?? null) !== JSON.stringify(previous.document.diffstatSurfaces ?? null);
  if (catalog.version < previous.document.version) {
    fail(`CATALOG_VERSION ${catalog.version} is lower than the committed ${previous.document.version}`);
  }
  if (contentChanged && catalog.version === previous.document.version) {
    if (!autoVersion) fail(`the patterns changed but CATALOG_VERSION is still ${catalog.version}; bump it in packages/core/src/categories.ts (or run with --auto-version)`);
    const bumped = Math.max(todayVersion(), previous.document.version + 1);
    const source = readFileSync(categoriesPath, 'utf8');
    const rewritten = source.replace(/export const CATALOG_VERSION = \d+;/, `export const CATALOG_VERSION = ${bumped};`);
    if (rewritten === source) fail('could not find `export const CATALOG_VERSION = <n>;` in categories.ts to bump it');
    writeFileSync(categoriesPath, rewritten);
    catalog = { ...catalog, version: bumped };
    next = serializeCatalog(catalog);
    roundTrip = parseCatalog(JSON.parse(next));
    if (!roundTrip.ok) fail(`the bundled catalog does not validate after the version bump: ${roundTrip.reason}`);
    console.log(`catalog: content changed; CATALOG_VERSION bumped ${previous.document.version} → ${bumped}`);
  }
}

if (check) {
  if (previous === null || previous.text !== next) fail('catalog/patterns.json is out of date; run `pnpm catalog:build` and `pnpm catalog:sign`');
  let signature: string;
  try {
    signature = readFileSync(sigPath, 'utf8');
  } catch {
    fail('catalog/patterns.sig is missing; run `pnpm catalog:sign`');
  }
  const verified = await verifyCatalogSignature(new Uint8Array(readFileSync(jsonPath)), signature, CATALOG_PUBLIC_KEY);
  if (!verified) fail('catalog/patterns.sig does not match catalog/patterns.json (or the public key in packages/core/src/catalog-key.ts); run `pnpm catalog:sign`');
  console.log(`catalog ${catalog.version}: file and signature are current`);
} else {
  writeFileSync(jsonPath, next);
  console.log(`catalog ${catalog.version}: wrote ${jsonPath}${previous !== null && previous.text === next ? ' (unchanged)' : ''}`);
  if (previous === null || previous.text !== next) console.log('now run `pnpm catalog:sign` (needs GELD_CATALOG_PRIVATE_KEY) and commit both files');
}
