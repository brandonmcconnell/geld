// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { FileStats, GeldSettings } from '@geld/core';
import type { TabState } from '../lib/messages';
import { ProviderController } from './controller';
import { readBitbucketDiff } from '../bitbucket/diff';
import { createBitbucketDiffSyntax } from '../bitbucket';
import type { ProviderAdapter, ProviderDiffEntry, ProviderDiffResult, ProviderDiffView, ProviderDiffLine, ProviderReviewPage, ProviderCommitPage, ReviewProvider } from './types';

vi.mock('wxt/utils/storage', () => ({ storage: {
  defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }),
  getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined,
} }));

const PROVIDERS: readonly ReviewProvider[] = ['gitlab', 'bitbucket'];
const running: ProviderController[] = [];

function node(selector: string): HTMLElement {
  const result = document.querySelector<HTMLElement>(selector);
  if (result === null) throw new Error(`Missing fixture node ${selector}`);
  return result;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let finish: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { finish = resolve; });
  return { promise, resolve: (value) => finish(value) };
}

function page(provider: ReviewProvider, number: string): ProviderReviewPage {
  const origin = provider === 'gitlab' ? 'https://gitlab.com' : 'https://bitbucket.org';
  const url = provider === 'gitlab'
    ? `${origin}/acme/widgets/-/merge_requests/${number}`
    : `${origin}/acme/widgets/pull-requests/${number}`;
  return {
    provider, repository: { provider, origin, path: 'acme/widgets' }, number, url,
    diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, kind: 'diff', headSha: number.repeat(40), version: number,
  };
}

function fixture(provider: ReviewProvider, files: readonly FileStats[], fetch?: ProviderAdapter['fetchDiff']): {
  readonly adapter: ProviderAdapter;
  readonly fetchDiff: ReturnType<typeof vi.fn<ProviderAdapter['fetchDiff']>>;
  readonly view: ProviderDiffView;
  readonly expand: ReturnType<typeof vi.fn>;
} {
  document.body.innerHTML = `
    <header><span id="add"><svg aria-label="Added"></svg><b>112 additions</b></span>
    <span id="del"><svg aria-label="Removed"></svg><b>27 deletions</b></span><span id="files">3 files changed</span></header>
    <aside id="tree"><a id="tree-test" href="#hidden">src/first.test.ts</a></aside>
    <main id="diff"><article id="visible">src/main.ts</article><article id="hidden">src/first.test.ts</article></main>`;
  const expand = vi.fn(() => true);
  const entries: readonly ProviderDiffEntry[] = [
    { path: 'src/main.ts', root: node('#visible'), anchor: 'visible', additions: 12, deletions: 2, expand, collapse: () => true },
    { path: 'src/first.test.ts', root: node('#hidden'), anchor: 'hidden', additions: 30, deletions: 10, expand, collapse: () => true },
  ];
  const view: ProviderDiffView = {
    kind: 'fixture', container: node('#diff'), entries, treeHost: node('#tree'),
    tree: [{ path: 'src/first.test.ts', root: node('#tree-test'), link: document.querySelector<HTMLAnchorElement>('#tree-test') }],
    filteredPaths: new Set(), virtualized: false,
  };
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockImplementation(fetch ?? (async () => ({ files, complete: true, revision: 'head' })));
  const adapter: ProviderAdapter = {
    id: provider,
    describe: (url) => {
      const number = /\/reviews\/(\d+)/.exec(url.pathname)?.[1];
      return number === undefined ? null : page(provider, number);
    },
    readDiff: () => view,
    headerTargets: () => [{ additions: node('#add'), deletions: node('#del'), files: node('#files') }],
    listRows: () => [], fetchDiff,
  };
  return { adapter, fetchDiff, view, expand };
}

function start(adapter: ProviderAdapter, settings: GeldSettings = DEFAULT_SETTINGS): { readonly controller: ProviderController; readonly published: TabState[] } {
  const published: TabState[] = [];
  const controller = new ProviderController(adapter, settings, (state) => published.push(state));
  running.push(controller);
  controller.start();
  return { controller, published };
}

const FILES: readonly FileStats[] = [
  { path: 'src/main.ts', additions: 12, deletions: 2 },
  { path: 'src/first.test.ts', additions: 30, deletions: 10 },
  { path: 'test/not-mounted.test.ts', additions: 70, deletions: 15 },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  window.history.replaceState(null, '', '/reviews/1');
});
afterEach(() => {
  for (const controller of running) controller.stop();
  running.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.head.querySelector('[data-geld-unit-native-syntax]')?.remove();
});

async function settle(): Promise<void> { await vi.advanceTimersByTimeAsync(120); }

it('reopens a category selected again during partial-stream layout while preserving a native collapse within the selected category', async () => {
  const files: readonly FileStats[] = [...FILES, { path: 'README.md', additions: 1, deletions: 0 }];
  const { adapter, view } = fixture('gitlab', files);
  const root = document.createElement('article'); root.id = 'docs'; view.container.append(root);
  let testsOpen = true; let docsOpen = true;
  const testEntry = view.entries[1];
  if (testEntry === undefined) throw new Error('Missing native test file');
  const entries: readonly ProviderDiffEntry[] = [view.entries[0] ?? testEntry,
    { ...testEntry, isExpanded: () => testsOpen, expand: () => { testsOpen = true; return true; }, collapse: () => { testsOpen = false; return true; } },
    { path: 'README.md', root, anchor: 'docs', additions: 1, deletions: 0, isExpanded: () => docsOpen,
      expand: () => { docsOpen = true; return true; }, collapse: () => { docsOpen = false; return true; } }];
  const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries, groupingWrappers: [view.container], groupingReady: false }) },
    { ...DEFAULT_SETTINGS, testOutline: false, categories: { docs: true }, categoryPatterns: { docs: ['README.md'] } });
  await settle();
  const select = (title: string): void => {
    const header = [...document.querySelectorAll<HTMLButtonElement>('.geld-provider-category-header')].find((button) => button.textContent?.startsWith(title));
    if (header === undefined) throw new Error(`Missing ${title} category`);
    header.click();
  };
  expect(testsOpen).toBe(false); expect(docsOpen).toBe(false);
  select('Tests'); expect(testsOpen).toBe(true); expect(docsOpen).toBe(false);
  select('Docs'); expect(testsOpen).toBe(false); expect(docsOpen).toBe(true);
  select('Tests'); expect(testsOpen).toBe(true); expect(docsOpen).toBe(false);
  testsOpen = false;
  controller.requestRefresh(); await settle();
  expect(testsOpen).toBe(false);
  select('Docs'); select('Tests');
  expect(testsOpen).toBe(true);
  expect(view.container.classList.contains('geld-provider-diffs')).toBe(false);
});

