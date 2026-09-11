import { describe, expect, it } from 'vitest';
import { BUNDLED_CATALOG } from './categories';
import { parseCatalog, resolveCatalog, serializeCatalog } from './catalog';
import { BUNDLED_LIST_SURFACES, parseDiffstatSurfaces, parseListSurfaces } from './list-surfaces';

describe('list surfaces in the catalog', () => {
  it('round-trips through the serialized catalog', () => {
    const parsed = parseCatalog(JSON.parse(serializeCatalog(BUNDLED_CATALOG)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.listSurfaces).toEqual(BUNDLED_LIST_SURFACES);
  });

  it('a newer fetched document replaces the surfaces; one without keeps the bundled ones', () => {
    const changed = [{ ...BUNDLED_LIST_SURFACES[0]!, row: '.js-issue-row, .new-row' }];
    const withSurfaces = resolveCatalog(BUNDLED_CATALOG, { version: BUNDLED_CATALOG.version + 1, minExtensionVersion: '0.1.0', categories: [], listSurfaces: changed });
    expect(withSurfaces.listSurfaces).toEqual(changed);
    const without = resolveCatalog(BUNDLED_CATALOG, { version: BUNDLED_CATALOG.version + 1, minExtensionVersion: '0.1.0', categories: [] });
    expect(without.listSurfaces).toBe(BUNDLED_LIST_SURFACES);
  });

  it('rejects malformed surfaces with a path', () => {
    expect(() => parseListSurfaces([{ id: 'x', description: '', row: '.r', chipAnchors: [{ selector: '.a', placement: 'inside' }], authors: [] }])).toThrow(/chipAnchors\[0\]\.placement/);
    expect(() => parseListSurfaces([{ id: 'Bad Id', description: '', row: '.r', chipAnchors: [], authors: [] }])).toThrow(/\.id/);
    expect(() => parseListSurfaces([{ id: 'a', description: '', row: '.r', chipAnchors: [], authors: [{ selector: 'a', from: 'magic' }] }])).toThrow(/authors\[0\]\.from/);
    const dup = { id: 'a', description: '', row: '.r', chipAnchors: [], authors: [] };
    expect(() => parseListSurfaces([dup, dup])).toThrow(/duplicate/);
  });
});

describe('diffstat surfaces in the catalog', () => {
  it('round-trips and validates', () => {
    const parsed = parseCatalog(JSON.parse(serializeCatalog(BUNDLED_CATALOG)));
    expect(parsed.ok && parsed.document.diffstatSurfaces).toEqual(BUNDLED_CATALOG.diffstatSurfaces);
    expect(() => parseDiffstatSurfaces([{ id: 'x', description: '', root: '.r', subject: {}, host: '.h', additions: '.a', deletions: '.d' }])).toThrow(/subject/);
    expect(() => parseDiffstatSurfaces([{ id: 'x', description: '', root: '.r', subject: { attribute: 'data-x' }, host: '.h', additions: '.a' }])).toThrow(/deletions/);
  });
});
