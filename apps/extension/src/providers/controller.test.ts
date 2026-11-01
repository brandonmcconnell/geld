// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { FileStats, GeldSettings } from '@geld/core';
import type { TabState } from '../lib/messages';
import { ProviderController } from './controller';
import type { ProviderAdapter, ProviderDiffEntry, ProviderDiffResult, ProviderDiffView, ProviderReviewPage, ProviderCommitPage, ReviewProvider } from './types';

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
});

async function settle(): Promise<void> { await vi.advanceTimersByTimeAsync(120); }

describe('provider controller behavior', () => {
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

it('preserves manually collapsed visible files across refreshes with expandLargeDiffs enabled', async () => {
  const files: readonly FileStats[] = [
    { path: 'src/main.ts', additions: 12, deletions: 2 },
    { path: 'src/large.ts', additions: 1200, deletions: 1 },
  ];
  const { adapter, view } = fixture('gitlab', files);
  let largeExpanded = true;
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
  // Once Geld observed a large file open, a later manual collapse belongs to the user.
  largeExpanded = false;
  controller.requestRefresh();
  await settle();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(largeExpand).not.toHaveBeenCalled();
  expect(smallExpand).not.toHaveBeenCalled();
  expect(largeExpanded).toBe(false);
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

it('retries Viewed when native readback does not confirm a click and stops after confirmation', async () => {
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
});
