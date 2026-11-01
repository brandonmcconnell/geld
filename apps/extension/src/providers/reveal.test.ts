// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderDiffEntry, ProviderDiffView } from './types';
import { ProviderReveal } from './reveal';

let reveal: ProviderReveal | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  window.history.replaceState(null, '', '/group/sub/project/-/merge_requests/42/diffs?diff_id=123&view=parallel&w=1');
});
afterEach(() => { reveal?.stop(); reveal = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren(); });

function fixture(): { readonly view: ProviderDiffView; readonly entries: ProviderDiffEntry[]; readonly link: HTMLAnchorElement } {
  const container = document.createElement('div');
  const link = document.createElement('a');
  link.href = `${window.location.href}&file_path=${encodeURIComponent('src/lazy.ts')}#native-file-hash`;
  link.addEventListener('click', (event) => event.preventDefault());
  document.body.append(container, link);
  const entries: ProviderDiffEntry[] = [];
  return { entries, link, view: { kind: 'native-fixture', container, entries, tree: [{ path: 'src/lazy.ts', root: link, link }], treeHost: null, filteredPaths: new Set(), virtualized: true } };
}

it('waits for native tree navigation and streamed controls, then expands and scrolls the mounted file once', async () => {
  const { view, entries, link } = fixture();
  const click = vi.fn();
  link.addEventListener('click', click);
  reveal = new ProviderReveal(() => view, () => 'review-version-123');
  reveal.request('src/lazy.ts');
  expect(click).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(500);
  expect(click).toHaveBeenCalledTimes(1);
  const root = document.createElement('article');
  view.container.append(root);
  const scroll = vi.spyOn(root, 'scrollIntoView').mockImplementation(() => undefined);
  let hydrated = false;
  let expanded = false;
  const expand = vi.fn(() => { if (!hydrated) return false; expanded = true; return true; });
  entries.push({ path: 'src/lazy.ts', root, anchor: 'native-file-hash', additions: null, deletions: null, isExpanded: () => expanded, expand, collapse: () => false });
  reveal.refresh();
  expect(scroll).not.toHaveBeenCalled();
  hydrated = true;
  reveal.refresh();
  expect(expanded).toBe(true);
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'smooth' });
  await vi.advanceTimersByTimeAsync(20_000);
  reveal.refresh();
  expect(scroll).toHaveBeenCalledTimes(1);
});

it('discards stale reveal intent when the selected review changes before a file mounts', async () => {
  const { view, entries } = fixture();
  let visit = 'old-version';
  reveal = new ProviderReveal(() => view, () => visit);
  reveal.request('src/lazy.ts');
  visit = 'new-version';
  const root = document.createElement('article');
  view.container.append(root);
  const expand = vi.fn(() => true);
  const scroll = vi.spyOn(root, 'scrollIntoView').mockImplementation(() => undefined);
  entries.push({ path: 'src/lazy.ts', root, anchor: null, additions: null, deletions: null, expand, collapse: () => false });
  await vi.advanceTimersByTimeAsync(500);
  expect(expand).not.toHaveBeenCalled();
  expect(scroll).not.toHaveBeenCalled();
});

it('uses a verified provider navigation fallback once when the native tree row is recycled', async () => {
  const { view, entries } = fixture();
  const navigateToPath = vi.fn(() => true);
  reveal = new ProviderReveal(() => ({ ...view, tree: [], navigateToPath }), () => 'same-visit');
  reveal.request('src/lazy.ts');
  await vi.advanceTimersByTimeAsync(1000);
  expect(navigateToPath).toHaveBeenCalledExactlyOnceWith('src/lazy.ts');
  const root = document.createElement('article');
  view.container.append(root);
  const scroll = vi.spyOn(root, 'scrollIntoView').mockImplementation(() => undefined);
  entries.push({ path: 'src/lazy.ts', root, anchor: null, additions: null, deletions: null, isExpanded: () => true, expand: () => true, collapse: () => false });
  reveal.refresh();
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(navigateToPath).toHaveBeenCalledTimes(1);
});

