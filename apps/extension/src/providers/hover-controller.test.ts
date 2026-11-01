// @vitest-environment happy-dom
import type { FileStats, GeldSettings } from '@geld/core';
import { BUNDLED_CATALOG, DEFAULT_SETTINGS } from '@geld/core';
import { ProviderController } from './controller';
import { ProviderRepoConfigSource } from './repo-config';
import type { ProviderAdapter, ProviderDiffEntry, ProviderDiffResult, ProviderDiffView, ProviderReviewPage } from './types';

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: <T>(_key: string, options: { readonly fallback: T }) => ({
      getValue: async () => options.fallback,
      setValue: async (_value: T) => undefined,
      watch: () => () => undefined,
    }),
  },
}));

const SHA = 'c'.repeat(40);
const ROOT = 'https://gitlab.com/group/repo/-/merge_requests';
const running: ProviderController[] = [];
const FILES: readonly FileStats[] = [
  { path: 'src/fix.ts', additions: 4, deletions: 1 },
  { path: 'src/fix.test.ts', additions: 3, deletions: 0 },
];

function node(selector: string): HTMLElement {
  const value = document.querySelector<HTMLElement>(selector);
  if (value === null) throw new Error(`Missing fixture ${selector}`);
  return value;
}

function page(number = '7'): ProviderReviewPage {
  const url = `${ROOT}/${number}`;
  return {
    provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/repo' },
    number, url, diffUrl: `${url}.diff`, diffPageUrl: `${url}/diffs`, kind: 'diff', headSha: SHA, version: number,
  };
}

function fixture(fetchDiff: ProviderAdapter['fetchDiff'] = async () => ({ files: FILES, complete: true, revision: SHA })): ProviderAdapter {
  document.body.innerHTML = `<header><span id="add" title="Native additions">7 additions</span><span id="del">1 deletion</span><span id="files">2 files</span></header><main id="diff"><article id="code">src/fix.ts</article><article id="test">src/fix.test.ts</article></main>`;
  for (const selector of ['#add', '#del', '#files']) vi.spyOn(node(selector), 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 60, 120, 20));
  return {
    id: 'gitlab',
    describe: (url) => {
      const number = /\/-\/merge_requests\/(\d+)/.exec(url.pathname)?.[1];
      return number === undefined ? null : page(number);
    },
    readDiff: () => ({
      kind: 'fixture', container: node('#diff'), virtualized: false, filteredPaths: new Set(), treeHost: null, tree: [],
      entries: [
        { path: 'src/fix.ts', root: node('#code'), anchor: 'code', additions: 4, deletions: 1, expand: () => true, collapse: () => true },
        { path: 'src/fix.test.ts', root: node('#test'), anchor: 'test', additions: 3, deletions: 0, expand: () => true, collapse: () => true },
      ],
    }),
    headerTargets: () => [{ additions: node('#add'), deletions: node('#del'), files: node('#files') }],
    listRows: () => [], fetchDiff,
  };
}

function start(adapter: ProviderAdapter, settings: GeldSettings = DEFAULT_SETTINGS, configs: ProviderRepoConfigSource | null = null): ProviderController {
  const controller = new ProviderController(adapter, settings, () => undefined, BUNDLED_CATALOG, configs);
  running.push(controller);
  controller.start();
  return controller;
}

function hover(host: HTMLElement): void { host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientY: 65 })); }
function tooltip(): HTMLElement | null { return document.getElementById('geld-provider-count-tooltip'); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('IntersectionObserver', undefined);
  window.location.href = page().diffPageUrl;
});

