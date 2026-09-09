import type { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Catalog } from './categories';
import { BUNDLED_CATALOG, CATEGORIES, categoryById } from './categories';
import { CATALOG_PUBLIC_KEY } from './catalog-key';
import type { CatalogDocument } from './catalog';
import { catalogRejection, compareExtensionVersions, formatCatalogVersion, parseCatalog, parseCatalogText, resolveCatalog, serializeCatalog, verifyCatalogSignature } from './catalog';
import { createMatcher } from './matcher';
import type { GeldSettings } from './settings';
import { DEFAULT_SETTINGS } from './settings';

/** The bundled catalog as the JSON file carries it; `parseCatalog` must accept it unchanged. */
function bundledJson(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(serializeCatalog(BUNDLED_CATALOG));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('serializeCatalog did not produce an object');
  return { ...parsed };
}

/** A copy of the bundled JSON with `edit` applied to the first category (Tests). */
function withTests(edit: (tests: Record<string, unknown>) => Record<string, unknown>, top: Record<string, unknown> = {}): Record<string, unknown> {
  const document = bundledJson();
  const categories = document.categories;
  if (!Array.isArray(categories)) throw new Error('no categories');
  const [tests, ...rest] = categories;
  if (typeof tests !== 'object' || tests === null) throw new Error('no tests category');
  return { ...document, ...top, categories: [edit({ ...tests }), ...rest] };
}

function reasonOf(value: unknown): string {
  const parsed = parseCatalog(value);
  return parsed.ok ? 'ok' : parsed.reason;
}

