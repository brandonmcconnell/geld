// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import type { FileStats } from '@geld/core';
import { BUNDLED_CATALOG, createMatcher, DEFAULT_SETTINGS } from '@geld/core';
import { breakdownFromFiles } from '../github/breakdown';
import type { HiddenBreakdown } from '../github/breakdown';
import type { ProviderDiffView, ProviderTreeEntry } from './types';
import { ProviderCategoryTree } from './tree';

const FILES: readonly FileStats[] = [
  { path: 'src/main.ts', additions: 2, deletions: 0, status: 'modified' },
  { path: 'spec/unit.test.ts', additions: 4, deletions: 1, status: 'added' },
  { path: 'test/lazy.test.ts', additions: 2, deletions: 0, status: 'modified' },
];
const { all, hidden } = breakdownFromFiles(FILES, createMatcher(DEFAULT_SETTINGS, null, BUNDLED_CATALOG));
const trees: ProviderCategoryTree[] = [];

function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing fixture node'); return value; }
function fixture() {
  // Reduced observed GitLab structure; the original positioned recycler nodes must never move.
  document.body.innerHTML = '<section id="host"><h2>Files</h2><input type="search" aria-label="Search files"><nav aria-label="File tree"><div style="min-height:96px"><div id="virtual" style="transform:translateY(64px)"><div id="native-row" class="native-file-row" style="--level:1"><a id="native-link" href="/review#spec" aria-label="unit.test.ts, has warning annotations"><svg id="native-status" class="native-added"><use href="#native-status-shape"></use></svg><span id="native-status-shape">unit.test.ts</span></a><button aria-label="3 unresolved threads" aria-describedby="native-warning"><span id="native-warning">3</span></button></div></div></div></nav></section>';
  const host = required(document.querySelector<HTMLElement>('#host'));
  const container = required(host.querySelector<HTMLElement>('nav'));
  const row = required(host.querySelector<HTMLElement>('#native-row'));
  const link = required(host.querySelector<HTMLAnchorElement>('#native-link'));
  const entries: ProviderTreeEntry[] = [{ path: 'spec/unit.test.ts', root: link, presentationRoot: row, link }];
  const view: ProviderDiffView = { kind: 'observed-recycler-fixture', container: document.body, entries: [], tree: entries, treeHost: host, treeContainer: container, filteredPaths: new Set(), virtualized: true };
  const revealPath = vi.fn(); const setExpanded = vi.fn();
  const tree = new ProviderCategoryTree(); trees.push(tree);
  const update = (breakdown: HiddenBreakdown = hidden, files: readonly FileStats[] = FILES): void => tree.update(view, breakdown, all, files, { revealPath, setExpanded });
  return { tree, host, container, row, link, view, revealPath, setExpanded, update };
}
function headers(host: HTMLElement): HTMLButtonElement[] { return [...host.querySelectorAll<HTMLButtonElement>('.geld-provider-category-header')]; }
afterEach(() => { for (const tree of trees) tree.clear(); trees.length = 0; document.body.replaceChildren(); vi.restoreAllMocks(); });

it('projects complete compact Essential/category trees without moving native recycler nodes', () => {
  const { host, container, row, update } = fixture();
  const parent = row.parentElement; const virtualStyle = parent?.getAttribute('style');
  update();
  expect(row.parentElement).toBe(parent);
  expect(parent?.getAttribute('style')).toBe(virtualStyle);
  expect(container.getAttribute('data-geld-provider-category-body')).toBe('native');
  expect(host.querySelector('input[type="search"]')).not.toBeNull();
  expect(headers(host).map((button) => button.textContent)).toEqual(['Essential (1 file)', 'Tests (2 tests)']);
  const essential = required(host.querySelector<HTMLElement>('.geld-provider-essential-content'));
  expect(essential.querySelectorAll('[data-geld-category-path]')).toHaveLength(1);
  expect(essential.textContent).toContain('main.ts');
  const category = required(host.querySelector<HTMLElement>('.geld-provider-category-content'));
  expect(category.hidden).toBe(true);
  expect([...category.querySelectorAll<HTMLElement>('[data-geld-category-path]')].map((node) => node.dataset.geldCategoryPath)).toEqual(['spec/unit.test.ts', 'test/lazy.test.ts']);
  expect(category.textContent).toContain('lazy.test.ts'); // Full inventory despite an unmounted native row.
});

it('keeps native status/comment visuals and annotation names, remaps duplicate IDs, and relays native comment controls', () => {
  const { host, row, revealPath, update } = fixture();
  const nativeComment = required(row.querySelector<HTMLButtonElement>('button'));
  const nativeClick = vi.fn(); nativeComment.addEventListener('click', nativeClick);
  update();
  required(headers(host)[1]).click();
  const clone = required(host.querySelector<HTMLElement>('.geld-provider-category-content [data-geld-category-path="spec/unit.test.ts"]'));
  expect(clone.querySelector('.native-added')).not.toBeNull();
  expect(clone.querySelector('a')?.getAttribute('aria-label')).toContain('has warning annotations');
  const comment = required(clone.querySelector<HTMLButtonElement>('button'));
  expect(comment.getAttribute('aria-label')).toBe('3 unresolved threads');
  expect(comment.getAttribute('aria-describedby')).not.toBe('native-warning');
  expect(document.getElementById(required(comment.getAttribute('aria-describedby')))?.textContent).toBe('3');
  expect(document.querySelectorAll('#native-link')).toHaveLength(1);
  expect(clone.querySelector('use')?.getAttribute('href')).not.toBe('#native-status-shape');
  comment.click();
  expect(nativeClick).toHaveBeenCalledTimes(1);
  expect(revealPath).not.toHaveBeenCalled();
  required(clone.querySelector<HTMLAnchorElement>('a')).click();
  expect(revealPath).toHaveBeenCalledExactlyOnceWith('spec/unit.test.ts');
  expect(clone.querySelector('a')?.getAttribute('aria-current')).toBe('true');
});

