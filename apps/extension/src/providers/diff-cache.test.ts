import { ProviderDiffCache, PROVIDER_CACHE_EXACT_MS, PROVIDER_CACHE_FRESH_MS, PROVIDER_CACHE_LATEST_MS, PROVIDER_CACHE_MAX_BYTES, PROVIDER_CACHE_SLOTS, providerCacheSlot, providerDiffKey } from './diff-cache';
import type { ProviderCacheStorage } from './diff-cache';
import type { ProviderCommitPage, ProviderComparePage, ProviderDiffResult, ProviderReviewPage } from './types';

function page(number = '1', head: string | null = 'a'.repeat(40)): ProviderReviewPage {
  const url = `https://gitlab.com/acme/subgroup/widgets/-/merge_requests/${number}`;
  return { provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme/subgroup/widgets' }, number, url, diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, kind: 'diff', headSha: head, version: 'diff=1|w=0' };
}

function result(head = 'a'.repeat(40)): ProviderDiffResult {
  return { revision: `base..${head}`, complete: true, files: [{ path: 'src/a.ts', additions: 4, deletions: 1, status: 'modified', kinds: ['comments'], commentLines: { added: [8], removed: [] } }], patches: new Map([['src/a.ts', 'private source']]) };
}

function memory(): { readonly backend: ProviderCacheStorage; readonly values: Map<number, unknown>; readonly listeners: Map<number, Set<(value: unknown) => void>> } {
  const values = new Map<number, unknown>();
  const listeners = new Map<number, Set<(value: unknown) => void>>();
  return { values, listeners, backend: {
    read: async (slot) => values.get(slot),
    write: async (slot, value) => { values.set(slot, value); for (const notify of listeners.get(slot) ?? []) notify(value); },
    watch: (slot, notify) => { let set = listeners.get(slot); if (set === undefined) { set = new Set(); listeners.set(slot, set); } set.add(notify); return () => set.delete(notify); },
  } };
}

const caches: ProviderDiffCache[] = [];
function cache(backend: ProviderCacheStorage, changed?: () => void): ProviderDiffCache {
  const value = new ProviderDiffCache(backend, changed);
  caches.push(value);
  return value;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); });
afterEach(() => { for (const item of caches) item.stop(); caches.length = 0; vi.useRealTimers(); });

it('persists only complete file statistics and serves an exact immutable head after reload', async () => {
  const store = memory();
  const first = cache(store.backend);
  first.set(page(), result());
  await vi.advanceTimersByTimeAsync(0);
  expect(store.values.size).toBe(1);
  expect(JSON.stringify([...store.values.values()])).not.toContain('private source');
  const second = cache(store.backend);
  await second.load(page());
  expect(second.get(page(), true)).toMatchObject({ exact: true, fresh: true, result: { files: [{ path: 'src/a.ts', commentLines: { added: [8] } }] } });
  expect(second.get(page(), true)?.result.patches).toBeUndefined();
  expect(second.get(page('1', 'b'.repeat(40)), true)).toBeNull();
});

it('canonicalizes review URLs but isolates provider, origin, namespace, head and selected version', () => {
  const original = providerDiffKey(page());
  expect(providerDiffKey({ ...page(), url: `${page().url}/?irrelevant=1#note_42` })).toBe(original);
  expect(providerDiffKey({ ...page(), version: 'diff=2|w=0' })).not.toBe(original);
  expect(providerDiffKey({ ...page(), headSha: 'b'.repeat(40) })).not.toBe(original);
  expect(() => providerDiffKey({ ...page(), url: 'https://example.com/acme/subgroup/widgets/-/merge_requests/1' })).toThrow();
  const selfHosted = { ...page(), repository: { ...page().repository, origin: 'https://forge.example' }, url: 'https://forge.example/acme/subgroup/widgets/-/merge_requests/1' };
  expect(providerDiffKey(selfHosted)).not.toBe(original);
});