it.each(['resize', 'observer'] as const)('switches category placement on a CSS-only sidebar change signaled by %s before the periodic refresh', async (signal) => {
  const { adapter, fetchDiff } = fixture('gitlab', FILES);
  const sidebar = node('#tree');
  const presentation = document.createElement('div').style;
  presentation.display = 'block';
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((target, pseudo) => target === sidebar ? presentation : computed(target, pseudo));
  const observers: Observer[] = [];
  class Observer implements ResizeObserver {
    readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element): void { this.targets.add(target); }
    unobserve(target: Element): void { this.targets.delete(target); }
    disconnect(): void { this.targets.clear(); }
    notify(target: Element): void {
      if (!this.targets.has(target)) return;
      const entry: ResizeObserverEntry = { target, contentRect: new DOMRectReadOnly(0, 0, presentation.display === 'none' ? 0 : 250, 500), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] };
      this.callback([entry], this);
    }
  }
  vi.stubGlobal('ResizeObserver', Observer);
  const { controller } = start(adapter);
  await settle();
  const select = [...sidebar.querySelectorAll<HTMLButtonElement>('.geld-provider-category-header')].find((button) => button.textContent?.startsWith('Tests'));
  if (select === undefined) throw new Error('Missing Tests category');
  select.click();
  const notify = (): void => {
    if (signal === 'resize') window.dispatchEvent(new Event('resize'));
    else for (const observer of [...observers]) observer.notify(sidebar);
  };
  const refresh = vi.spyOn(controller, 'requestRefresh');
  notify();
  expect(refresh).not.toHaveBeenCalled();
  presentation.display = 'none';
  notify(); notify();
  expect(refresh).toHaveBeenCalledTimes(1);
  await settle();
  const fallback = document.querySelector<HTMLElement>('[data-geld-provider-category-placement="fallback"]');
  expect(fallback).not.toBeNull();
  expect(sidebar.querySelector('.geld-provider-category-header')).toBeNull();
  expect(fallback?.querySelector('.geld-provider-category-header[aria-expanded="true"]')?.textContent).toContain('Tests');
  refresh.mockClear();
  notify();
  expect(refresh).not.toHaveBeenCalled();
  presentation.display = 'block';
  notify();
  expect(refresh).toHaveBeenCalledTimes(1);
  await settle();
  expect(document.querySelector('[data-geld-provider-category-placement="fallback"]')).toBeNull();
  expect(sidebar.querySelector('.geld-provider-category-header[aria-expanded="true"]')?.textContent).toContain('Tests');
  expect(fetchDiff).toHaveBeenCalledOnce();
  expect(controller.getTabState().expanded).toBe(true);
  controller.stop();
  presentation.display = 'none'; notify();
  await settle();
  expect(document.querySelector('[data-geld-provider-category-placement="fallback"]')).toBeNull();
});

