// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BUNDLED_CATALOG, DEFAULT_SETTINGS } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import { ProviderController } from './controller';
import type { ProviderAdapter, ProviderDiffView, ProviderPage, ReviewProvider } from './types';

vi.mock('wxt/utils/storage', () => ({ storage: {
  defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }),
  getItem: async () => null, setItem: async () => undefined, watch: () => () => undefined,
} }));
const controllers: ProviderController[] = [];
const settings: GeldSettings = { ...DEFAULT_SETTINGS, testOutline: false, prOverview: false, quickReview: false };

function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing test fixture'); return value; }
function nativeHeader(additions = 7): HTMLElement {
  const header = document.createElement('header');
  header.id = 'header';
  header.innerHTML = `<span id="add" aria-label="Added ${additions} lines.">${additions} additions</span><span id="del">0 deletions</span><span id="files" title="2 files changed">2 files changed</span><div id="summary"></div>`;
  return header;
}
async function fixture(options: { readonly provider?: ReviewProvider; readonly unknownHead?: boolean; readonly namedCompare?: boolean } = {}) {
  const provider = options.provider ?? 'gitlab';
  let head = options.unknownHead === true ? null : 'a'.repeat(40);
  let filtered: ReadonlySet<string> = new Set();
  document.body.append(nativeHeader(), document.createElement('main'));
  const describe = (url: URL): ProviderPage => {
    const origin = provider === 'gitlab' ? 'https://gitlab.com' : 'https://bitbucket.org';
    const repository = { provider, origin, path: 'acme/widgets' };
    if (options.namedCompare === true) {
      const compare = `${origin}/acme/widgets/-/compare/main...${'a'.repeat(40)}`;
      return { provider, repository, kind: 'compare', from: 'main', to: 'a'.repeat(40), straight: false, headSha: head, version: 'named-main', url: compare, diffPageUrl: compare, diffUrl: `${compare}?format=diff` };
    }
    const base = provider === 'gitlab' ? `${origin}/acme/widgets/-/merge_requests/42` : `${origin}/acme/widgets/pull-requests/42`;
    return { provider, repository, number: '42', kind: 'diff', url: base, diffPageUrl: `${base}/diffs${url.search}`, diffUrl: `${base}.diff`, headSha: head, version: url.search };
  };
  const view: ProviderDiffView = { kind: 'fixture', container: required(document.querySelector('main')), entries: [], tree: [], treeHost: null, filteredPaths: new Set(), virtualized: false };
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>(async () => ({ complete: true, revision: `${'b'.repeat(40)}..${'a'.repeat(40)}`, files: [{ path: 'src/main.ts', additions: 2, deletions: 0 }, { path: 'spec/unit.test.ts', additions: 5, deletions: 0 }] }));
  const readDiff = vi.fn(() => ({ ...view, filteredPaths: filtered }));
  const adapter: ProviderAdapter = {
    id: provider, describe, readDiff, fetchDiff, listRows: () => [],
    headerTargets: () => [{ additions: document.getElementById('add'), deletions: document.getElementById('del'), files: document.getElementById('files'), accessibleSummaryHost: required(document.getElementById('summary')),
      labels: [{ host: required(document.getElementById('add')), attribute: 'aria-label', count: 'additions' }, { host: required(document.getElementById('files')), attribute: 'title', count: 'files' }] }],
  };
  const controller = new ProviderController(adapter, settings, () => undefined);
  controllers.push(controller); controller.start();
  await vi.advanceTimersByTimeAsync(200);
  expect(controller.getTabState().visible).toEqual({ files: 1, additions: 2, deletions: 0 });
  expect(fetchDiff).toHaveBeenCalledTimes(1);
  return { controller, fetchDiff, readDiff, changeHead: () => { head = 'c'.repeat(40); }, filterMain: () => { filtered = new Set(['src/main.ts']); } };
}
function remount(additions = 7): void { required(document.getElementById('header')).replaceWith(nativeHeader(additions)); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  window.history.replaceState(null, '', '/review/42?diff_id=1');
  document.body.replaceChildren();
});
afterEach(() => { for (const controller of controllers) controller.stop(); controllers.length = 0; document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('rewrites remounted native text, labels and accessible summary in the mutation phase before the next paint', async () => {
  const { fetchDiff } = await fixture();
  const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => { throw new Error('Header fast path must not measure layout'); });
  remount();
  let painted: string | null = null;
  requestAnimationFrame(() => { painted = document.getElementById('add')?.textContent ?? null; });
  await vi.advanceTimersByTimeAsync(20); // Normal provider apply is still debounced until 60ms.
  expect(painted).toBe('2 additions');
  expect(document.getElementById('add')?.getAttribute('aria-label')).toBe('Added 2 lines.');
  expect(document.getElementById('files')?.textContent).toBe('1 file changed');
  expect(document.getElementById('files')?.getAttribute('title')).toBe('1 file changed');
  expect(document.querySelector('#summary .geld-provider-accessible-counts')?.textContent).toBe('1 file changed. Added 2 lines. Removed 0 lines.');
  expect(fetchDiff).toHaveBeenCalledTimes(1);
  expect(geometry).not.toHaveBeenCalled();
});

it('keeps synchronous writes idempotent when the native framework repeatedly restores its own count text', async () => {
  const { fetchDiff } = await fixture();
  for (let index = 0; index < 3; index += 1) {
    required(document.getElementById('add')).firstChild?.replaceWith(document.createTextNode('7 additions'));
    await vi.advanceTimersByTimeAsync(1);
    expect(document.getElementById('add')?.textContent).toBe('2 additions');
  }
  expect(fetchDiff).toHaveBeenCalledTimes(1);
});

it('does not rescan the native diff for streamed line mutations while header counters are unchanged', async () => {
  const { readDiff, fetchDiff } = await fixture();
  readDiff.mockClear();
  for (let i = 0; i < 20; i += 1) {
    const line = document.createElement('div');
    line.textContent = `Streamed native line ${i}`;
    document.querySelector('main')?.append(line);
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(readDiff).not.toHaveBeenCalled();
  expect(fetchDiff).toHaveBeenCalledOnce();
  required(document.getElementById('add')).textContent = '7 additions';
  await vi.advanceTimersByTimeAsync(1);
  expect(document.getElementById('add')?.textContent).toBe('2 additions');
  expect(readDiff).toHaveBeenCalledOnce();
});

it.each(['head', 'selected-version'])('does not reuse settled totals when the live native %s changes before the normal SPA pass', async (change) => {
  const { changeHead, fetchDiff } = await fixture();
  if (change === 'head') changeHead();
  else window.history.replaceState(null, '', '/review/42?diff_id=2');
  remount(13);
  await vi.advanceTimersByTimeAsync(20);
  expect(document.getElementById('add')?.textContent).toBe('13 additions');
  expect(fetchDiff).toHaveBeenCalledTimes(1);
});

it.each([{ provider: 'bitbucket', unknownHead: true }, { provider: 'gitlab', namedCompare: true }] as const)('does not apply a prepaint snapshot to mutable/unknown subject $provider', async (options) => {
  await fixture(options);
  remount(13);
  await vi.advanceTimersByTimeAsync(20);
  expect(document.getElementById('add')?.textContent).toBe('13 additions');
});

it('skips stale filtered totals and lets the normal pass derive the new native filter result', async () => {
  const { controller, filterMain, fetchDiff } = await fixture();
  filterMain(); remount();
  await vi.advanceTimersByTimeAsync(20);
  expect(document.getElementById('add')?.textContent).toBe('7 additions');
  await vi.advanceTimersByTimeAsync(100);
  expect(controller.getTabState().visible).toEqual({ files: 0, additions: 0, deletions: 0 });
  expect(document.getElementById('add')?.textContent).toBe('0 additions');
  expect(fetchDiff).toHaveBeenCalledTimes(1);
});

it.each(['settings', 'catalog', 'choices', 'external-refresh'])('invalidates the prepaint snapshot immediately for a pending %s change', async (change) => {
  const { controller } = await fixture();
  if (change === 'settings') controller.updateSettings({ ...settings, categories: { tests: false } });
  if (change === 'catalog') controller.updateCatalog({ ...BUNDLED_CATALOG, version: BUNDLED_CATALOG.version + 1 });
  if (change === 'choices') controller.updateRepoChoices({ 'gitlab/acme/widgets': 'ignore' });
  if (change === 'external-refresh') controller.requestRefresh();
  remount(13);
  await vi.advanceTimersByTimeAsync(20);
  expect(document.getElementById('add')?.textContent).toBe('13 additions');
});