it('keeps exactly one accessible panel open and supports native header keyboard traversal', () => {
  const { host, setExpanded, update } = fixture(); update();
  const [essential, tests] = headers(host);
  required(essential).focus();
  required(essential).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(tests);
  required(tests).click();
  expect(essential?.getAttribute('aria-expanded')).toBe('false');
  expect(tests?.getAttribute('aria-expanded')).toBe('true');
  expect(setExpanded).toHaveBeenLastCalledWith(true);
  expect(document.getElementById(required(tests?.getAttribute('aria-controls')))?.hidden).toBe(false);
  required(tests).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(essential);
  required(essential).click();
  expect(setExpanded).toHaveBeenLastCalledWith(false);
  expect(essential?.getAttribute('aria-expanded')).toBe('true');
  expect(tests?.getAttribute('aria-expanded')).toBe('false');
});

it('updates native comment marks without losing active panel or collapsed compacted directories', () => {
  const { host, row, update } = fixture(); update(); required(headers(host)[1]).click();
  const folder = required(host.querySelector<HTMLButtonElement>('.geld-provider-category-content .geld-provider-category-folder'));
  folder.click();
  expect(folder.getAttribute('aria-expanded')).toBe('false');
  required(row.querySelector('button')).setAttribute('aria-label', '4 unresolved threads');
  required(row.querySelector('button span')).textContent = '4';
  update();
  expect(headers(host)[1]?.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('.geld-provider-category-content .geld-provider-category-folder')?.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.geld-provider-category-content button[aria-label="4 unresolved threads"]')).not.toBeNull();
});

it('uses plural nouns for zero and singular only for one', () => {
  const { host, tree, view } = fixture();
  const group = required(hidden.categories[0]);
  const empty: HiddenBreakdown = { ...hidden, totals: { files: 0, additions: 0, deletions: 0 }, categories: [{ ...group, paths: [], totals: { files: 0, additions: 0, deletions: 0 } }] };
  tree.update(view, empty, { files: 0, additions: 0, deletions: 0 }, [], { revealPath: vi.fn(), setExpanded: vi.fn() });
  expect(headers(host).map((button) => button.textContent)).toEqual(['Essential (0 files)', 'Tests (0 tests)']);
  tree.update(view, { ...hidden, totals: { files: 1, additions: 4, deletions: 1 }, categories: [{ ...group, paths: ['spec/unit.test.ts'], totals: { files: 1, additions: 4, deletions: 1 } }] }, all, FILES, { revealPath: vi.fn(), setExpanded: vi.fn() });
  expect(headers(host)[1]?.textContent).toBe('Tests (1 test)');
});

it('restores exact native attributes and preserves search/filter ownership on clear and nonempty native search', () => {
  const { tree, host, container, row, update } = fixture();
  const before = container.innerHTML; const parent = container.parentElement;
  update(); tree.clear();
  expect(container.parentElement).toBe(parent);
  expect(container.innerHTML).toBe(before);
  expect(container.hasAttribute('data-geld-provider-category-body')).toBe(false);
  expect(host.querySelector('[data-geld-ui]')).toBeNull();
  update();
  required(host.querySelector<HTMLInputElement>('input')).value = '*.rb';
  update();
  expect(container.hasAttribute('data-geld-provider-category-body')).toBe(false);
  expect(host.querySelector('.geld-provider-categories')).toBeNull();
  expect(row.isConnected).toBe(true);
  expect(required(host.querySelector<HTMLInputElement>('input')).value).toBe('*.rb');
});

it('ignores its own clones if an older adapter returns all matching native selectors', () => {
  const { host, row, view, update } = fixture(); update();
  const clone = required(host.querySelector<HTMLElement>('.geld-provider-category-content .native-file-row'));
  const oldView = { ...view, tree: [...view.tree, { path: 'spec/unit.test.ts', root: clone, link: clone.querySelector<HTMLAnchorElement>('a') }] };
  const tree = required(trees[0]); tree.update(oldView, hidden, all, FILES, { revealPath: vi.fn(), setExpanded: vi.fn() });
  expect(host.querySelectorAll('.geld-provider-category-content .native-file-row')).toHaveLength(1);
  expect(row.closest('[data-geld-ui]')).toBeNull();
});

it('selects a category before asking the controller to expand its diff roots', () => {
  const { host, tree, view } = fixture();
  const calls: string[] = [];
  tree.update(view, hidden, all, FILES, { revealPath: () => undefined, selectCategory: (id) => calls.push(`select:${id}`), setExpanded: (expanded) => calls.push(`expand:${expanded}`) });
  required(headers(host)[1]).click();
  expect(calls).toEqual(['select:tests', 'expand:true']);
  required(headers(host)[0]).click();
  expect(calls.slice(-2)).toEqual(['select:essential', 'expand:false']);
});