describe('provider controller behavior', () => {
  it('withdraws native projections during a reload, preserves category/folder choices and retires only source-dependent work', async () => {
    const { adapter, view, fetchDiff } = fixture('gitlab', FILES);
    let pending = false;let unavailable = false;
    const stopped = vi.fn();const update = vi.fn();const source = vi.fn(() => null);
    const { controller } = start({ ...adapter, createNativeView: () => ({ update, suspended: () => pending, sourceUnavailable: () => unavailable, stop: stopped }),
      readDiff: () => ({ ...view, readNewSourceFrame: source }) }, { ...DEFAULT_SETTINGS, testOutline: true });
    await settle();controller.revealPath('src/first.test.ts');
    const header = () => [...document.querySelectorAll<HTMLButtonElement>('.geld-provider-category-header')].find((button) => button.textContent?.startsWith('Tests'));
    const folder = () => [...document.querySelectorAll<HTMLButtonElement>('.geld-provider-category-folder')].find((button) => button.querySelector('.geld-provider-category-folder-label')?.textContent === 'test');
    folder()?.click();expect(folder()?.getAttribute('aria-expanded')).toBe('false');
    const raw = controller.getTabState().all;const readCount = source.mock.calls.length;
    pending = true;unavailable = true;controller.requestRefresh();await settle();
    expect(document.querySelector('.geld-provider-categories')).toBeNull();expect(node('#hidden').hasAttribute('data-geld-provider-hidden')).toBe(false);
    expect(controller.getTabState().all).toEqual(raw);expect(source).toHaveBeenCalledTimes(readCount);expect(fetchDiff).toHaveBeenCalledOnce();
    pending = false;unavailable = false;controller.requestRefresh();await settle();
    expect(header()?.getAttribute('aria-expanded')).toBe('true');expect(folder()?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-geld-category-path="src/first.test.ts"] [aria-current="true"]')).not.toBeNull();
    expect(node('#hidden').getAttribute('data-geld-provider-hidden')).toBe('open');expect(fetchDiff).toHaveBeenCalledOnce();
    unavailable = true;controller.requestRefresh();await settle();
    expect(header()?.getAttribute('aria-expanded')).toBe('true');expect(node('#hidden').getAttribute('data-geld-provider-hidden')).toBe('open');
    const blockedReads = source.mock.calls.length;controller.clearDiffCache();await settle();expect(source).toHaveBeenCalledTimes(blockedReads);
    controller.updateSettings({ ...DEFAULT_SETTINGS, enabled: false });await settle();expect(stopped).not.toHaveBeenCalled();
    controller.stop();expect(stopped).toHaveBeenCalledOnce();
  });

  it('does not read native source frames when both fold features are disabled', async () => {
    const { adapter, view, fetchDiff } = fixture('gitlab', FILES);
    const readNewSourceFrame = vi.fn(() => null);
    const settings = { ...DEFAULT_SETTINGS, testOutline: false, hideCommentLines: false };
    const { controller } = start({ ...adapter, readDiff: () => ({ ...view, readNewSourceFrame }) }, settings);
    await settle();
    expect(controller.getTabState().hasDiff).toBe(true);
    expect(readNewSourceFrame).not.toHaveBeenCalled();
    controller.updateSettings({ ...settings, testOutline: true });await settle();
    expect(readNewSourceFrame).toHaveBeenCalled();
    expect(fetchDiff).toHaveBeenCalledOnce();
  });

  it.each(PROVIDERS)('opens an all-hidden %s subject by default while preserving zero essential counts and a manual collapse', async (provider) => {
    const files: readonly FileStats[] = [{ path: 'src/first.test.ts', additions: 30, deletions: 10 }];
    const { adapter, view } = fixture(provider, files);
    const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries: view.entries.filter((entry) => entry.path.endsWith('.test.ts')) }) });
    await settle();
    expect(controller.getTabState()).toMatchObject({ expanded: true, visible: { files: 0, additions: 0, deletions: 0 } });
    expect(node('#hidden').getAttribute('data-geld-provider-hidden')).toBe('open');
    expect(document.querySelector('.geld-provider-hidden .geld-provider-toggle')?.textContent).toBe('Hide 1 test');
    controller.toggleHidden();
    controller.requestRefresh();
    await settle();
    expect(controller.getTabState().expanded).toBe(false);
    expect(node('#hidden').getAttribute('data-geld-provider-hidden')).toBe('closed');
    window.history.replaceState(null, '', '/reviews/2');
    controller.requestRefresh();
    await vi.advanceTimersByTimeAsync(900);
    expect(controller.getTabState().expanded).toBe(true);
    window.history.replaceState(null, '', '/reviews/1');
    controller.requestRefresh();
    await vi.advanceTimersByTimeAsync(900);
    expect(controller.getTabState().expanded).toBe(false);
  });

  it('does not infer all-hidden expansion from only the mounted files of a partial native view', async () => {
    const { adapter, view } = fixture('gitlab', FILES);
    const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries: view.entries.filter((entry) => entry.path.endsWith('.test.ts')) }) });
    await settle();
    expect(controller.getTabState().expanded).toBe(false);
    expect(controller.getTabState().visible?.files).toBe(1);
  });

  it('uses native filtering when every remaining file belongs to a hidden category', async () => {
    const { adapter, view } = fixture('gitlab', FILES);
    const { controller } = start({ ...adapter, readDiff: () => ({ ...view, filteredPaths: new Set(['src/main.ts']) }) });
    await settle();
    expect(controller.getTabState()).toMatchObject({ expanded: true, visible: { files: 0, additions: 0, deletions: 0 } });
  });

  it('keeps inline native file headers without adding a grouped bottom section', async () => {
    const { adapter } = fixture('gitlab', FILES);
    start(adapter, { ...DEFAULT_SETTINGS, groupHidden: false });
    await settle();
    expect(node('#hidden').hasAttribute('data-geld-provider-inline')).toBe(true);
    expect(document.querySelector('.geld-provider-hidden')).toBeNull();
  });

  it('reveals only the requested inline file and keeps its native state after remounts', async () => {
    const { adapter, view } = fixture('gitlab', FILES);
    let firstExpanded = true;
    let secondExpanded = true;
    const firstCollapse = vi.fn(() => { firstExpanded = false; return true; });
    const secondCollapse = vi.fn(() => { secondExpanded = false; return true; });
    const first = view.entries.find((entry) => entry.path === 'src/first.test.ts');
    if (first === undefined) throw new Error('Missing hidden fixture');
    let current = { ...first, isExpanded: () => firstExpanded, expand: () => { firstExpanded = true; return true; }, collapse: firstCollapse };
    const secondRoot = document.createElement('article');
    view.container.append(secondRoot);
    const second = { ...first, path: 'test/not-mounted.test.ts', root: secondRoot, isExpanded: () => secondExpanded, expand: () => { secondExpanded = true; return true; }, collapse: secondCollapse };
    const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries: [current, second] }) }, { ...DEFAULT_SETTINGS, groupHidden: false });
    await settle();
    expect(firstExpanded).toBe(false);
    expect(secondExpanded).toBe(false);
    controller.revealPath(first.path);
    expect(firstExpanded).toBe(true);
    expect(secondExpanded).toBe(false);
    expect(controller.getTabState().expanded).toBe(false);
    const replacement = document.createElement('article');
    current.root.replaceWith(replacement);
    current = { ...current, root: replacement };
    controller.requestRefresh();
    await settle();
    expect(firstCollapse).toHaveBeenCalledOnce();
    expect(firstExpanded).toBe(true);
    controller.toggleHidden();
    controller.toggleHidden();
    expect(firstExpanded).toBe(false);
    expect(secondExpanded).toBe(false);
  });

  it('hides excluded authors without taking ownership of the provider native hidden state', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { adapter } = fixture('gitlab', FILES);
    const row = document.createElement('li');
    row.className = '!gl-flex';
    document.body.append(row);
    const { controller } = start({ ...adapter, listRows: () => [{ root: row, host: row, author: 'alice', url: new URL('/reviews/1', window.location.href).href }] }, { ...DEFAULT_SETTINGS, hiddenAuthors: ['alice'] });
    await settle();
    expect(row.hasAttribute('data-geld-provider-author-hidden')).toBe(true);
    expect(row.hidden).toBe(false);
    row.hidden = true;
    controller.updateSettings({ ...DEFAULT_SETTINGS, hiddenAuthors: [] });
    await settle();
    expect(row.hasAttribute('data-geld-provider-author-hidden')).toBe(false);
    expect(row.hidden).toBe(true);
    controller.stop();
    expect(row.hidden).toBe(true);
    expect(row.hasAttribute('data-geld-provider-author-hidden')).toBe(false);
  });

  it('keeps the newly revealed native file current when temporary search restores the category tree', async () => {
    const { adapter, view } = fixture('gitlab', FILES);
    const search = document.createElement('input'); search.type = 'search';
    if (view.treeHost === null) throw new Error('Missing native tree');
    view.treeHost.prepend(search);
    const { controller } = start(adapter);
    await settle();
    controller.revealPath('src/first.test.ts');
    const current = (): string | undefined => document.querySelector('[data-geld-category-path] [aria-current="true"]')?.closest<HTMLElement>('[data-geld-category-path]')?.dataset.geldCategoryPath;
    expect(current()).toBe('src/first.test.ts');
    search.value = 'not-mounted'; controller.requestRefresh(); await settle();
    expect(document.querySelector('.geld-provider-categories')).toBeNull();
    controller.revealPath('test/not-mounted.test.ts');
    search.value = ''; controller.requestRefresh(); await settle();
    expect(current()).toBe('test/not-mounted.test.ts');
    expect([...document.querySelectorAll('.geld-provider-category-header')].find((button) => button.textContent?.startsWith('Tests'))?.getAttribute('aria-expanded')).toBe('true');
  });

  it('switches the active category when a popup reveal targets a file in another category', async () => {
    const files: readonly FileStats[] = [...FILES, { path: 'src/generated.ts', additions: 9, deletions: 1 }];
    const { adapter } = fixture('gitlab', files);
    const { controller } = start(adapter, { ...DEFAULT_SETTINGS, categories: { tests: true, generated: true }, categoryPatterns: { generated: ['src/generated.ts'] } });
    await settle();
    const headers = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.geld-provider-category-header')];
    headers().find((button) => button.textContent?.startsWith('Generated'))?.click();
    expect(node('#hidden').getAttribute('data-geld-provider-hidden')).toBe('closed');
    controller.revealPath('src/first.test.ts');
    expect(node('#hidden').getAttribute('data-geld-provider-hidden')).toBe('open');
    expect(headers().find((button) => button.textContent?.startsWith('Tests'))?.getAttribute('aria-expanded')).toBe('true');
    expect(headers().find((button) => button.textContent?.startsWith('Generated'))?.getAttribute('aria-expanded')).toBe('false');
    controller.updateSettings({ ...DEFAULT_SETTINGS, categories: { tests: false, generated: true }, categoryPatterns: { generated: ['src/generated.ts'] } });
    await settle();
    expect(controller.getTabState().expanded).toBe(false);
    expect(headers()[0]?.getAttribute('aria-expanded')).toBe('true');
  });

  it.each([0, 1, 2])('shows %i hidden tests with singular only for one and native semantic line colors', async (count) => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const files: readonly FileStats[] = [
      { path: 'src/main.ts', additions: 12, deletions: 2 },
      ...Array.from({ length: count }, (_, index) => ({ path: `src/hidden${index}.test.ts`, additions: 4, deletions: 1 })),
    ];
    const { adapter } = fixture('gitlab', files);
    const list = document.createElement('div');
    const nativeLink = document.createElement('a');
    nativeLink.textContent = 'Native MR';
    list.append(nativeLink);
    document.body.append(list);
    const { controller } = start({ ...adapter, listRows: () => [{ root: list, host: list, author: 'alice', url: new URL('/reviews/1', window.location.href).href }] });
    await settle();
    const chip = list.querySelector('.geld-provider-list-counts');
    expect(chip?.textContent).toBe(`${count} ${count === 1 ? 'test' : 'tests'} · +12 −2`);
    expect(chip?.querySelector('.geld-provider-list-counts__add')?.textContent).toBe('+12');
    expect(chip?.querySelector('.geld-provider-list-counts__del')?.textContent).toBe('−2');
    expect(list.firstChild).toBe(nativeLink);
    controller.updateSettings({ ...DEFAULT_SETTINGS, categories: { tests: false } });
    await settle();
    expect(chip?.textContent).toBe(`+${12 + count * 4} −${2 + count}`);
    controller.stop();
    expect(list.children).toHaveLength(1);
    expect(list.firstChild).toBe(nativeLink);
  });

  it.each(PROVIDERS)('counts hidden files missing from mounted %s DOM and restores native counts/icons on stop', async (provider) => {
    const { adapter } = fixture(provider, FILES);
    const nativeIcon = node('#add').querySelector('svg');
    const nativeNumber = node('#add').querySelector('b');
    const { controller } = start(adapter);
    await settle();
    expect(controller.getTabState()).toMatchObject({
      allowed: true, hasDiff: true, hiddenCount: 2,
      all: { files: 3, additions: 112, deletions: 27 }, visible: { files: 1, additions: 12, deletions: 2 },
      categories: [{ id: 'tests', paths: ['src/first.test.ts', 'test/not-mounted.test.ts'] }],
    });
    expect(node('#add').textContent).toBe('12 additions');
    expect(node('#del').textContent).toBe('2 deletions');
    expect(node('#files').textContent).toBe('1 file changed');
    expect(node('#hidden').getAttribute('data-geld-provider-hidden')).toBe('closed');
    expect(document.querySelector('[data-geld-category-path="test/not-mounted.test.ts"] button')?.getAttribute('aria-label')).toContain('test/not-mounted.test.ts');
    expect(node('#add').querySelector('svg')).toBe(nativeIcon);
    expect(node('#add').querySelector('b')).toBe(nativeNumber);
    controller.stop();
    expect(node('#add').textContent).toBe('112 additions');
    expect(node('#del').textContent).toBe('27 deletions');
    expect(node('#files').textContent).toBe('3 files changed');
    expect(node('#add').querySelector('svg')).toBe(nativeIcon);
    expect(node('#hidden').hasAttribute('data-geld-provider-hidden')).toBe(false);
    expect(node('#tree-test').hasAttribute('data-geld-provider-inline')).toBe(false);
    expect(document.querySelector('[data-geld-ui]')).toBeNull();
  });

  it.each(PROVIDERS)('uses global settings on %s without leaking same-name GitHub repository rules or scoped patterns', async (provider) => {
    const files: readonly FileStats[] = [
      { path: 'src/github-only.ts', additions: 90, deletions: 9 },
      { path: 'src/global.check.ts', additions: 20, deletions: 2 },
      { path: 'src/main.ts', additions: 2, deletions: 1 },
    ];
    const { adapter } = fixture(provider, files);
    const settings: GeldSettings = {
      ...DEFAULT_SETTINGS,
      repoRules: ['acme/widgets'],
      categoryPatterns: { tests: ['[acme/widgets]', 'src/github-only.ts', '[*]', 'src/global.check.ts'] },
    };
    const { controller } = start(adapter, settings);
    await settle();
    expect(controller.getTabState()).toMatchObject({
      allowed: true, hasDiff: true, hiddenCount: 1,
      visible: { files: 2, additions: 92, deletions: 10 },
      categories: [{ paths: ['src/global.check.ts'] }],
    });
  });

  it('keeps native totals while the complete diff is unavailable', async () => {
    const { adapter } = fixture('gitlab', FILES, async () => ({ files: [], complete: false, revision: 'partial' }));
    const { controller } = start(adapter);
    await settle();
    expect(controller.getTabState().hasDiff).toBe(false);
    expect(controller.getTabState().all).toBeNull();
    expect(node('#add').textContent).toBe('112 additions');
    expect(document.querySelector('.geld-provider-hidden')).toBeNull();
  });

  it('never displays an old review response after navigation, even when it arrives last', async () => {
    const old = deferred<ProviderDiffResult>();
    const fresh = deferred<ProviderDiffResult>();
    const { adapter } = fixture('gitlab', FILES, (request) => 'number' in request && request.number === '1' ? old.promise : fresh.promise);
    const { controller, published } = start(adapter);
    window.history.replaceState(null, '', '/reviews/2');
    controller.requestRefresh();
    await vi.advanceTimersByTimeAsync(750);
    fresh.resolve({ files: [{ path: 'src/new.ts', additions: 4, deletions: 1 }], complete: true, revision: '2' });
    await settle();
    expect(controller.getTabState()).toMatchObject({ hiddenCount: 0, visible: { additions: 4, deletions: 1, files: 1 } });
    const afterNew = published.length;
    old.resolve({ files: FILES, complete: true, revision: '1' });
    await settle();
    expect(controller.getTabState().diffPageUrl).toContain('/merge_requests/2/');
    expect(node('#add').textContent).toBe('4 additions');
    expect(published.slice(afterNew).every((state) => state.all?.additions === 4)).toBe(true);
  });

  it('does no new fetching while hidden or after stop, and does not remount from a late response', async () => {
    let hidden = true;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const waiting = deferred<ProviderDiffResult>();
    const { adapter, fetchDiff } = fixture('gitlab', FILES, () => waiting.promise);
    const { controller, published } = start(adapter);
    controller.requestRefresh();
    controller.toggleHidden();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchDiff).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    window.history.replaceState(null, '', '/reviews/2');
    controller.requestRefresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    controller.stop();
    const count = published.length;
    waiting.resolve({ files: FILES, complete: true, revision: 'late' });
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    controller.requestRefresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    expect(published).toHaveLength(count);
    expect(document.querySelector('[data-geld-ui]')).toBeNull();
    expect(node('#add').textContent).toBe('112 additions');
  });
});

