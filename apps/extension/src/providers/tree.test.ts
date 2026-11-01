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
afterEach(() => { for (const tree of trees) tree.clear(); trees.length = 0; document.body.replaceChildren(); document.documentElement.removeAttribute('data-geld-provider'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

it.each(['.geld-provider-category-header', '.geld-provider-essential-content', '.geld-provider-categories'])('recreates %s with the current controller selection without issuing a new choice', (selector) => {
  const { tree, host, view, container } = fixture();
  const selectCategory = vi.fn(); const setExpanded = vi.fn();
  const actions = { revealPath: vi.fn(), selectCategory, setExpanded, subjectKey: 'same-review-and-head', selectedCategoryId: 'tests' };
  tree.update(view, hidden, all, FILES, actions);
  expect(headers(host).map((button) => button.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
  required(host.querySelector(selector)).remove();
  tree.update(view, hidden, all, FILES, actions);
  tree.update(view, hidden, all, FILES, actions);
  expect(headers(host).map((button) => button.getAttribute('aria-expanded'))).toEqual(['false', 'true']);
  expect(container.getAttribute('data-geld-provider-category-body')).toBe('native');
  expect(host.querySelector('.geld-provider-category-content')?.hasAttribute('hidden')).toBe(false);
  expect(selectCategory).not.toHaveBeenCalled();
  expect(setExpanded).not.toHaveBeenCalled();
});

it.each(['children', 'host'])('retains the exact current file and collapsed folder after a native %s remount', (replacement) => {
  document.documentElement.dataset.geldProvider = 'gitlab';
  const { tree, host, container, view } = fixture();
  const actions = { revealPath: vi.fn(), setExpanded: vi.fn(), subjectKey: 'review-a:head-a', selectedCategoryId: 'tests' };
  tree.update(view, hidden, all, FILES, actions);
  const selected = (): HTMLAnchorElement => required(document.querySelector<HTMLAnchorElement>('[data-geld-category-path="spec/unit.test.ts"] a'));
  selected().click();
  const folder = (): HTMLButtonElement => required([...document.querySelectorAll<HTMLButtonElement>('.geld-provider-category .geld-provider-category-folder')].find((button) => button.textContent === 'spec'));
  folder().click();
  expect(selected().getAttribute('aria-current')).toBe('true');
  expect(folder().getAttribute('aria-expanded')).toBe('false');
  let nextView = view;
  if (replacement === 'children') required(host.querySelector('.geld-provider-categories')).remove();
  else {
    const nextHost = document.createElement('section');
    const nextContainer = container.cloneNode(true);
    if (!(nextContainer instanceof HTMLElement)) throw new Error('Missing native replacement tree');
    nextContainer.removeAttribute('data-geld-provider-category-body');
    nextHost.append(nextContainer); host.replaceWith(nextHost);
    const row = required(nextContainer.querySelector<HTMLElement>('#native-row'));
    const link = required(row.querySelector<HTMLAnchorElement>('#native-link'));
    nextView = { ...view, treeHost: nextHost, treeContainer: nextContainer, tree: [{ path: 'spec/unit.test.ts', root: link, presentationRoot: row, link }] };
  }
  tree.update(nextView, hidden, all, FILES, actions);
  tree.update(nextView, hidden, all, FILES, actions);
  expect(selected().getAttribute('aria-current')).toBe('true');
  expect(folder().getAttribute('aria-expanded')).toBe('false');
  expect(actions.revealPath).toHaveBeenCalledExactlyOnceWith('spec/unit.test.ts');
  tree.update(nextView, hidden, all, FILES, { ...actions, subjectKey: 'review-a:head-b' });
  expect(selected().hasAttribute('aria-current')).toBe(false);
  expect(folder().getAttribute('aria-expanded')).toBe('true');
});

it('keeps only one current file across Essential and categorized panels', () => {
  const { host, update } = fixture(); update();
  const essential = required(host.querySelector<HTMLButtonElement>('.geld-provider-essential-content [data-geld-category-path="src/main.ts"] button'));
  essential.click();
  expect(essential.getAttribute('aria-current')).toBe('true');
  required(headers(host)[1]).click();
  const test = required(host.querySelector<HTMLAnchorElement>('[data-geld-category-path="spec/unit.test.ts"] a'));
  test.click();
  expect(essential.hasAttribute('aria-current')).toBe(false);
  expect(test.getAttribute('aria-current')).toBe('true');
  expect(host.querySelectorAll('[data-geld-category-path] [aria-current="true"]')).toHaveLength(1);
});

it('uses the current subject choice after search suspension and explicit clear, rejecting a removed category', () => {
  const { tree, host, view, container } = fixture();
  const selectCategory = vi.fn(); const setExpanded = vi.fn();
  const actions = { revealPath: vi.fn(), selectCategory, setExpanded, subjectKey: 'review-a', selectedCategoryId: 'tests' };
  tree.update(view, hidden, all, FILES, actions);
  const search = required(host.querySelector<HTMLInputElement>('input'));
  search.value = '*.rb'; tree.update(view, hidden, all, FILES, actions);
  expect(host.querySelector('.geld-provider-categories')).toBeNull();
  expect(container.hasAttribute('data-geld-provider-category-body')).toBe(false);
  search.value = ''; tree.update(view, hidden, all, FILES, actions);
  expect(headers(host)[1]?.getAttribute('aria-expanded')).toBe('true');
  tree.clear();
  expect(host.querySelector('.geld-provider-categories')).toBeNull();
  tree.update(view, hidden, all, FILES, { ...actions, subjectKey: 'review-b', selectedCategoryId: 'essential' });
  expect(headers(host).map((button) => button.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
  tree.update(view, hidden, all, FILES, { ...actions, selectedCategoryId: 'removed-category' });
  expect(headers(host).map((button) => button.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
  expect(selectCategory).toHaveBeenCalledExactlyOnceWith('essential');
  expect(setExpanded).not.toHaveBeenCalled();
});

it('retains sanitized native presentation when hiding the recycler unmounts the source row', () => {
  const { tree, host, view, row, update, revealPath } = fixture();
  const originalComment = required(row.querySelector<HTMLButtonElement>('button'));
  const originalClick = vi.fn(); originalComment.addEventListener('click', originalClick);
  originalComment.setAttribute('aria-controls', 'native-popup-that-may-unmount');
  update(); required(headers(host)[1]).click();
  const selector = '.geld-provider-category-content [data-geld-category-path="spec/unit.test.ts"]';
  const before = required(host.querySelector<HTMLElement>(selector));
  row.remove();
  tree.update({ ...view, tree: [] }, hidden, all, FILES, { revealPath, setExpanded: vi.fn() });
  const retained = required(host.querySelector<HTMLElement>(selector));
  expect(retained).toBe(before);
  expect(retained.querySelector('.native-added')).not.toBeNull();
  const comment = required(retained.querySelector<HTMLButtonElement>('button'));
  expect(comment.getAttribute('aria-label')).toBe('3 unresolved threads');
  expect(comment.hasAttribute('aria-controls')).toBe(false);
  expect(document.getElementById('native-warning')).toBeNull();
  expect(document.getElementById(required(comment.getAttribute('aria-describedby')))?.textContent).toBe('3');
  comment.click();
  expect(originalClick).not.toHaveBeenCalled();
  expect(revealPath).toHaveBeenCalledExactlyOnceWith('spec/unit.test.ts');
});

it('never relays a cached comment control to a physical native row recycled for another path', () => {
  const { tree, host, view, row, link, update, revealPath } = fixture();
  const nativeClick = vi.fn(); required(row.querySelector('button')).addEventListener('click', nativeClick);
  update(); required(headers(host)[1]).click();
  const oldComment = required(host.querySelector<HTMLButtonElement>('.geld-provider-category-content button[aria-label="3 unresolved threads"]'));
  // Native Vue updates the same node between controller passes; its old captured path is no longer valid.
  link.href = '/review#different-file';
  link.setAttribute('aria-label', 'main.ts');
  oldComment.click();
  expect(nativeClick).not.toHaveBeenCalled();
  expect(revealPath).toHaveBeenLastCalledWith('spec/unit.test.ts');
  tree.update({ ...view, tree: [{ path: 'src/main.ts', root: link, presentationRoot: row, link }] }, hidden, all, FILES, { revealPath, setExpanded: vi.fn() });
  required(host.querySelector<HTMLButtonElement>('.geld-provider-category-content button[aria-label="3 unresolved threads"]')).click();
  expect(nativeClick).not.toHaveBeenCalled();
  expect(revealPath).toHaveBeenCalledTimes(2);
});

it('refreshes a retained snapshot when the real path remounts with updated native marks', () => {
  const { tree, host, view, row, update, revealPath } = fixture();
  const parent = required(row.parentElement);
  update(); required(headers(host)[1]).click();
  row.remove();
  tree.update({ ...view, tree: [] }, hidden, all, FILES, { revealPath, setExpanded: vi.fn() });
  const button = required(row.querySelector('button'));
  button.setAttribute('aria-label', '5 unresolved threads');
  required(button.querySelector('span')).textContent = '5';
  parent.append(row);
  update();
  expect(headers(host)[1]?.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('.geld-provider-category-content button[aria-label="5 unresolved threads"]')).not.toBeNull();
  expect(host.querySelector('.geld-provider-category-content button[aria-label="3 unresolved threads"]')).toBeNull();
});

it('drops cached visual and ID references when the selected subject changes on the same host', () => {
  const { tree, host, view, row } = fixture();
  const actions = { revealPath: vi.fn(), setExpanded: vi.fn() };
  tree.update(view, hidden, all, FILES, { ...actions, subjectKey: 'review42:head-a' });
  required(headers(host)[1]).click();
  const oldDescription = required(host.querySelector('.geld-provider-category-content button[aria-describedby]')?.getAttribute('aria-describedby'));
  row.remove();
  tree.update({ ...view, tree: [] }, hidden, all, FILES, { ...actions, subjectKey: 'review42:head-b' });
  expect(host.querySelector('.geld-provider-category-content .native-added')).toBeNull();
  expect(host.querySelector('.geld-provider-category-content button[aria-label="3 unresolved threads"]')).toBeNull();
  expect(document.getElementById(oldDescription)).toBeNull();
  expect(host.querySelector('[data-geld-category-path="spec/unit.test.ts"]')).not.toBeNull();
  for (const node of host.querySelectorAll('[data-geld-ui] [aria-labelledby], [data-geld-ui] [aria-describedby], [data-geld-ui] [aria-controls]')) {
    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      for (const id of node.getAttribute(attribute)?.split(/\s+/) ?? []) expect(document.getElementById(id)).not.toBeNull();
    }
  }
});


it('does not force layout across200 mutation passes; batches attach/viewport sizing and cancels on clear', () => {
  const { tree, host, update } = fixture();
  host.style.setProperty('--geld-provider-tree-max-height', '450px', 'important');
  let frame: FrameRequestCallback | null = null;
  let notify: (entries: ResizeObserverEntry[]) => void = () => undefined;
  const disconnected = vi.fn();
  class Observer implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { notify = (entries) => callback(entries, this); }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void { disconnected(); }
  }
  const request = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; });
  const cancel = vi.fn(() => { frame = null; });
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const measure = vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 240, 400));
  const flush = (): void => { const pending = frame; frame = null; pending?.(0); };
  const entry = (width: number, height: number): ResizeObserverEntry => ({ target: host, contentRect: new DOMRectReadOnly(0, 0, width, height), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] });
  update();
  for (let index = 0; index < 200; index += 1) update();
  expect(measure).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  flush();
  expect(measure).toHaveBeenCalledTimes(1);
  notify([entry(240, 400)]);
  notify([entry(240, 800)]); // Own height changes must not feed another measurement frame.
  for (let index = 0; index < 200; index += 1) update();
  expect(request).toHaveBeenCalledTimes(1);
  expect(measure).toHaveBeenCalledTimes(1);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(window.innerHeight + 100);
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('resize'));
  expect(request).toHaveBeenCalledTimes(2);
  expect(measure).toHaveBeenCalledTimes(1);
  flush();
  expect(measure).toHaveBeenCalledTimes(2);
  notify([entry(300, 800)]);
  expect(request).toHaveBeenCalledTimes(3);
  tree.clear();
  expect(disconnected).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith(7);
  flush();
  expect(measure).toHaveBeenCalledTimes(2);
  expect(host.style.getPropertyValue('--geld-provider-tree-max-height')).toBe('450px');
  expect(host.style.getPropertyPriority('--geld-provider-tree-max-height')).toBe('important');
  window.dispatchEvent(new Event('resize'));
  expect(request).toHaveBeenCalledTimes(3);
});

it('preserves a newer owner of the geometry variable when clearing the accordion', () => {
  const { tree, host, update } = fixture();
  let frame: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 240, 400));
  update();
  const pending: FrameRequestCallback | null = frame;
  if (pending !== null) Reflect.apply(pending, undefined, [0]);
  host.style.setProperty('--geld-provider-tree-max-height', '600px', 'important');
  tree.clear();
  expect(host.style.getPropertyValue('--geld-provider-tree-max-height')).toBe('600px');
  expect(host.style.getPropertyPriority('--geld-provider-tree-max-height')).toBe('important');
});


