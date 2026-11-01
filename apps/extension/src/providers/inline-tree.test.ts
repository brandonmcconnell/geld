// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { BUNDLED_CATALOG, createMatcher, DEFAULT_SETTINGS } from '@geld/core';
import type { FileStats } from '@geld/core';
import { breakdownFromFiles } from '../github/breakdown';
import { ProviderInlineTree } from './inline-tree';
import type { ProviderDiffView, ProviderTreeEntry } from './types';

const FADED = 'data-geld-provider-inline-tree-row';
const GLYPH = 'data-geld-provider-inline-tree-glyph';
const files: readonly FileStats[] = [{ path: 'spec/unit.test.ts', additions: 4, deletions: 0 }, { path: 'src/main.ts', additions: 2, deletions: 0 }];
const { hidden } = breakdownFromFiles(files, createMatcher(DEFAULT_SETTINGS, null, BUNDLED_CATALOG));
const trees: ProviderInlineTree[] = [];
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing fixture'); return value; }
function fixture(provider: 'gitlab' | 'bitbucket') {
  document.documentElement.setAttribute('data-geld-provider', provider);
  // Leading glyph/folder structures reduced from installed GitLab MR266334 and Bitbucket PR27 captures.
  // Annotation buttons are synthetic ownership probes, not proof of a live Bitbucket thread surface.
  document.body.innerHTML = provider === 'gitlab'
    ? '<section><nav class="mr-tree-list"><div class="vue-recycle-scroller"><div><button data-testid="file-row" aria-expanded="true" title="spec/">spec</button><div id="row"><a id="file" href="#spec"><span data-testid="file-row-name-container"><span><svg id="leading"><use href="/native-file-icons.svg#ruby"></use></svg></span><span>unit.test.ts</span></span></a><button id="comments" aria-label="1 unresolved thread"><svg id="annotation"></svg></button></div></div></div></nav></section>'
    : '<section id="file-tree"><ul role="list"><li id="directory"><button aria-expanded="true"><span role="img" aria-label="Directory"><svg></svg></span>spec</button><ul role="list"><li><a id="file" href="#chg-spec/unit.test.ts"><div role="presentation"><span><div><svg id="leading"><path d="native"></path></svg></div></span></div><span>unit.test.ts</span><button id="comments" aria-label="1 comment"><svg id="annotation"></svg></button></a></li></ul></li></ul></section>';
  const host = required(document.querySelector<HTMLElement>('section'));
  const link = required(document.querySelector<HTMLAnchorElement>('#file'));
  const row = provider === 'gitlab' ? required(document.querySelector<HTMLElement>('#row')) : link;
  const glyph = required(document.querySelector<SVGElement>('#leading'));
  const entry: ProviderTreeEntry = { path: 'spec/unit.test.ts', root: link, presentationRoot: row, link };
  const view: ProviderDiffView = { kind: 'reduced-native-fixture', container: document.body, entries: [], tree: [entry], treeHost: host, treeContainer: required(host.querySelector<HTMLElement>('nav,ul')), virtualized: false, filteredPaths: new Set() };
  const tree = new ProviderInlineTree(); trees.push(tree);
  return { tree, host, row, link, glyph, view, update: () => tree.update(view, hidden, files, { subjectKey: 'review:head' }) };
}
afterEach(() => { for (const tree of trees) tree.clear(); trees.length = 0; document.body.replaceChildren(); document.documentElement.removeAttribute('data-geld-provider'); });

it.each(['gitlab', 'bitbucket'] as const)('adds reversible %s inline category hints while retaining native nodes and event controls', (provider) => {
  const { tree, row, glyph, link, update } = fixture(provider);
  const annotation = required(document.getElementById('annotation')); const comment = required(document.getElementById('comments'));
  const click = vi.fn(); comment.addEventListener('click', click);
  const original = row.outerHTML; const parent = row.parentElement;
  update(); update();
  expect(row.parentElement).toBe(parent);
  expect(row.hasAttribute(FADED)).toBe(true); expect(glyph.hasAttribute(GLYPH)).toBe(true);
  expect(annotation.hasAttribute(GLYPH)).toBe(false); expect(document.getElementById('annotation')).toBe(annotation);
  expect(row.querySelectorAll('.geld-provider-inline-category-icon')).toHaveLength(1);
  expect(row.querySelector('.geld-provider-inline-category-icon')?.getAttribute('data-geld-native-icon')).toBe(provider === 'gitlab' ? 'work-item-test-case' : 'flask');
  expect(link.getAttribute('href')).toBe(provider === 'gitlab' ? '#spec' : '#chg-spec/unit.test.ts');
  comment.click(); expect(click).toHaveBeenCalledTimes(1);
  tree.clear();
  expect(row.outerHTML).toBe(original); expect(document.getElementById('leading')).toBe(glyph);
});