it('never presents unknown-head list cache as authoritative header data and expires stale latest data', async () => {
  const store = memory();
  const cached = cache(store.backend);
  const unknown = page('1', null);
  cached.set(unknown, result());
  await vi.advanceTimersByTimeAsync(0);
  expect(cached.get(unknown, false)).toMatchObject({ exact: false, fresh: true });
  expect(cached.get(unknown, true)).toBeNull();
  vi.advanceTimersByTime(PROVIDER_CACHE_FRESH_MS + 1);
  expect(cached.get(unknown)).toMatchObject({ exact: false, fresh: false });
  vi.advanceTimersByTime(PROVIDER_CACHE_LATEST_MS);
  expect(cached.get(unknown)).toBeNull();
});

it('expires immutable entries by TTL without matching a different version', async () => {
  const store = memory();
  const cached = cache(store.backend);
  cached.set(page(), result());
  await vi.advanceTimersByTimeAsync(0);
  expect(cached.get({ ...page(), version: 'other-base' })).toBeNull();
  vi.advanceTimersByTime(PROVIDER_CACHE_EXACT_MS + 1);
  expect(cached.get(page(), true)).toBeNull();
});

it('refuses partial results, mismatched immutable revisions, oversized records and negative statistics', async () => {
  const store = memory();
  const cached = cache(store.backend);
  cached.set(page(), { ...result(), complete: false });
  cached.set(page(), { ...result(), revision: 'different-head' });
  cached.set(page(), { ...result(), files: [{ path: 'x', additions: -1, deletions: 0 }] });
  cached.set(page(), { ...result(), files: Array.from({ length: 1000 }, (_, index) => ({ path: `src/${index}-${'x'.repeat(100)}.ts`, additions: 1, deletions: 0 })) });
  await vi.advanceTimersByTimeAsync(0);
  expect(store.values.size).toBe(0);
});

it('validates persisted records instead of trusting old or corrupt shapes', async () => {
  const key = providerDiffKey(page());
  const valid = { schema: 1, key, storedAt: Date.now(), revision: result().revision, files: result().files };
  const invalid: readonly unknown[] = [
    null, [], { ...valid, schema: 0 }, { ...valid, key: 'github:acme:widgets:1:sha' }, { ...valid, storedAt: Date.now() + 120_000 },
    { ...valid, revision: '' }, { ...valid, files: [{ path: '', additions: 1, deletions: 0 }] },
    { ...valid, files: [{ path: 'x', additions: Number.NaN, deletions: 0 }] },
    { ...valid, files: [{ path: 'x', additions: 1, deletions: 0, status: 'surprise' }] },
    { ...valid, files: [{ path: 'x', additions: 1, deletions: 0, kinds: ['unknown'] }] },
    { ...valid, files: [{ path: 'x', additions: 2, deletions: 0, commentLines: { added: [1, 1], removed: [] } }] },
    { ...valid, files: [valid.files[0], valid.files[0]] },
  ];
  for (const value of invalid) {
    const store = memory();
    store.values.set(providerCacheSlot(key), value);
    const cached = cache(store.backend);
    await cached.load(page());
    expect(cached.get(page(), true)).toBeNull();
  }
});

it('keeps distinct-slot writes from separate tabs without overwriting another tab snapshot', async () => {
  const store = memory();
  const firstPage = page();
  let secondPage = page('2');
  while (providerCacheSlot(providerDiffKey(secondPage)) === providerCacheSlot(providerDiffKey(firstPage))) secondPage = page(String(Number(secondPage.number) + 1));
  const first = cache(store.backend);
  const second = cache(store.backend);
  await Promise.all([first.load(firstPage), first.load(secondPage), second.load(firstPage), second.load(secondPage)]);
  first.set(firstPage, result());
  second.set(secondPage, result());
  await vi.advanceTimersByTimeAsync(0);
  expect(store.values.size).toBe(2);
  expect(first.get(secondPage)?.result.files).toEqual(result().files);
  expect(second.get(firstPage)?.result.files).toEqual(result().files);
});