it.each(['gitlab', 'bitbucket'] as const)('uses %s category equivalents and native folder controls without changing their accessible names', (provider) => {
  document.documentElement.setAttribute('data-geld-provider', provider);
  const { tree, view, host, container } = fixture();
  const original = document.createElement('button');
  original.type = 'button'; original.className = 'observed-native-folder-class'; original.setAttribute('aria-expanded', 'true');
  if (provider === 'gitlab') original.dataset.testid = 'file-row';
  else original.innerHTML = '<span role="img" aria-label="Directory"><svg><path d="m14.53 6.03-6 6a.75.75 0 0 1-1.004.052l-.056-.052-6-6 1.06-1.06L8 10.44l5.47-5.47z"></path></svg></span>';
  original.setAttribute('id', 'native-directory-control'); original.setAttribute('onclick', 'doNotCopy()');
  container.prepend(original);
  const group = required(hidden.categories[0]);
  const update = (icon: typeof group.category.icon) => tree.update(view, { ...hidden, categories: [{ ...group, category: { ...group.category, icon } }] }, all, FILES, { revealPath: vi.fn(), setExpanded: vi.fn(), subjectKey: 'same-review' });
  update('beaker');
  expect(headers(host).map((button) => button.textContent)).toEqual(['Essential (1 file)', 'Tests (2 tests)']);
  const tests = required(headers(host)[1]);
  expect(tests.querySelector('svg')?.getAttribute('data-geld-native-icon')).toBe(provider === 'gitlab' ? 'work-item-test-case' : 'flask');
  expect(tests.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  tests.click();
  const folder = required(host.querySelector<HTMLButtonElement>('.geld-provider-category-content .geld-provider-category-folder'));
  expect(folder.classList.contains('observed-native-folder-class')).toBe(true);
  expect(folder.getAttribute('id')).toBeNull(); expect(folder.getAttribute('onclick')).toBeNull();
  expect(folder.querySelector('svg')?.getAttribute('data-geld-native-icon')).toBe(provider === 'gitlab' ? 'folder-open' : 'chevron-down');
  const name = folder.textContent;
  folder.click();
  expect(folder.getAttribute('aria-expanded')).toBe('false');
  expect(folder.textContent).toBe(name);
  expect(folder.querySelector('svg')?.getAttribute('data-geld-native-icon')).toBe(provider === 'gitlab' ? 'folder' : 'chevron-right');
  folder.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(folder.getAttribute('aria-expanded')).toBe('true');
  expect(folder.querySelector('svg')?.getAttribute('data-geld-native-icon')).toBe(provider === 'gitlab' ? 'folder-open' : 'chevron-down');
  update('book');
  expect(tests.querySelector('svg')?.getAttribute('data-geld-native-icon')).toBe(provider === 'gitlab' ? 'book' : 'book-with-bookmark');
  expect(tests.textContent).toBe('Tests (2 tests)');
  tree.clear();
  expect(original.isConnected).toBe(true);
  expect(original.getAttribute('aria-expanded')).toBe('true');
  expect(original.getAttribute('onclick')).toBe('doNotCopy()');
  expect(host.querySelector('.geld-provider-category-icon')).toBeNull();
});