it('runs diff classification and popup state on a standalone commit without fetching review actions', async () => {
  const { adapter } = fixture('gitlab', FILES);
  const head = 'a'.repeat(40);
  const standalone: ProviderCommitPage = { provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme/widgets' }, kind: 'commit', ref: head, headSha: head, version: head, url: `https://gitlab.com/acme/widgets/-/commit/${head}`, diffPageUrl: `https://gitlab.com/acme/widgets/-/commit/${head}`, diffUrl: `https://gitlab.com/acme/widgets/-/commit/${head}.diff` };
  const fetchReview = vi.fn<NonNullable<ProviderAdapter['fetchReview']>>();
  const { controller } = start({ ...adapter, describe: () => standalone, fetchReview, reviewHost: () => document.body, actionHost: () => document.body });
  await settle();
  expect(controller.getTabState()).toMatchObject({ hasDiff: true, hiddenCount: 2, onDiffPage: true, diffPageUrl: standalone.url });
  expect(fetchReview).not.toHaveBeenCalled();
  expect(document.querySelector('.geld-provider-review-actions')).toBeNull();
});

it('preserves first-seen and later manually collapsed visible files with expandLargeDiffs enabled', async () => {
  const files: readonly FileStats[] = [
    { path: 'src/main.ts', additions: 12, deletions: 2 },
    { path: 'src/large.ts', additions: 1200, deletions: 1 },
  ];
  const { adapter, view } = fixture('gitlab', files);
  let largeExpanded = false;
  const smallExpand = vi.fn(() => true);
  const largeExpand = vi.fn(() => { largeExpanded = true; return true; });
  const entries: readonly ProviderDiffEntry[] = [
    { path: 'src/main.ts', root: node('#visible'), anchor: 'visible', additions: 12, deletions: 2,
      isExpanded: () => false, expand: smallExpand, collapse: () => true },
    { path: 'src/large.ts', root: node('#hidden'), anchor: 'hidden', additions: 1200, deletions: 1,
      isExpanded: () => largeExpanded, expand: largeExpand, collapse: () => true },
  ];
  const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries }) }, {
    ...DEFAULT_SETTINGS, expandLargeDiffs: true, categories: { ...DEFAULT_SETTINGS.categories, large: false },
  });
  await settle();
  expect(controller.getTabState().hasDiff).toBe(true);
  expect(smallExpand).not.toHaveBeenCalled();
  expect(largeExpand).not.toHaveBeenCalled();
  expect(largeExpanded).toBe(false);
  largeExpanded = true;
  controller.requestRefresh();
  await settle();
  largeExpanded = false;
  controller.requestRefresh();
  await settle();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(largeExpand).not.toHaveBeenCalled();
  expect(smallExpand).not.toHaveBeenCalled();
  expect(largeExpanded).toBe(false);
});