describe('parseCatalog', () => {
  it('accepts the bundled catalog round-tripped through JSON', () => {
    const parsed = parseCatalog(bundledJson());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.document.version).toBe(BUNDLED_CATALOG.version);
      expect(parsed.document.minExtensionVersion).toBe(BUNDLED_CATALOG.minExtensionVersion);
      expect(parsed.document.categories).toEqual(CATEGORIES);
    }
  });

  it('accepts the committed catalog/patterns.json, which is what the extension fetches', () => {
    const text = readFileSync(new URL('../../../catalog/patterns.json', import.meta.url), 'utf8');
    expect(text).toBe(serializeCatalog(BUNDLED_CATALOG));
    const parsed = parseCatalogText(text);
    expect(parsed.ok).toBe(true);
  });

  it('ignores unknown keys so a later format can add some', () => {
    expect(reasonOf({ ...bundledJson(), future: true })).toBe('ok');
    expect(reasonOf(withTests((tests) => ({ ...tests, colour: 'red' })))).toBe('ok');
  });

  it('rejects anything that is not a catalog object', () => {
    expect(reasonOf(null)).toBe('expected a catalog object, got null');
    expect(reasonOf([])).toBe('expected a catalog object, got a list of 0');
    expect(reasonOf('{}')).toBe('expected a catalog object, got "{}"');
    expect(reasonOf({})).toBe('geldCatalog: expected format 1, got nothing');
    expect(reasonOf({ ...bundledJson(), geldCatalog: 2 })).toBe('geldCatalog: expected format 1, got 2');
  });

  it('rejects a bad version or minExtensionVersion', () => {
    expect(reasonOf({ ...bundledJson(), version: '2026.09.08' })).toBe('version: expected a positive integer, got "2026.09.08"');
    expect(reasonOf({ ...bundledJson(), version: 0 })).toBe('version: expected a positive integer, got 0');
    expect(reasonOf({ ...bundledJson(), version: 1.5 })).toBe('version: expected a positive integer, got 1.5');
    expect(reasonOf({ ...bundledJson(), minExtensionVersion: 1 })).toBe('catalog.minExtensionVersion: expected a string, got 1');
    expect(reasonOf({ ...bundledJson(), minExtensionVersion: 'v1' })).toBe('minExtensionVersion: expected "x.y.z", got "v1"');
    expect(reasonOf({ ...bundledJson(), minExtensionVersion: '1.2' })).toBe('minExtensionVersion: expected "x.y.z", got "1.2"');
    expect(reasonOf({ ...bundledJson(), minExtensionVersion: '1.2.3.4' })).toBe('ok');
  });

  it('rejects a bad categories list', () => {
    expect(reasonOf({ ...bundledJson(), categories: {} })).toBe('categories: expected a list, got an object');
    expect(reasonOf({ ...bundledJson(), categories: ['tests'] })).toBe('categories[0]: expected a category object, got "tests"');
    const document = bundledJson();
    const categories = document.categories;
    if (!Array.isArray(categories)) throw new Error('no categories');
    expect(reasonOf({ ...document, categories: [...categories, categories[0]] })).toBe('categories: duplicate category id "tests"');
  });

  it('rejects ill-formed ids and wrong category fields', () => {
    expect(reasonOf(withTests((tests) => ({ ...tests, id: 'Tests' })))).toBe('categories[0].id: expected an id like "lockfiles", got "Tests"');
    expect(reasonOf(withTests((tests) => ({ ...tests, id: '1st' })))).toBe('categories[0].id: expected an id like "lockfiles", got "1st"');
    expect(reasonOf(withTests((tests) => ({ ...tests, id: 'custom:x' })))).toBe('categories[0].id: expected an id like "lockfiles", got "custom:x"');
    expect(reasonOf(withTests((tests) => ({ ...tests, title: '' })))).toBe('categories[0].title: must not be empty');
    expect(reasonOf(withTests((tests) => ({ ...tests, title: 3 })))).toBe('categories[0].title: expected a string, got 3');
    expect(reasonOf(withTests((tests) => ({ ...tests, description: 5 })))).toBe('categories[0].description: expected a string, got 5');
    expect(reasonOf(withTests((tests) => ({ ...tests, description: '' })))).toBe('ok');
    expect(reasonOf(withTests((tests) => ({ ...tests, icon: 'unicorn' })))).toBe('categories[0].icon: unknown icon "unicorn"');
    expect(reasonOf(withTests((tests) => ({ ...tests, icon: undefined })))).toBe('categories[0].icon: unknown icon nothing');
    expect(reasonOf(withTests((tests) => ({ ...tests, defaultEnabled: 'yes' })))).toBe('categories[0].defaultEnabled: expected true or false, got "yes"');
    expect(reasonOf(withTests((tests) => ({ ...tests, noun: '' })))).toBe('categories[0].noun: must not be empty');
    expect(reasonOf(withTests((tests) => ({ ...tests, nounPlural: [] })))).toBe('categories[0].nounPlural: expected a string, got a list of 0');
    expect(reasonOf(withTests((tests) => ({ ...tests, shortNoun: null })))).toBe('categories[0].shortNoun: expected a string, got null');
    expect(reasonOf(withTests((tests) => ({ ...tests, shortNounPlural: {} })))).toBe('categories[0].shortNounPlural: expected a string, got an object');
  });

  it('rejects bad groups', () => {
    expect(reasonOf(withTests((tests) => ({ ...tests, groups: 'unit' })))).toBe('categories[0].groups: expected a list, got "unit"');
    expect(reasonOf(withTests((tests) => ({ ...tests, groups: [null] })))).toBe('categories[0].groups[0]: expected a group object, got null');
    expect(reasonOf(withTests((tests) => ({ ...tests, groups: [{ id: 'Unit', label: 'x', description: '', patterns: [] }] })))).toBe(
      'categories[0].groups[0].id: expected an id like "lockfiles", got "Unit"',
    );
    expect(reasonOf(withTests((tests) => ({ ...tests, groups: [{ id: 'unit', label: '', description: '', patterns: [] }] })))).toBe('categories[0].groups[0].label: must not be empty');
    expect(reasonOf(withTests((tests) => ({ ...tests, groups: [{ id: 'unit', label: 'x', patterns: [] }] })))).toBe('categories[0].groups[0].description: expected a string, got nothing');
    expect(reasonOf(withTests((tests) => ({ ...tests, groups: [{ id: 'unit', label: 'x', description: '', patterns: '*.test.*' }] })))).toBe(
      'categories[0].groups[0].patterns: expected a list, got "*.test.*"',
    );
    expect(reasonOf(withTests((tests) => ({ ...tests, groups: [{ id: 'unit', label: 'x', description: '', patterns: [] }] })))).toBe('ok');
    const group = { id: 'unit', label: 'x', description: '', patterns: [] };
    expect(reasonOf(withTests((tests) => ({ ...tests, groups: [group, group] })))).toBe('categories[0].groups: duplicate group id "unit"');
  });

  it('rejects patterns that do not compile or are not patterns', () => {
    const groups = (...patterns: unknown[]): Record<string, unknown> => ({ groups: [{ id: 'unit', label: 'x', description: '', patterns }] });
    expect(reasonOf(withTests((tests) => ({ ...tests, ...groups(42) })))).toBe('categories[0].groups[0].patterns[0]: expected a pattern, got 42');
    expect(reasonOf(withTests((tests) => ({ ...tests, ...groups('') })))).toBe('categories[0].groups[0].patterns[0]: pattern "" has surrounding whitespace or is empty');
    expect(reasonOf(withTests((tests) => ({ ...tests, ...groups(' *.snap') })))).toBe('categories[0].groups[0].patterns[0]: pattern " *.snap" has surrounding whitespace or is empty');
    expect(reasonOf(withTests((tests) => ({ ...tests, ...groups('# note') })))).toBe('categories[0].groups[0].patterns[0]: pattern "# note" looks like a comment');
    expect(reasonOf(withTests((tests) => ({ ...tests, ...groups('a[z-a]') })))).toMatch(/^categories\[0\]\.groups\[0\]\.patterns\[0\]: pattern "a\[z-a\]" does not compile \(/);
    expect(reasonOf(withTests((tests) => ({ ...tests, ...groups('*.ok', '!keep/**') })))).toBe('ok');
  });

  it('parses text and reports bad JSON', () => {
    expect(parseCatalogText('{')).toEqual({ ok: false, reason: expect.stringMatching(/^not valid JSON \(/) });
    expect(parseCatalogText('[]')).toEqual({ ok: false, reason: 'expected a catalog object, got a list of 0' });
  });
});