it('fades an all-hidden complete native folder, but keeps a mixed or partly represented folder unchanged', () => {
  const { tree, host, view, update } = fixture('bitbucket'); update();
  const folder = required(host.querySelector('#directory > button'));
  expect(folder.hasAttribute(FADED)).toBe(true);
  tree.update(view, hidden, [...files, { path: 'spec/helper.ts', additions: 1, deletions: 0 }], { subjectKey: 'review:head' });
  expect(folder.hasAttribute(FADED)).toBe(false);
  // A second source test missing from the native subtree is still incomplete.
  const partialFiles = [...files, { path: 'spec/second.test.ts', additions: 1, deletions: 0 }];
  const partial = breakdownFromFiles(partialFiles, createMatcher(DEFAULT_SETTINGS, null, BUNDLED_CATALOG));
  tree.update(view, partial.hidden, partialFiles, { subjectKey: 'review:head' });
  expect(folder.hasAttribute(FADED)).toBe(false);
});

it('does not infer folder completeness from a recycled or virtualized subset', () => {
  const gl = fixture('gitlab'); gl.update();
  expect(gl.host.querySelector('button[title="spec/"]')?.hasAttribute(FADED)).toBe(false);
  const bb = fixture('bitbucket');
  bb.tree.update({ ...bb.view, virtualized: true }, hidden, files, { subjectKey: 'review:head' });
  expect(bb.host.querySelector('#directory > button')?.hasAttribute(FADED)).toBe(false);
});

it('restores old hints after a path is reclassified, native root is recycled, or subject changes', () => {
  const { tree, view, glyph, row, update } = fixture('gitlab'); update();
  const replacement = { ...view, tree: view.tree.map((entry) => ({ ...entry, path: 'src/main.ts' })) };
  tree.update(replacement, hidden, files, { subjectKey: 'review:head' });
  expect(row.hasAttribute(FADED)).toBe(false); expect(glyph.hasAttribute(GLYPH)).toBe(false);
  expect(row.querySelector('.geld-provider-inline-category-icon')).toBeNull();
  update();
  tree.update({ ...view, tree: [] }, hidden, files, { subjectKey: 'other-review:head' });
  expect(row.hasAttribute(FADED)).toBe(false); expect(glyph.hasAttribute(GLYPH)).toBe(false);
});

it('restores exact prior marker values while retaining a newer owner change', () => {
  const { tree, row, glyph, update } = fixture('gitlab');
  row.setAttribute(FADED, 'old-owner'); glyph.setAttribute(GLYPH, 'old-glyph'); update();
  tree.clear(); expect(row.getAttribute(FADED)).toBe('old-owner'); expect(glyph.getAttribute(GLYPH)).toBe('old-glyph');
  update(); row.setAttribute(FADED, 'new-owner'); tree.clear();
  expect(row.getAttribute(FADED)).toBe('new-owner'); expect(glyph.getAttribute(GLYPH)).toBe('old-glyph');
});

it('updates a custom category icon without altering native file or annotation identity', () => {
  const { tree, view, row, glyph, update } = fixture('bitbucket'); update();
  const group = required(hidden.categories[0]);
  tree.update(view, { ...hidden, categories: [{ ...group, category: { ...group.category, icon: 'book' } }] }, files, { subjectKey: 'review:head' });
  expect(row.querySelector('.geld-provider-inline-category-icon')?.getAttribute('data-geld-native-icon')).toBe('book-with-bookmark');
  expect(document.getElementById('leading')).toBe(glyph); expect(row.querySelectorAll('.geld-provider-inline-category-icon')).toHaveLength(1);
});