describe('native size-loader capabilities', () => {
  function sizeLoader(options: { readonly enabled?: boolean; readonly hiddenFile?: boolean; readonly nativeHidden?: boolean; readonly callback?: () => boolean } = {}) {
    const path = options.hiddenFile === true ? 'src/first.test.ts' : 'src/main.ts';
    const files: readonly FileStats[] = [{ path, additions: 12, deletions: 2 }, { path: 'src/other.ts', additions: 1, deletions: 0 }];
    const { adapter, view } = fixture('gitlab', files);
    const genericExpand = vi.fn(() => true);
    const isExpanded = vi.fn(() => false);
    const load = vi.fn(options.callback ?? (() => true));
    let entries: readonly ProviderDiffEntry[] = [{ path, root: node('#visible'), anchor: 'visible', additions: 12, deletions: 2,
      expandLargeDiff: load, isExpanded, expand: genericExpand, collapse: () => true }];
    const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries, filteredPaths: new Set(options.nativeHidden === true ? [path] : []) }) }, {
      ...DEFAULT_SETTINGS, expandLargeDiffs: options.enabled ?? true,
    });
    return { path, view, controller, load, genericExpand, isExpanded, getEntry: () => entries[0], setEntries: (next: readonly ProviderDiffEntry[]) => { entries = next; } };
  }

  it('uses a verified loader below the classification threshold, once per physical root and path', async () => {
    const file = sizeLoader();
    await settle();
    expect(file.load).toHaveBeenCalledOnce();
    expect(file.genericExpand).not.toHaveBeenCalled();
    expect(file.isExpanded).not.toHaveBeenCalled();
    file.controller.requestRefresh();
    await settle();
    expect(file.load).toHaveBeenCalledOnce();
    const entry = file.getEntry();
    if (entry === undefined) throw new Error('Missing size-loader entry.');
    const replacement = document.createElement('article');
    entry.root.replaceWith(replacement);
    file.setEntries([{ ...entry, root: replacement }]);
    file.controller.requestRefresh();
    await settle();
    expect(file.load).toHaveBeenCalledTimes(2);
    expect(file.genericExpand).not.toHaveBeenCalled();
  });

  it('does not relaunch a successful request when a recycled root returns to an earlier path', async () => {
    const file = sizeLoader();
    await settle();
    const entry = file.getEntry();
    if (entry === undefined) throw new Error('Missing size-loader entry.');
    file.setEntries([{ ...entry, path: 'src/other.ts' }]);
    file.controller.requestRefresh();
    await settle();
    expect(file.load).toHaveBeenCalledTimes(2);
    file.setEntries([entry]);
    file.controller.requestRefresh();
    await settle();
    expect(file.load).toHaveBeenCalledTimes(2);
  });

  it('waits for a live eligible native control when the capability declines a request', async () => {
    let ready = false;
    const file = sizeLoader({ callback: () => ready });
    await settle();
    const attempts = file.load.mock.calls.length;
    expect(attempts).toBeGreaterThan(0);
    ready = true;
    file.controller.requestRefresh();
    await settle();
    expect(file.load).toHaveBeenCalledTimes(attempts + 1);
    file.controller.requestRefresh();
    await settle();
    expect(file.load).toHaveBeenCalledTimes(attempts + 1);
    expect(file.genericExpand).not.toHaveBeenCalled();
  });

  it.each([
    ['setting disabled', { enabled: false }],
    ['Geld-hidden file', { hiddenFile: true }],
    ['native-filtered file', { nativeHidden: true }],
  ] as const)('does not probe a loader for a %s', async (_label, options) => {
    const file = sizeLoader(options);
    await settle();
    expect(file.load).not.toHaveBeenCalled();
    expect(file.genericExpand).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'aria-hidden', 'inert', 'aria-disabled'] as const)('leaves a natively %s file untouched', async (attribute) => {
    const file = sizeLoader();
    const entry = file.getEntry();
    if (entry === undefined) throw new Error('Missing size-loader entry.');
    entry.root.setAttribute(attribute, attribute.startsWith('aria-') ? 'true' : '');
    await settle();
    expect(file.load).not.toHaveBeenCalled();
    expect(file.genericExpand).not.toHaveBeenCalled();
  });

  it('does not touch an unverified or detached native file even when the adapter offers a loader', async () => {
    const file = sizeLoader();
    const entry = file.getEntry();
    if (entry === undefined) throw new Error('Missing size-loader entry.');
    file.setEntries([{ ...entry, path: 'src/stale-native.ts' }]);
    await settle();
    expect(file.load).not.toHaveBeenCalled();
    file.setEntries([entry]);
    entry.root.remove();
    file.controller.requestRefresh();
    await settle();
    expect(file.load).not.toHaveBeenCalled();
  });
});

it.each([false, true])('Show expands native hidden files and remounted roots in inline/virtualized mode (%s)', async (virtualized) => {
  const { adapter, view } = fixture('gitlab', FILES);
  let expanded = true;
  const expand = vi.fn(() => { expanded = true; return true; });
  const collapse = vi.fn(() => { expanded = false; return true; });
  let current: ProviderDiffEntry = {
    path: 'src/first.test.ts', root: node('#hidden'), anchor: 'hidden', additions: 30, deletions: 10,
    isExpanded: () => expanded, expand, collapse,
  };
  const { controller } = start({ ...adapter, readDiff: () => ({ ...view, virtualized, entries: [current] }) }, {
    ...DEFAULT_SETTINGS, groupHidden: virtualized,
  });
  await settle();
  expect(collapse).toHaveBeenCalledTimes(1);
  expect(expanded).toBe(false);
  controller.toggleHidden();
  expect(controller.getTabState().expanded).toBe(true);
  expect(expand).toHaveBeenCalledTimes(1);
  expect(expanded).toBe(true);
  // Repeated rendering must not fight a user's manual collapse after Show.
  expanded = false;
  controller.requestRefresh();
  await settle();
  expect(expand).toHaveBeenCalledTimes(1);
  const replacement = document.createElement('article');
  current.root.replaceWith(replacement);
  current = { ...current, root: replacement };
  controller.requestRefresh();
  await settle();
  expect(expand).toHaveBeenCalledTimes(2);
  expect(expanded).toBe(true);
  controller.toggleHidden();
  expect(expanded).toBe(false);
  expect(collapse).toHaveBeenCalledTimes(2);
});