describe('compareExtensionVersions', () => {
  it('orders by the first three numeric parts only', () => {
    expect(compareExtensionVersions('0.1.1', '0.1.1')).toBe(0);
    expect(compareExtensionVersions('0.1.1', '0.1.1.7')).toBe(0);
    expect(compareExtensionVersions('0.1.2', '0.1.1')).toBeGreaterThan(0);
    expect(compareExtensionVersions('0.1.1', '0.2.0')).toBeLessThan(0);
    expect(compareExtensionVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareExtensionVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareExtensionVersions('0.1', '0.1.0')).toBe(0);
  });
});

describe('catalogRejection', () => {
  const document: CatalogDocument = { version: BUNDLED_CATALOG.version + 1, minExtensionVersion: '0.1.1', categories: CATEGORIES };

  it('accepts a newer catalog this extension is allowed to use', () => {
    expect(catalogRejection(document, { extensionVersion: '0.1.1', currentVersion: BUNDLED_CATALOG.version })).toBeNull();
    expect(catalogRejection(document, { extensionVersion: '0.1.1.3', currentVersion: BUNDLED_CATALOG.version })).toBeNull();
    expect(catalogRejection(document, { extensionVersion: '2.0.0', currentVersion: BUNDLED_CATALOG.version })).toBeNull();
  });

  it('rejects a catalog for a newer extension, with a reason worth showing', () => {
    expect(catalogRejection({ ...document, minExtensionVersion: '0.2.0' }, { extensionVersion: '0.1.9', currentVersion: 1 })).toEqual({
      kind: 'too-new',
      reason: `catalog ${formatCatalogVersion(document.version)} needs Geld 0.2.0 or newer (this is 0.1.9)`,
    });
  });

  it('rejects a catalog that is not newer than the one in use', () => {
    expect(catalogRejection(document, { extensionVersion: '0.1.1', currentVersion: document.version })).toEqual({ kind: 'not-newer', reason: expect.stringContaining('is not newer than') });
    expect(catalogRejection(document, { extensionVersion: '0.1.1', currentVersion: document.version + 5 })?.kind).toBe('not-newer');
  });
});