afterEach(() => {
  for (const controller of running.splice(0)) controller.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('provider controller count hover integration', () => {
  it('updates an open native header tooltip from loading to the same complete category totals shown in the page', async () => {
    let complete: ((value: ProviderDiffResult) => void) | null = null;
    const pending = new Promise<ProviderDiffResult>((resolve) => { complete = resolve; });
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>(() => pending);
    const controller = start(fixture(fetchDiff));
    const host = node('#add');
    expect(host.hasAttribute('tabindex')).toBe(false);
    hover(host);
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.textContent).toBe('Counting changes…');
    expect(host.textContent).toBe('7 additions');
    if (complete === null) throw new Error('Missing request resolver');
    const resolve: (value: ProviderDiffResult) => void = complete;
    resolve({ files: FILES, complete: true, revision: SHA });
    await vi.advanceTimersByTimeAsync(120);
    expect(controller.getTabState().visible?.additions).toBe(4);
    expect(host.textContent).toBe('4 additions');
    expect(tooltip()?.hidden).toBe(false);
    expect(tooltip()?.textContent).toContain('Essential 1 file +4 −1');
    expect(tooltip()?.textContent).toContain('Tests 1 file +3 −0');
    expect(tooltip()?.textContent).toContain('Total 2 files +7 −1');
    expect(fetchDiff).toHaveBeenCalledOnce();
    controller.stop();
    expect(host.textContent).toBe('7 additions');
    expect(host.title).toBe('Native additions');
    expect(host.hasAttribute('aria-describedby')).toBe(false);
    expect(host.hasAttribute('data-geld-hover-bound')).toBe(false);
    expect(tooltip()).toBeNull();
  });

  it('updates a loading header to unavailable without substituting zero counts or losing its active tooltip', async () => {
    let rejectRequest: ((reason: Error) => void) | null = null;
    const pending = new Promise<ProviderDiffResult>((_resolve, reject) => { rejectRequest = reject; });
    start(fixture(async () => pending));
    hover(node('#add'));
    await vi.advanceTimersByTimeAsync(150);
    if (rejectRequest === null) throw new Error('Missing request rejecter');
    const reject: (reason: Error) => void = rejectRequest;
    reject(new Error('HTTP 403'));
    await vi.advanceTimersByTimeAsync(120);
    expect(tooltip()?.hidden).toBe(false);
    expect(tooltip()?.textContent).toContain('HTTP 403');
    expect(tooltip()?.textContent).not.toContain('+0');
    expect(node('#add').textContent).toBe('7 additions');
  });

  it('uses the native Changes link for pointer and keyboard hover while synchronizing spoken counts', async () => {
    const base = fixture();
    document.body.insertAdjacentHTML('afterbegin', '<a id="changes" href="#diff"><span id="badge" style="pointer-events:none">2 files</span></a>');
    node('#add').setAttribute('aria-label', 'Added 7 lines.');
    vi.spyOn(node('#changes'), 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 70, 100, 24));
    const controller = start({ ...base, headerTargets: () => [{ additions: node('#add'), deletions: node('#del'), files: node('#badge'), hoverHosts: [node('#changes')], labels: [{ host: node('#add'), attribute: 'aria-label', count: 'additions' }] }] });
    await vi.advanceTimersByTimeAsync(120);
    expect(node('#badge').textContent).toBe('1 file');
    expect(node('#add').getAttribute('aria-label')).toBe('Added 4 lines.');
    hover(node('#changes'));
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.hidden).toBe(false);
    expect(tooltip()?.textContent).toContain('Essential 1 file +4 −1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    node('#changes').dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    node('#changes').focus();
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.hidden).toBe(false);
    expect(node('#changes').getAttribute('aria-describedby')).toBe('geld-provider-count-tooltip');
    controller.stop();
    expect(node('#add').getAttribute('aria-label')).toBe('Added 7 lines.');
    expect(node('#changes').hasAttribute('aria-describedby')).toBe(false);
  });

  it('binds a list chip to its own row totals and removes focus/tooltip ownership when list stats are disabled', async () => {
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>(async (request) => ({
      complete: true, revision: SHA,
      files: 'number' in request && request.number === '8' ? [{ path: 'src/other.ts', additions: 10, deletions: 2 }, { path: 'src/other.test.ts', additions: 1, deletions: 0 }] : FILES,
    }));
    const base = fixture(fetchDiff);
    document.body.insertAdjacentHTML('beforeend', '<article id="row"><div id="row-meta"></div></article>');
    const adapter: ProviderAdapter = { ...base, listRows: () => [{ root: node('#row'), host: node('#row-meta'), url: page('8').url, author: 'reviewer' }] };
    const controller = start(adapter);
    await vi.advanceTimersByTimeAsync(1200);
    const chip = node('.geld-provider-list-counts');
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 160, 20));
    expect(chip.tabIndex).toBe(0);
    hover(chip);
    await vi.advanceTimersByTimeAsync(150);
    expect(tooltip()?.textContent).toContain('Essential 1 file +10 −2');
    expect(tooltip()?.textContent).toContain('Total 2 files +11 −2');
    expect(fetchDiff).toHaveBeenCalledTimes(2);
    controller.updateSettings({ ...DEFAULT_SETTINGS, showListStats: false });
    await vi.advanceTimersByTimeAsync(120);
    expect(chip.isConnected).toBe(false);
    expect(chip.hasAttribute('tabindex')).toBe(false);
    expect(chip.hasAttribute('aria-describedby')).toBe(false);
    expect(tooltip()?.hidden).toBe(true);
  });

  it('does not fetch config or diff data for an adapter with no verified page surfaces', async () => {
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>(async () => ({ files: FILES, complete: true, revision: SHA }));
    const base = fixture(fetchDiff);
    const adapter: ProviderAdapter = { ...base, readDiff: () => null, headerTargets: () => [] };
    const fetchConfig = vi.fn(async () => ({ repository: page().repository, ref: SHA, files: [] }));
    const configs = new ProviderRepoConfigSource(fetchConfig, () => undefined);
    const getConfig = vi.spyOn(configs, 'get');
    const controller = start(adapter, { ...DEFAULT_SETTINGS, repoConfigs: 'always' }, configs);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchDiff).not.toHaveBeenCalled();
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(getConfig).not.toHaveBeenCalled();
    expect(controller.getTabState().hasDiff).toBe(false);
    expect(document.querySelector('[data-geld-hover-bound]')).toBeNull();
  });

  it('retains a reveal request until native single-file navigation mounts the hidden file', async () => {
    const base = fixture(async () => ({ files: [{ path: 'src/fix.ts', additions: 4, deletions: 1 }, { path: 'src/lazy.test.ts', additions: 2, deletions: 0 }], complete: true, revision: SHA }));
    node('#test').remove();
    const link = document.createElement('a');
    link.href = `${window.location.href}?file_path=src%2Flazy.test.ts`;
    link.textContent = 'src/lazy.test.ts';
    const click = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', click);
    document.body.append(link);
    const entries: ProviderDiffEntry[] = [{ path: 'src/fix.ts', root: node('#code'), anchor: 'code', additions: 4, deletions: 1, expand: () => true, collapse: () => true }];
    const view: ProviderDiffView = { kind: 'single-file-fixture', container: node('#diff'), entries, tree: [{ path: 'src/lazy.test.ts', root: link, link }], treeHost: null, filteredPaths: new Set(), virtualized: true };
    const controller = start({ ...base, readDiff: () => view });
    await vi.advanceTimersByTimeAsync(120);
    controller.revealPath('src/lazy.test.ts');
    expect(click).toHaveBeenCalledOnce();
    expect(controller.getTabState().expanded).toBe(true);
    const mounted = document.createElement('article');
    view.container.append(mounted);
    const scroll = vi.spyOn(mounted, 'scrollIntoView').mockImplementation(() => undefined);
    let expanded = false;
    entries.push({ path: 'src/lazy.test.ts', root: mounted, anchor: 'native-hash', additions: 2, deletions: 0, isExpanded: () => expanded, expand: () => { expanded = true; return true; }, collapse: () => { expanded = false; return true; } });
    document.dispatchEvent(new Event('DiffFileMounted'));
    await vi.advanceTimersByTimeAsync(120);
    expect(expanded).toBe(true);
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'smooth' });
    expect(controller.getTabState().expanded).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(scroll).toHaveBeenCalledOnce();
  });
});