it('keeps full-source comment-excluded header and list counts stable when another file mounts lazily', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const files: readonly FileStats[] = [
    { path: 'src/main.ts', additions: 5, deletions: 2, commentLines: { added: [1, 2], removed: [1] } },
    { path: 'src/lazy.ts', additions: 7, deletions: 3, commentLines: { added: [10, 11, 12], removed: [10] } },
    { path: 'src/first.test.ts', additions: 30, deletions: 10 },
  ];
  const { adapter, view } = fixture('gitlab', files);
  const list = document.createElement('div');
  document.body.append(list);
  const entries: ProviderDiffEntry[] = [...view.entries];
  const { controller } = start({
    ...adapter,
    readDiff: () => ({ ...view, entries }),
    listRows: () => [{ root: list, host: list, author: 'alice', url: new URL('/reviews/1', window.location.href).href }],
  }, { ...DEFAULT_SETTINGS, hideCommentLines: true });
  // The essential lazy file and all its comment rows are absent from the DOM.
  await settle();
  expect(controller.getTabState().visible).toEqual({ files: 2, additions: 7, deletions: 3 });
  expect(node('#add').textContent).toBe('7 additions');
  expect(node('#del').textContent).toBe('3 deletions');
  expect(list.querySelector('.geld-provider-list-counts')?.textContent).toContain('+7 −3');
  const lazy = document.createElement('article');
  view.container.append(lazy);
  entries.push({ path: 'src/lazy.ts', root: lazy, anchor: null, additions: 7, deletions: 3, expand: () => true, collapse: () => true });
  document.dispatchEvent(new Event('DiffFileMounted'));
  await settle();
  expect(controller.getTabState().visible).toEqual({ files: 2, additions: 7, deletions: 3 });
  expect(node('#add').textContent).toBe('7 additions');
  expect(list.querySelector('.geld-provider-list-counts')?.textContent).toContain('+7 −3');
  controller.updateSettings({ ...DEFAULT_SETTINGS, hideCommentLines: false });
  await settle();
  expect(controller.getTabState().visible).toEqual({ files: 2, additions: 12, deletions: 5 });
  expect(node('#add').textContent).toBe('12 additions');
  expect(list.querySelector('.geld-provider-list-counts')?.textContent).toContain('+12 −5');
});

it('retries unconfirmed Viewed clicks but preserves manual unview after confirmation until a new visit', async () => {
  const { adapter, view } = fixture('gitlab', FILES);
  let readback: boolean | null = null;
  const markViewed = vi.fn(() => true);
  const entry: ProviderDiffEntry = {
    path: 'src/first.test.ts', root: node('#hidden'), anchor: 'hidden', additions: 30, deletions: 10,
    isViewed: () => readback, markViewed, expand: () => true, collapse: () => true,
  };
  const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries: [entry] }) }, {
    ...DEFAULT_SETTINGS, autoViewed: { tests: true },
  });
  await settle();
  expect(markViewed).not.toHaveBeenCalled(); // Native control is not hydrated yet.
  readback = false;
  controller.requestRefresh();
  await settle();
  expect(markViewed).toHaveBeenCalledTimes(1);
  controller.requestRefresh();
  await settle();
  expect(markViewed).toHaveBeenCalledTimes(1); // No immediate duplicate click.
  await vi.advanceTimersByTimeAsync(2_000);
  controller.requestRefresh();
  await settle();
  expect(markViewed).toHaveBeenCalledTimes(2); // Click succeeded but native state never persisted.
  readback = true;
  controller.requestRefresh();
  await settle();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(markViewed).toHaveBeenCalledTimes(2);
  readback = false;
  controller.requestRefresh();
  await vi.advanceTimersByTimeAsync(45_000);
  expect(markViewed).toHaveBeenCalledTimes(2);
  window.history.replaceState(null, '', '/reviews/2');
  controller.requestRefresh();
  await settle();
  expect(markViewed).toHaveBeenCalledTimes(3);
});


it('keeps positively observed native syntax independent of source-count loading and requires fresh evidence after disable/no view/stop', async ({ onTestFinished }) => {
  const registry = new Map<string, Set<AbstractRange>>();
  vi.stubGlobal('CSS', { highlights: registry });
  vi.stubGlobal('Highlight', class extends Set<AbstractRange> {});
  vi.stubGlobal('StaticRange', class { constructor(init: StaticRangeInit) { Object.assign(this, init); } });
  const request = deferred<ProviderDiffResult>();
  const { adapter, fetchDiff } = fixture('bitbucket', [], () => request.promise);
  const region = document.createElement('div');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Diff');
  const root = document.createElement('div');
  root.innerHTML = '<div id="chg-bitbucket-pipelines.yml"></div><article data-qa="branch-diff-file"></article>';
  const article = root.querySelector('article');
  if (article === null) throw new Error('Missing native article');
  const lines = ['demo: &demo', '  step:', '    script:', '      - if true; then echo "$V"; fi', 'next: true'];
  for (const [index, text] of lines.entries()) {
    const row = document.createElement('div');
    row.setAttribute('data-qa', 'code-line');
    row.innerHTML = `<span data-key="code-line-number" data-old-line-number="${index + 1}" data-new-line-number="${index + 1}"></span><span data-line-type=" "></span>`;
    const code = row.querySelector('[data-line-type]');
    if (code === null) throw new Error('Missing native code');
    code.textContent = text;
    article.append(row);
  }
  region.append(root);
  const originalUrl = window.location.href;onTestFinished(() => { window.location.href = originalUrl; });
  window.location.href = 'https://bitbucket.org/acme/widgets/pull-requests/1/diff';
  const bootstrap = document.createElement('meta');bootstrap.id = 'bb-bootstrap';bootstrap.dataset.geldUnitNativeSyntax = '';
  bootstrap.setAttribute('data-current-user', '{"isAuthenticated":false}');bootstrap.setAttribute('data-target-workspace-uuid', '02b941e3-cfaa-40f9-9a58-cec53e20bdc3');document.head.append(bootstrap);
  const tab = document.createElement('section');tab.setAttribute('role', 'tabpanel');tab.id = 'pull-request-tabs-1-tab';
  tab.innerHTML = '<button type="button" data-testid="settingsButton" aria-label="Open modal window: diff display settings">Settings</button>';tab.append(region);document.body.append(tab);
  // Explicit trusted-input/layout protocol, not public native Syntax-on evidence.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 80, 30));
  const qualify = async (): Promise<void> => {
    tab.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const dialog = document.createElement('section');dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<form><label for="diff-settings-syntax-highlighting-toggle">Syntax highlighting</label><input id="diff-settings-syntax-highlighting-toggle" name="enableSyntaxHighlighting" value="enableSyntaxHighlighting" type="checkbox" checked><button type="button">Cancel</button></form>';document.body.append(dialog);
    await settle();dialog.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));dialog.remove();await settle();
  };
  let available = true;
  const diffSyntax = createBitbucketDiffSyntax({ unitOnly: { trusted: () => true } });
  const currentPage = { ...page('bitbucket', '1'), diffPageUrl: window.location.href };
  const { controller } = start({ ...adapter, describe: () => currentPage, diffSyntax, readDiff: () => available ? readBitbucketDiff(document) : null }, { ...DEFAULT_SETTINGS, hideCommentLines: false, testOutline: false });
  await settle();
  expect(fetchDiff).toHaveBeenCalledOnce(); // Full counts remain pending throughout this test.
  expect(controller.getTabState().visible).toBeNull();
  expect(registry.has('geld-bitbucket-shell-keyword')).toBe(false);
  await qualify();expect(registry.get('geld-bitbucket-shell-keyword')?.size).toBeGreaterThan(0);expect(controller.getTabState().visible).toBeNull();expect(fetchDiff).toHaveBeenCalledOnce();
  const code = article.querySelector('[data-line-type]');if (code === null) throw new Error('Missing original native code');code.replaceWith(code.cloneNode(true));
  controller.requestRefresh();await settle();expect(registry.get('geld-bitbucket-shell-keyword')?.size).toBeGreaterThan(0);expect(fetchDiff).toHaveBeenCalledOnce();
  controller.updateSettings({ ...DEFAULT_SETTINGS, enabled: false });
  await settle();
  expect(registry.has('geld-bitbucket-shell-keyword')).toBe(false);
  controller.updateSettings(DEFAULT_SETTINGS);
  await settle();
  expect(registry.has('geld-bitbucket-shell-keyword')).toBe(false);await qualify();
  expect(registry.get('geld-bitbucket-shell-keyword')?.size).toBeGreaterThan(0);
  available = false;
  controller.requestRefresh();
  await settle();
  expect(registry.has('geld-bitbucket-shell-keyword')).toBe(false);
  available = true;
  controller.requestRefresh();
  await settle();
  expect(registry.has('geld-bitbucket-shell-keyword')).toBe(false);await qualify();
  expect(registry.get('geld-bitbucket-shell-keyword')?.size).toBeGreaterThan(0);
  controller.stop();
  expect([...registry.keys()].filter((key) => key.startsWith('geld-bitbucket-shell-'))).toEqual([]);
});