describe('formatCatalogVersion', () => {
  it('shows date-shaped versions as dates and anything else as a number', () => {
    expect(formatCatalogVersion(20260908)).toBe('2026.09.08');
    expect(formatCatalogVersion(20261301)).toBe('20261301');
    expect(formatCatalogVersion(7)).toBe('7');
  });
});

describe('resolveCatalog', () => {
  const tests = categoryById('tests');
  const fetched: CatalogDocument = {
    version: BUNDLED_CATALOG.version + 1,
    minExtensionVersion: '0.1.1',
    categories: [
      {
        ...tests,
        title: 'Test files',
        icon: 'bug',
        defaultEnabled: false,
        groups: [{ id: 'bench', label: 'Benchmarks', description: 'Benchmark files.', patterns: ['*.bench.*'] }, ...tests.groups.filter((group) => group.id !== 'e2e')],
      },
      { ...categoryById('docs'), defaultEnabled: true, groups: [] },
      { ...tests, id: 'newcat', title: 'Brand new', groups: [{ id: 'all', label: 'All', description: '', patterns: ['**'] }] },
    ],
  };

  it('returns the bundled catalog when there is nothing fetched or it is not newer', () => {
    expect(resolveCatalog(BUNDLED_CATALOG, null)).toBe(BUNDLED_CATALOG);
    expect(resolveCatalog(BUNDLED_CATALOG, { ...fetched, version: BUNDLED_CATALOG.version })).toBe(BUNDLED_CATALOG);
    expect(resolveCatalog(BUNDLED_CATALOG, { ...fetched, version: 1 })).toBe(BUNDLED_CATALOG);
  });

  it('takes content from the fetched catalog and policy from the bundled one', () => {
    const active = resolveCatalog(BUNDLED_CATALOG, fetched);
    expect(active.version).toBe(fetched.version);
    const activeTests = categoryById('tests', active);
    expect(activeTests.title).toBe('Test files');
    expect(activeTests.icon).toBe('bug');
    // A remote file cannot switch a category on or off for everyone.
    expect(activeTests.defaultEnabled).toBe(tests.defaultEnabled);
    expect(categoryById('docs', active).defaultEnabled).toBe(categoryById('docs').defaultEnabled);
    // Categories are fixed by the build: a new one in the file is ignored, an omitted one stays as bundled.
    expect(active.categories.map((category) => category.id)).toEqual(CATEGORIES.map((category) => category.id));
    expect(categoryById('generated', active)).toBe(categoryById('generated'));
  });

  it('unions groups so nothing settings refer to disappears', () => {
    const active = resolveCatalog(BUNDLED_CATALOG, fetched);
    const groups = categoryById('tests', active).groups;
    expect(groups[0]).toEqual({ id: 'bench', label: 'Benchmarks', description: 'Benchmark files.', patterns: ['*.bench.*'] });
    // Dropped from the file but still known to the build: kept from the bundled side.
    expect(groups.find((group) => group.id === 'e2e')).toEqual(tests.groups.find((group) => group.id === 'e2e'));
    // Deprecation is an empty pattern list, which the file can express.
    expect(categoryById('docs', active).groups).toEqual(categoryById('docs').groups);
  });

  it('feeds the matcher, so a new pattern hides files', () => {
    const active = resolveCatalog(BUNDLED_CATALOG, fetched);
    const matcher = createMatcher(DEFAULT_SETTINGS, null, active);
    expect(matcher.categorize('perf/render.bench.ts')?.id).toBe('tests');
    expect(createMatcher(DEFAULT_SETTINGS).categorize('perf/render.bench.ts')).toBeNull();
    // Custom categories and category patterns keep working alongside.
    const custom: GeldSettings = {
      ...DEFAULT_SETTINGS,
      categories: { docs: true },
      customCategories: [{ id: 'custom:mine', title: 'Mine', icon: 'tag', patterns: ['mine/**'] }],
      categoryPatterns: { docs: ['*.txt'] },
    };
    const customMatcher = createMatcher(custom, null, active);
    expect(customMatcher.categorize('mine/a.ts')?.id).toBe('custom:mine');
    expect(customMatcher.categorize('notes.txt')?.id).toBe('docs');
  });
});

