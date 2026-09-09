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

/** The bundled catalog must itself pass the validation a fetched one goes through. */
const next = serializeCatalog(BUNDLED_CATALOG);
const roundTrip = parseCatalog(JSON.parse(next));
if (!roundTrip.ok) fail(`the bundled catalog does not validate: ${roundTrip.reason}`);

const extensionVersion: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('apps/extension/package.json', root)), 'utf8')).version;
if (typeof extensionVersion !== 'string') fail('apps/extension/package.json has no version');
if (compareExtensionVersions(BUNDLED_CATALOG.minExtensionVersion, extensionVersion) > 0) {
  fail(`CATALOG_MIN_EXTENSION_VERSION ${BUNDLED_CATALOG.minExtensionVersion} is newer than the extension (${extensionVersion}); the extension would reject its own catalog`);
}

const previous = readPrevious();
if (previous !== null) {
  for (const before of previous.document.categories) {
    const after = roundTrip.document.categories.find((category) => category.id === before.id);
    if (after === undefined) fail(`category "${before.id}" was removed; ids are permanent (settings refer to them). Keep it and empty its groups instead.`);
    for (const group of before.groups) {
      if (!after.groups.some((candidate) => candidate.id === group.id)) {
        fail(`group "${before.id}/${group.id}" was removed; ids are permanent (settings refer to them). Keep it with "patterns": [] instead.`);
      }
    }
  }
  const contentChanged = JSON.stringify(roundTrip.document.categories) !== JSON.stringify(previous.document.categories);
  if (BUNDLED_CATALOG.version < previous.document.version) {
    fail(`CATALOG_VERSION ${BUNDLED_CATALOG.version} is lower than the committed ${previous.document.version}`);
  }
  if (contentChanged && BUNDLED_CATALOG.version === previous.document.version) {
    fail(`the patterns changed but CATALOG_VERSION is still ${BUNDLED_CATALOG.version}; bump it in packages/core/src/categories.ts`);
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
  console.log(`catalog ${BUNDLED_CATALOG.version}: file and signature are current`);
} else {
  writeFileSync(jsonPath, next);
  console.log(`catalog ${BUNDLED_CATALOG.version}: wrote ${jsonPath}${previous !== null && previous.text === next ? ' (unchanged)' : ''}`);
  if (previous === null || previous.text !== next) console.log('now run `pnpm catalog:sign` (needs GELD_CATALOG_PRIVATE_KEY) and commit both files');
}