it('calls the optional provider syntax lifecycle through its adapter across views and navigation', async () => {
  const { adapter, view } = fixture('gitlab', FILES);
  const apply = vi.fn();
  const clear = vi.fn();
  let available = true;
  const { controller } = start({ ...adapter, readDiff: () => available ? view : null, diffSyntax: { apply, clear } });
  await settle();
  expect(apply).toHaveBeenCalledWith(view);
  const previousClears = clear.mock.calls.length;
  window.history.replaceState(null, '', '/reviews/2');
  controller.requestRefresh();
  await settle();
  expect(clear.mock.calls.length).toBeGreaterThan(previousClears);
  expect(apply).toHaveBeenLastCalledWith(view);
  available = false;
  apply.mockClear();
  controller.requestRefresh();
  await settle();
  expect(apply).not.toHaveBeenCalled();
  const beforeDisable = clear.mock.calls.length;
  controller.updateSettings({ ...DEFAULT_SETTINGS, enabled: false });
  await settle();
  expect(clear.mock.calls.length).toBeGreaterThan(beforeDisable);
  const beforeStop = clear.mock.calls.length;
  controller.stop();
  expect(clear.mock.calls.length).toBeGreaterThan(beforeStop);
});

it('resolves optional list-author identities with stats off while suppressing diff demand, scope exclusions and malformed-rule reads', async () => {
  const { adapter, fetchDiff } = fixture('bitbucket', FILES);const current = page('bitbucket', '1');
  document.body.innerHTML = `<section id="native-list"><article id="native-row"><a href="${current.url}">Native title</a><span id="metadata"></span></article></section>`;
  const root = node('#native-row');const host = node('#metadata');const key = 'bitbucket.org/uuid/7177c565-3bb4-44d3-b17b-e791dfb8fed8';
  const read = vi.fn<NonNullable<ProviderAdapter['fetchListAuthors']>>().mockResolvedValue([{ url: current.url, author: key, authorName: 'Albert Sundjaja' }]);
  const updated: ProviderAdapter = { ...adapter, describe: (url) => url.pathname === '/reviews/1' ? null : current, readDiff: () => null, headerTargets: () => [], listRows: () => [{ root, host, url: current.url, author: null }], fetchListAuthors: read };
  const { controller } = start(updated, { ...DEFAULT_SETTINGS, showListStats: false, hiddenAuthors: ['Albert Sundjaja'] });await settle();expect(read).not.toHaveBeenCalled();
  controller.updateSettings({ ...DEFAULT_SETTINGS, showListStats: false, hiddenAuthors: [key], repoRules: ['bitbucket.org/acme/widgets'] });await settle();expect(read).not.toHaveBeenCalled();
  controller.updateSettings({ ...DEFAULT_SETTINGS, showListStats: false, hiddenAuthors: [key] });await settle();
  expect(read).toHaveBeenCalledTimes(1);expect(root.hasAttribute('data-geld-provider-author-hidden')).toBe(true);expect(fetchDiff).not.toHaveBeenCalled();
  expect(document.querySelector('[data-geld-provider-author-note]')?.textContent).toContain('Albert Sundjaja');
  controller.updateSettings({ ...DEFAULT_SETTINGS, showListStats: false, hiddenAuthors: [] });await settle();expect(root.hasAttribute('data-geld-provider-author-hidden')).toBe(false);expect(read.mock.calls[0]?.[2].aborted).toBe(true);
});