it('treats a hash collision as bounded eviction and verifies the entire key before reuse', async () => {
  const store = memory();
  const cached = cache(store.backend);
  const first = page();
  let collided: ProviderReviewPage | null = null;
  for (let number = 2; number < 5000; number += 1) {
    const candidate = page(String(number));
    if (providerCacheSlot(providerDiffKey(candidate)) === providerCacheSlot(providerDiffKey(first))) { collided = candidate; break; }
  }
  if (collided === null) throw new Error('No collision found');
  cached.set(first, result());
  await vi.advanceTimersByTimeAsync(0);
  cached.set(collided, result());
  await vi.advanceTimersByTimeAsync(0);
  expect(store.values.size).toBe(1);
  expect(cached.get(first, true)).toBeNull();
  expect(cached.get(collided, true)).not.toBeNull();
});

it('does not let a late initial storage read replace a newer watch event', async () => {
  const store = memory();
  const writer = cache(store.backend);
  writer.set(page(), result());
  await vi.advanceTimersByTimeAsync(0);
  const saved = store.values.get(providerCacheSlot(providerDiffKey(page())));
  let finish: (value: unknown) => void = () => undefined;
  const pending = new Promise<unknown>((resolve) => { finish = resolve; });
  const reader = cache({ ...store.backend, read: () => pending });
  const loaded = reader.load(page());
  await store.backend.write(providerCacheSlot(providerDiffKey(page())), saved);
  finish(null);
  await loaded;
  expect(reader.get(page(), true)).not.toBeNull();
});

it('bounds records and watchers by slot count and tears watchers down on stop', async () => {
  const store = memory();
  const cached = cache(store.backend);
  for (let number = 1; number <= 200; number += 1) {
    const target = page(String(number));
    await cached.load(target);
    cached.set(target, result());
  }
  await vi.advanceTimersByTimeAsync(0);
  expect(store.values.size).toBeLessThanOrEqual(PROVIDER_CACHE_SLOTS);
  expect([...store.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0)).toBeLessThanOrEqual(PROVIDER_CACHE_SLOTS);
  expect([...store.values.values()].every((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= PROVIDER_CACHE_MAX_BYTES)).toBe(true);
  cached.stop();
  expect([...store.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
});

it('persists a confirmed complete empty diff while preserving its immutable revision', async () => {
  const store = memory();
  const first = cache(store.backend);
  first.set(page(), { ...result(), files: [] });
  await vi.advanceTimersByTimeAsync(0);
  const second = cache(store.backend);
  await second.load(page());
  expect(second.get(page(), true)).toMatchObject({ exact: true, result: { files: [], complete: true } });
});

it('isolates standalone commit and compare cache without fake review identifiers', async () => {
  const store = memory();
  const cached = cache(store.backend);
  const head = 'a'.repeat(40), base = 'b'.repeat(40);
  const commit: ProviderCommitPage = { ...page(), kind: 'commit', ref: head, url: `https://gitlab.com/acme/subgroup/widgets/-/commit/${head}` };
  const compare: ProviderComparePage = { ...page(), kind: 'compare', from: base, to: head, straight: false, url: `https://gitlab.com/acme/subgroup/widgets/-/compare/${base}...${head}` };
  cached.set(commit, result());
  cached.set(compare, result());
  await vi.advanceTimersByTimeAsync(0);
  expect(cached.get(commit, true)).toMatchObject({ exact: true });
  expect(cached.get(compare, true)).toMatchObject({ exact: true });
  expect(providerDiffKey(commit)).not.toBe(providerDiffKey(compare));
  const movingBase: ProviderComparePage = { ...compare, from: 'main', url: `https://gitlab.com/acme/subgroup/widgets/-/compare/main...${head}` };
  cached.set(movingBase, result());
  await vi.advanceTimersByTimeAsync(0);
  expect(cached.get(movingBase, true)).toBeNull();
});

it('clears only the bounded provider slots and makes an exact cached result unavailable', async () => {
  const store = memory();
  const write = vi.fn(store.backend.write);
  const cached = cache({ ...store.backend, write });
  cached.set(page(), result());
  await vi.advanceTimersByTimeAsync(0);
  await cached.clear();
  expect(cached.get(page(), true)).toBeNull();
  expect(write.mock.calls.filter((call) => call[1] === null)).toHaveLength(PROVIDER_CACHE_SLOTS);
});