it.each(['https://foreign.example/review', '/group/sub/project/-/merge_requests/42/diffs?file_path=src%2Flazy.ts', '/group/sub/project/-/merge_requests/42/diffs?diff_id=123&view=parallel&w=1&file_path=src%2Fother.ts'])('does not follow a stale or foreign tree link (%s)', async (href) => {
  const { view, link } = fixture();
  link.href = href;
  const click = vi.fn();
  link.addEventListener('click', click);
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  await vi.advanceTimersByTimeAsync(16_000);
  expect(click).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('does no hidden-tab work and never replays after stop', async () => {
  const { view, link } = fixture();
  let hidden = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const click = vi.fn();
  link.addEventListener('click', click);
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  await vi.advanceTimersByTimeAsync(500);
  expect(click).not.toHaveBeenCalled();
  reveal.stop();
  hidden = false;
  reveal.refresh();
  reveal.request('src/lazy.ts');
  await vi.advanceTimersByTimeAsync(20_000);
  expect(click).not.toHaveBeenCalled();
});

it('waits for asynchronous native expansion readback without clicking the control on every mutation', () => {
  const { view, entries } = fixture();
  const root = document.createElement('article');
  view.container.append(root);
  let expanded = false;
  const expand = vi.fn(() => true);
  const scroll = vi.spyOn(root, 'scrollIntoView').mockImplementation(() => undefined);
  entries.push({ path: 'src/lazy.ts', root, anchor: null, additions: null, deletions: null, isExpanded: () => expanded, expand, collapse: () => false });
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  reveal.refresh();
  reveal.refresh();
  expect(expand).toHaveBeenCalledTimes(1);
  expect(scroll).not.toHaveBeenCalled();
  expanded = true;
  reveal.refresh();
  expect(expand).toHaveBeenCalledTimes(1);
  expect(scroll).toHaveBeenCalledTimes(1);
});

it('prepares a lazy native placeholder once, then waits for genuine mounted expansion before completing', () => {
  const { view, entries } = fixture();
  const root = document.createElement('div');
  view.container.append(root);
  let hydrated = false;
  const prepareReveal = vi.fn();
  const scroll = vi.spyOn(root, 'scrollIntoView').mockImplementation(() => undefined);
  entries.push({ path: 'src/lazy.ts', root, anchor: null, additions: null, deletions: null, prepareReveal, isExpanded: () => hydrated, expand: () => hydrated, collapse: () => false });
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  reveal.refresh();
  reveal.refresh();
  expect(prepareReveal).toHaveBeenCalledTimes(1);
  expect(scroll).not.toHaveBeenCalled();
  hydrated = true;
  reveal.refresh();
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(prepareReveal).toHaveBeenCalledTimes(1);
});

it.each([
  ['#chg-src%2Flazy.ts', true],
  ['#chg-src/other.ts', false],
  ['?context=20#chg-src/lazy.ts', false],
] as const)('uses only the exact Bitbucket same-selection file fragment (%s)', (href, accepted) => {
  const previous = window.location.href;
  try {
    window.location.href = 'https://bitbucket.org/acme/widgets/pull-requests/7/diff';
    const { view, link } = fixture();
    link.href = href;
    const clicked = vi.fn();
    link.addEventListener('click', clicked);
    reveal = new ProviderReveal(() => view, () => 'same-visit');
    reveal.request('src/lazy.ts');
    expect(clicked).toHaveBeenCalledTimes(accepted ? 1 : 0);
  } finally { window.location.href = previous; }
});

function mounted(virtualized = false) {
  const { view, entries } = fixture();
  const root = document.createElement('article');
  root.id = 'native-file-hash';
  root.style.scrollMarginTop = '72px';
  view.container.append(root);
  const top = { value: 72 };
  vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, top.value, 900, 400));
  const scroll = vi.spyOn(root, 'scrollIntoView').mockImplementation(() => { top.value = 72; });
  entries.push({ path: 'src/lazy.ts', root, anchor: root.id, additions: null, deletions: null, isExpanded: () => true, expand: () => true, collapse: () => false });
  return { view: { ...view, virtualized }, entries, root, scroll, top };
}

