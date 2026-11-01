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
afterEach(() => { reveal?.stop(); reveal = null; vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren(); });

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