describe('verifyCatalogSignature', () => {
  function bytesOf(text: string): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(new ArrayBuffer(text.length * 3));
    const { written } = new TextEncoder().encodeInto(text, bytes);
    return bytes.slice(0, written);
  }

  const payload = bytesOf(serializeCatalog(BUNDLED_CATALOG));

  function isKeyPair(value: webcrypto.CryptoKey | webcrypto.CryptoKeyPair): value is webcrypto.CryptoKeyPair {
    return 'privateKey' in value;
  }

  async function sign(bytes: Uint8Array<ArrayBuffer>): Promise<{ signature: string; publicKey: string }> {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    if (!isKeyPair(pair)) throw new Error('expected a key pair');
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, bytes);
    const publicKey = await crypto.subtle.exportKey('raw', pair.publicKey);
    return { signature: Buffer.from(signature).toString('base64'), publicKey: Buffer.from(publicKey).toString('base64') };
  }

  it('verifies a valid signature', async () => {
    const { signature, publicKey } = await sign(payload);
    await expect(verifyCatalogSignature(payload, signature, publicKey)).resolves.toBe(true);
    await expect(verifyCatalogSignature(payload, `${signature}\n`, publicKey)).resolves.toBe(true);
  });

  it('rejects tampered JSON', async () => {
    const { signature, publicKey } = await sign(payload);
    const tampered = bytesOf(serializeCatalog(BUNDLED_CATALOG).replace('"defaultEnabled": false', '"defaultEnabled": true'));
    expect(tampered).not.toEqual(payload);
    await expect(verifyCatalogSignature(tampered, signature, publicKey)).resolves.toBe(false);
  });

  it('rejects the wrong key and malformed inputs', async () => {
    const { signature } = await sign(payload);
    const other = await sign(payload);
    await expect(verifyCatalogSignature(payload, signature, other.publicKey)).resolves.toBe(false);
    await expect(verifyCatalogSignature(payload, other.signature, CATALOG_PUBLIC_KEY)).resolves.toBe(false);
    await expect(verifyCatalogSignature(payload, '', other.publicKey)).resolves.toBe(false);
    await expect(verifyCatalogSignature(payload, 'not base64!', other.publicKey)).resolves.toBe(false);
    await expect(verifyCatalogSignature(payload, signature.slice(4), other.publicKey)).resolves.toBe(false);
    await expect(verifyCatalogSignature(payload, signature, 'AAAA')).resolves.toBe(false);
  });

  it('accepts the committed catalog/patterns.sig with the embedded public key', async () => {
    const json = readFileSync(new URL('../../../catalog/patterns.json', import.meta.url));
    const signature = readFileSync(new URL('../../../catalog/patterns.sig', import.meta.url), 'utf8');
    await expect(verifyCatalogSignature(new Uint8Array(json), signature, CATALOG_PUBLIC_KEY)).resolves.toBe(true);
    await expect(verifyCatalogSignature(new Uint8Array([...json, 10]), signature, CATALOG_PUBLIC_KEY)).resolves.toBe(false);
  });
});

describe('bundled catalog', () => {
  it('is self-consistent', () => {
    const catalog: Catalog = BUNDLED_CATALOG;
    expect(catalog.categories).toBe(CATEGORIES);
    expect(reasonOf(bundledJson())).toBe('ok');
  });
});