it('preserves all native diff selection queries and history state while setting the actual selected file anchor', () => {
  const { view, entries } = mounted();
  const original = new URL(window.location.href);
  original.searchParams.set('file_path', 'src/lazy.ts');
  original.searchParams.set('start_sha', 'a'.repeat(40));
  window.history.replaceState({ nativeState: 'preserved' }, '', original.href);
  const entry = entries[0];
  if (entry === undefined) throw new Error('Missing fixture entry');
  entries[0] = { ...entry, anchor: 'chg-src/lazy file.ts' };
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  const selected = new URL(window.location.href);
  expect(decodeURIComponent(selected.hash.slice(1))).toBe('chg-src/lazy file.ts');
  expect(selected.pathname).toBe(original.pathname);
  expect(selected.search).toBe(original.search);
  expect([...selected.searchParams]).toEqual([...original.searchParams]);
  expect(window.history.state).toEqual({ nativeState: 'preserved' });
});

it('corrects lazy content growth above the clicked file by its drift and performs no geometry reads on apply refreshes', async () => {
  const { view, root, top } = mounted();
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === 'object') top.value -= options.top ?? 0;
  });
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  await vi.advanceTimersByTimeAsync(400);
  const measured = vi.mocked(root.getBoundingClientRect).mock.calls.length;
  for (let index = 0; index < 100; index += 1) reveal.refresh();
  expect(root.getBoundingClientRect).toHaveBeenCalledTimes(measured);
  top.value = 192;
  await vi.advanceTimersByTimeAsync(200);
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 120, behavior: 'instant' });
  expect(top.value).toBe(72);
  await vi.advanceTimersByTimeAsync(200);
  expect(scrollBy).toHaveBeenCalledTimes(1);
});

it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])('releases active alignment immediately on the reader’s %s input', async (type) => {
  const { view, top } = mounted(true);
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  await vi.advanceTimersByTimeAsync(400);
  window.dispatchEvent(type === 'keydown' ? new KeyboardEvent(type, { key: 'PageDown' }) : new Event(type));
  top.value = 192;
  await vi.advanceTimersByTimeAsync(9000);
  reveal.refresh();
  expect(scrollBy).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a pending lazy reveal on user input before a native file mounts', async () => {
  const { view, entries } = fixture();
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  window.dispatchEvent(new Event('wheel'));
  const root = document.createElement('article');
  view.container.append(root);
  const scroll = vi.spyOn(root, 'scrollIntoView').mockImplementation(() => undefined);
  entries.push({ path: 'src/lazy.ts', root, anchor: null, additions: null, deletions: null, expand: () => true, collapse: () => false });
  reveal.refresh();
  await vi.advanceTimersByTimeAsync(1000);
  expect(scroll).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('aligns the current native root for the same path after virtualization recycles the old root', async () => {
  const { view, entries, root } = mounted(true);
  const top = { value: 192 };
  const replacement = document.createElement('article');
  replacement.style.scrollMarginTop = '72px';
  vi.spyOn(replacement, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, top.value, 900, 400));
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === 'object') top.value -= options.top ?? 0;
  });
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  await vi.advanceTimersByTimeAsync(400);
  const oldReads = vi.mocked(root.getBoundingClientRect).mock.calls.length;
  const old = entries[0];
  if (old === undefined) throw new Error('Missing fixture entry');
  entries[0] = { ...old, path: 'src/recycled-other.ts' };
  view.container.append(replacement);
  entries.push({ ...old, root: replacement });
  await vi.advanceTimersByTimeAsync(200);
  expect(root.isConnected).toBe(true);
  expect(root.getBoundingClientRect).toHaveBeenCalledTimes(oldReads);
  expect(replacement.getBoundingClientRect).toHaveBeenCalled();
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 120, behavior: 'instant' });
});