describe('presentation-only settings preserve provider expansion choices', () => {
  function category(title: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.geld-provider-category-header')].find((node) => node.textContent?.startsWith(title));
    if (button === undefined) throw new Error(`Missing ${title} category`);
    return button;
  }
  function folder(name: string): HTMLButtonElement {
    const region = document.getElementById(category('Tests').getAttribute('aria-controls') ?? '');
    const button = [...region?.querySelectorAll<HTMLButtonElement>('.geld-provider-category-folder') ?? []].find((node) => node.querySelector('.geld-provider-category-folder-label')?.textContent === name);
    if (button === undefined) throw new Error(`Missing ${name} folder`);
    return button;
  }
  function current(): string | null {
    return document.querySelector('[data-geld-category-path] [aria-current="true"]')?.closest('[data-geld-category-path]')?.getAttribute('data-geld-category-path') ?? null;
  }
  function settings(outline: boolean): GeldSettings {
    return { ...DEFAULT_SETTINGS, hideCommentLines: false, testOutline: outline, categories: { tests: true, generated: false }, categoryPatterns: { tests: [], generated: [] } };
  }
  function next(previous: GeldSettings, change: string): GeldSettings {
    if (change === 'outline') return { ...previous, testOutline: !previous.testOutline };
    if (change === 'clone') return structuredClone(previous);
    return { ...previous, categories: { generated: false, tests: true }, categoryPatterns: { generated: [], tests: [] } };
  }
  function mountedSuites(root: HTMLElement): readonly ProviderDiffLine[] {
    // Adapter-contract protocol rows. Real category tree/controller/fold implementations run below.
    const body = document.createElement('tbody');const table = document.createElement('table');table.append(body);root.replaceChildren(table);
    return ['first', 'second', 'third'].flatMap((title, suite) => [`it('${title}', () => {`, '  expect(value).toBe(true);', '});'].map((text, index) => {
      const row = document.createElement('tr');const cell = document.createElement('td');cell.textContent = text;row.append(cell);body.append(row);
      return { root: row, kind: 'added', oldLine: null, oldText: null, newLine: suite * 3 + index + 1, newText: text };
    }));
  }

  for (const provider of PROVIDERS) for (const change of ['outline', 'clone', 'key order']) {
    it(`keeps the real ${provider} category, current file, folders and source presented after ${change} writes`, async () => {
      const { adapter, view, fetchDiff } = fixture(provider, FILES);
      const original = node('#hidden');const parent = original.parentElement;const lines = mountedSuites(original);
      const entries = view.entries.map((entry) => entry.root === original ? { ...entry, readLines: () => lines } : entry);
      const initial = settings(change !== 'outline');
      const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries }) }, initial);
      await settle();controller.revealPath('src/first.test.ts');folder('test').click();
      const header = category('Tests');const closedFolder = folder('test');const selectedFolder = folder('src');
      expect(header.getAttribute('aria-expanded')).toBe('true');expect(closedFolder.getAttribute('aria-expanded')).toBe('false');expect(selectedFolder.getAttribute('aria-expanded')).toBe('true');
      expect(current()).toBe('src/first.test.ts');expect(original.getAttribute('data-geld-provider-hidden')).toBe('open');
      controller.updateSettings(next(initial, change));await settle();
      expect(controller.getTabState().expanded).toBe(true);expect(category('Tests')).toBe(header);expect(header.getAttribute('aria-expanded')).toBe('true');expect(category('Essential').getAttribute('aria-expanded')).toBe('false');
      expect(folder('test')).toBe(closedFolder);expect(closedFolder.getAttribute('aria-expanded')).toBe('false');expect(folder('src')).toBe(selectedFolder);expect(selectedFolder.getAttribute('aria-expanded')).toBe('true');expect(current()).toBe('src/first.test.ts');
      expect(original.parentElement).toBe(parent);expect(original.id).toBe('hidden');expect(original.getAttribute('data-geld-provider-hidden')).toBe('open');expect(original.hidden).toBe(false);
      expect(original.querySelectorAll('[data-geld-provider-fold-row^="test:"]')).toHaveLength(3);expect(fetchDiff).toHaveBeenCalledOnce();
      if (change === 'outline') { controller.updateSettings(initial);await settle();expect(original.querySelectorAll('[data-geld-provider-fold-row^="test:"]')).toHaveLength(0);expect(controller.getTabState().expanded).toBe(true);expect(original.getAttribute('data-geld-provider-hidden')).toBe('open');expect(current()).toBe('src/first.test.ts');expect(folder('test').getAttribute('aria-expanded')).toBe('false'); }
    });

    it(`keeps explicit ${provider} inline ownership after ${change} writes`, async () => {
      const { adapter, view, fetchDiff } = fixture(provider, FILES);const original = node('#hidden');let expanded = true;
      const collapse = vi.fn(() => { expanded = false;return true; });
      const entries = view.entries.map((entry) => entry.root === original ? { ...entry, isExpanded: () => expanded, expand: () => { expanded = true;return true; }, collapse } : entry);
      const initial = { ...settings(change !== 'outline'), groupHidden: false };
      const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries }) }, initial);
      await settle();expect(expanded).toBe(false);controller.revealPath('src/first.test.ts');expect(expanded).toBe(true);expect(collapse).toHaveBeenCalledOnce();
      controller.updateSettings(next(initial, change));await settle();
      expect(expanded).toBe(true);expect(collapse).toHaveBeenCalledOnce();expect(original.getAttribute('data-geld-provider-inline')).toBe('');expect(controller.getTabState().expanded).toBe(false);expect(fetchDiff).toHaveBeenCalledOnce();
    });
  }

  for (const provider of PROVIDERS) {
    it(`still resets ${provider} explicit expansion for classification, layout, defaults and master changes`, async () => {
      const { adapter, fetchDiff } = fixture(provider, FILES);const initial = settings(false);const { controller } = start(adapter, initial);
      await settle();controller.revealPath('src/first.test.ts');expect(controller.getTabState().expanded).toBe(true);
      const classified = { ...initial, categoryPatterns: { ...initial.categoryPatterns, tests: ['new-classification-pattern/**'] } };
      controller.updateSettings(classified);await settle();expect(controller.getTabState().expanded).toBe(false);expect(node('#hidden').getAttribute('data-geld-provider-hidden')).toBe('closed');
      controller.revealPath('src/first.test.ts');controller.updateSettings({ ...classified, groupHidden: false });await settle();expect(controller.getTabState().expanded).toBe(false);expect(node('#hidden').hasAttribute('data-geld-provider-inline')).toBe(true);
      controller.updateSettings(classified);await settle();controller.toggleHidden();controller.toggleHidden();expect(controller.getTabState().expanded).toBe(false);
      controller.updateSettings({ ...classified, expandedByDefault: true });await settle();expect(controller.getTabState().expanded).toBe(true);
      controller.updateSettings(classified);await settle();expect(controller.getTabState().expanded).toBe(false);
      controller.revealPath('src/first.test.ts');controller.updateSettings({ ...classified, enabled: false });await settle();expect(node('#hidden').hasAttribute('data-geld-provider-hidden')).toBe(false);
      controller.updateSettings(classified);await settle();expect(controller.getTabState().expanded).toBe(false);expect(node('#hidden').getAttribute('data-geld-provider-hidden')).toBe('closed');expect(fetchDiff).toHaveBeenCalledOnce();
    });
  }

  it.each(PROVIDERS)('still releases %s inline ownership on classification, defaults, layout and master changes', async (provider) => {
    const { adapter, view, fetchDiff } = fixture(provider, FILES);const original = node('#hidden');let expanded = true;
    const collapse = vi.fn(() => { expanded = false;return true; });
    const entries = view.entries.map((entry) => entry.root === original ? { ...entry, isExpanded: () => expanded, expand: () => { expanded = true;return true; }, collapse } : entry);
    const initial = { ...settings(false), groupHidden: false };
    const { controller } = start({ ...adapter, readDiff: () => ({ ...view, entries }) }, initial);
    await settle();controller.revealPath('src/first.test.ts');expect(expanded).toBe(true);
    const classified = { ...initial, categoryPatterns: { ...initial.categoryPatterns, tests: ['another-pattern/**'] } };
    controller.updateSettings(classified);await settle();expect(expanded).toBe(false);expect(collapse).toHaveBeenCalledTimes(2);
    controller.revealPath('src/first.test.ts');controller.updateSettings({ ...classified, expandedByDefault: true });await settle();expect(expanded).toBe(true);
    controller.updateSettings(classified);await settle();expect(expanded).toBe(false);
    controller.revealPath('src/first.test.ts');controller.updateSettings({ ...classified, groupHidden: true });await settle();expect(original.getAttribute('data-geld-provider-hidden')).toBe('closed');
    controller.updateSettings(classified);await settle();expect(expanded).toBe(false);
    controller.revealPath('src/first.test.ts');controller.updateSettings({ ...classified, enabled: false });await settle();
    controller.updateSettings(classified);await settle();expect(expanded).toBe(false);expect(fetchDiff).toHaveBeenCalledOnce();
  });

});


it.each(PROVIDERS)('keeps %s Flow out of the inactive conversation pane on the diff tab', async provider => {
  const { adapter, view } = fixture(provider, FILES);
  const conversation = document.createElement('section');conversation.style.display = 'none';document.body.append(conversation);
  const actions = document.querySelector('header');if (actions === null) throw new Error('Missing actions');
  let kind: 'overview' | 'diff' = 'diff';
  const { controller } = start({ ...adapter, describe: () => ({ ...page(provider, '1'), kind }), reviewHost: () => conversation, actionHost: () => actions });
  await settle();
  expect(actions.querySelector('.geld-provider-flow-button')).not.toBeNull();
  expect(conversation.querySelector('.geld-provider-flow-button')).toBeNull();
  view.container.style.display = 'none';conversation.style.display = '';kind = 'overview';
  controller.requestRefresh();await settle();
  expect(actions.querySelector('.geld-provider-flow-button')).toBeNull();
  expect(conversation.querySelector('.geld-provider-flow-button')).not.toBeNull();
  expect(document.querySelectorAll('.geld-provider-flow-button')).toHaveLength(1);
});

it('keeps Flow in the diff container when the provider has no action host', async () => {
  const { adapter, view } = fixture('gitlab', FILES);
  const conversation = document.createElement('section');conversation.hidden = true;document.body.append(conversation);
  start({ ...adapter, reviewHost: () => conversation });await settle();
  expect(view.container.querySelector('.geld-provider-flow-button')).not.toBeNull();
  expect(conversation.querySelector('.geld-provider-flow-button')).toBeNull();
});