it('stops alignment on a new visit or native hash navigation without rewriting the new selection', async () => {
  const { view, top } = mounted(true);
  let visit = 'old-visit';
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  reveal = new ProviderReveal(() => view, () => visit);
  reveal.request('src/lazy.ts');
  await vi.advanceTimersByTimeAsync(400);
  visit = 'new-visit';
  reveal.refresh();
  top.value = 192;
  await vi.advanceTimersByTimeAsync(200);
  expect(scrollBy).not.toHaveBeenCalled();
  reveal.request('src/lazy.ts');
  const next = new URL(window.location.href);
  next.hash = 'note_123';
  window.history.replaceState(window.history.state, '', next.href);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  top.value = 192;
  await vi.advanceTimersByTimeAsync(1000);
  expect(scrollBy).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('#note_123');
  expect(vi.getTimerCount()).toBe(0);
});

it('uses instant native scrolling for reduced motion and ends the hold at its bounded deadline', async () => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  vi.spyOn(media, 'matches', 'get').mockReturnValue(true);
  vi.spyOn(window, 'matchMedia').mockReturnValue(media);
  const { view, scroll, top } = mounted();
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === 'object') top.value -= options.top ?? 0;
  });
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: 'instant' });
  top.value = 192;
  await vi.advanceTimersByTimeAsync(200);
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 120, behavior: 'instant' });
  await vi.advanceTimersByTimeAsync(1500);
  top.value = 292;
  await vi.advanceTimersByTimeAsync(1000);
  expect(scrollBy).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('corrects the actual nested native scroll pane using its border, scroll padding and file margin', async () => {
  const { view, root, scroll, top } = mounted(true);
  const pane = document.createElement('section');
  pane.style.overflowY = 'auto';
  pane.style.scrollPaddingTop = '20px';
  Object.defineProperties(pane, { scrollHeight: { value: 1800 }, clientHeight: { value: 600 }, clientTop: { value: 2 } });
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 900, 600));
  view.container.append(pane);
  pane.append(root);
  scroll.mockImplementation(() => { top.value = 194; });
  const pageScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  const paneScroll = vi.spyOn(pane, 'scrollBy').mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === 'object') top.value -= options.top ?? 0;
  });
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  await vi.advanceTimersByTimeAsync(400);
  top.value = 314;
  await vi.advanceTimersByTimeAsync(200);
  expect(paneScroll).toHaveBeenCalledExactlyOnceWith({ top: 120, behavior: 'instant' });
  expect(pageScroll).not.toHaveBeenCalled();
  expect(top.value).toBe(194);
});

it('coalesces ResizeObserver arrivals into one alignment read and disconnects all work on clear', async () => {
  const callbacks: (() => void)[] = [];
  const instances: ResizeObserver[] = [];
  const observed = new Set<Element>();
  class NativeResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { callbacks.push(() => callback([], this)); instances.push(this); }
    readonly observe = vi.fn((target: Element) => { observed.add(target); });
    readonly unobserve = vi.fn((target: Element) => { observed.delete(target); });
    readonly disconnect = vi.fn(() => { observed.clear(); });
  }
  vi.stubGlobal('ResizeObserver', NativeResizeObserver);
  const { view, root, top } = mounted(true);
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === 'object') top.value -= options.top ?? 0;
  });
  reveal = new ProviderReveal(() => view, () => 'same-visit');
  reveal.request('src/lazy.ts');
  expect(instances).toHaveLength(1);
  expect(observed).toEqual(new Set([document.body, view.container, root]));
  await vi.advanceTimersByTimeAsync(400);
  const reads = vi.mocked(root.getBoundingClientRect).mock.calls.length;
  top.value = 192;
  callbacks[0]?.();
  callbacks[0]?.();
  callbacks[0]?.();
  await vi.advanceTimersByTimeAsync(20);
  expect(root.getBoundingClientRect).toHaveBeenCalledTimes(reads + 1);
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 120, behavior: 'instant' });
  reveal.clear();
  expect(instances[0]?.disconnect).toHaveBeenCalledTimes(1);
  expect(observed.size).toBe(0);
  callbacks[0]?.();
  await vi.advanceTimersByTimeAsync(1000);
  expect(vi.getTimerCount()).toBe(0);
  expect(scrollBy).toHaveBeenCalledTimes(1);
});
