import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderDiffSource, providerRetryAfter } from './diff-source';
import { ProviderDiffCache, providerCacheSlot, providerDiffKey, PROVIDER_CACHE_FRESH_MS } from './diff-cache';
import type { ProviderCacheStorage } from './diff-cache';
import type { ProviderAdapter, ProviderDiffResult, ProviderReviewPage } from './types';

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void } {
  let finish: (value: T) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => { finish = resolve; fail = reject; });
  return { promise, resolve: (value) => finish(value), reject: (error) => fail(error) };
}

function page(number: string, head = 'a'): ProviderReviewPage {
  const url = `https://gitlab.com/acme/widgets/-/merge_requests/${number}`;
  return {
    provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'acme/widgets' },
    number, url, diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, kind: 'diff', headSha: head.repeat(40), version: head,
  };
}

function complete(revision: string): ProviderDiffResult {
  return { revision, complete: true, files: [{ path: `src/${revision}.ts`, additions: 12, deletions: 3 }] };
}

const sources: ProviderDiffSource[] = [];
function sourceFor(fetchDiff: ProviderAdapter['fetchDiff'], changed = vi.fn(), cache?: ProviderDiffCache): ProviderDiffSource {
  const adapter: ProviderAdapter = {
    id: 'gitlab', describe: () => null, readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff,
  };
  const source = new ProviderDiffSource(adapter, changed, cache);
  sources.push(source);
  return source;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
});
afterEach(() => {
  for (const source of sources) source.stop();
  sources.length = 0;
  vi.useRealTimers();
});

describe('provider diff acquisition', () => {
  it('rejects incomplete empty data instead of caching a successful zero-file diff', async () => {
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>()
      .mockResolvedValueOnce({ files: [], revision: 'a', complete: false })
      .mockResolvedValueOnce(complete('a'));
    const source = sourceFor(fetchDiff);
    source.get(page('1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(source.get(page('1'))).toMatchObject({ status: 'failed', reason: expect.stringContaining('incomplete') });
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    source.get(page('1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(source.get(page('1'))).toMatchObject({ status: 'ready', result: { files: [{ path: 'src/a.ts', additions: 12 }] } });
    expect(fetchDiff).toHaveBeenCalledTimes(2);
  });

  it('accepts a genuinely complete empty diff', async () => {
    const source = sourceFor(async () => ({ files: [], revision: 'empty', complete: true }));
    source.get(page('1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(source.get(page('1'))).toEqual({ status: 'ready', result: { files: [], revision: 'empty', complete: true } });
  });

  it('keeps different heads at the same review URL isolated when the old response lands last', async () => {
    const old = deferred<ProviderDiffResult>();
    const fresh = deferred<ProviderDiffResult>();
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockImplementation((request) => request.version === 'a' ? old.promise : fresh.promise);
    const source = sourceFor(fetchDiff);
    source.get(page('1', 'a'));
    source.get(page('1', 'b'), true);
    await vi.advanceTimersByTimeAsync(750);
    fresh.resolve(complete('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(source.get(page('1', 'b'))).toMatchObject({ status: 'ready', result: { revision: 'b' } });
    old.resolve(complete('a'));
    await vi.advanceTimersByTimeAsync(0);
    expect(source.get(page('1', 'b'))).toMatchObject({ status: 'ready', result: { revision: 'b', files: [{ path: 'src/b.ts' }] } });
  });

  it('runs at most two requests and leaves the third queued until a slot is free', async () => {
    const waiting = new Map<string, ReturnType<typeof deferred<ProviderDiffResult>>>();
    let active = 0;
    let maximum = 0;
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockImplementation((request) => {
      active += 1;
      maximum = Math.max(maximum, active);
      const job = deferred<ProviderDiffResult>();
      waiting.set(('number' in request ? request.number : ''), job);
      return job.promise.finally(() => { active -= 1; });
    });
    const source = sourceFor(fetchDiff);
    source.get(page('1'));
    source.get(page('2'));
    source.get(page('3'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(749);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
    waiting.get('1')?.resolve(complete('first'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(3);
    expect(maximum).toBe(2);
  });

  it('honors a rate-limit pause for other queued reviews on the same source', async () => {
    const failed = deferred<ProviderDiffResult>();
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>()
      .mockImplementationOnce(() => failed.promise)
      .mockResolvedValue(complete('second'));
    const source = sourceFor(fetchDiff);
    source.get(page('1'));
    source.get(page('2'));
    failed.reject(Object.assign(new Error('Rate limited'), { retryAfterMs: 20_000 }));
    await vi.advanceTimersByTimeAsync(21_999);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
    expect(source.get(page('2'))).toMatchObject({ status: 'ready', result: { revision: 'second' } });
  });

  it('starts no request while inactive and never publishes a late result after stop', async () => {
    const waiting = deferred<ProviderDiffResult>();
    const signals: AbortSignal[] = [];
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockImplementation((_page, abort) => { signals.push(abort); return waiting.promise; });
    const changed = vi.fn();
    const source = sourceFor(fetchDiff, changed);
    source.setActive(false);
    source.get(page('1'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchDiff).not.toHaveBeenCalled();
    source.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    source.get(page('2'));
    source.setActive(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    source.stop();
    expect(signals[0]?.aborted).toBe(true);
    waiting.resolve(complete('late'));
    await vi.advanceTimersByTimeAsync(0);
    source.setActive(true);
    source.get(page('3'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
  });
});

function cacheStore(): { backend: ProviderCacheStorage; values: Map<number, unknown> } {
  const values = new Map<number, unknown>();
  const watches = new Map<number, Set<(value: unknown) => void>>();
  return { values, backend: {
    read: async (slot) => values.get(slot),
    write: async (slot, value) => { values.set(slot, value); for (const notify of watches.get(slot) ?? []) notify(value); },
    watch: (slot, notify) => { let set = watches.get(slot); if (set === undefined) { set = new Set(); watches.set(slot, set); } set.add(notify); return () => set.delete(notify); },
  } };
}

it('hydrates an exact immutable head from disk without spending a network request', async () => {
  const store = cacheStore();
  const seeded = new ProviderDiffCache(store.backend);
  seeded.set(page('1'), complete('a'.repeat(40)));
  await vi.advanceTimersByTimeAsync(0);
  seeded.stop();
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>();
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend));
  expect(source.get(page('1'), true)).toEqual({ status: 'loading' });
  await vi.advanceTimersByTimeAsync(0);
  expect(source.get(page('1'), true)).toMatchObject({ status: 'ready', cached: true, result: { revision: 'a'.repeat(40) } });
  await vi.advanceTimersByTimeAsync(120_000);
  source.get(page('1'), true);
  expect(fetchDiff).not.toHaveBeenCalled();
});

it('forces a current-page fetch when disk only knows an unknown-head list revision', async () => {
  const store = cacheStore();
  const unknown = { ...page('1'), headSha: null, version: 'latest' };
  const seeded = new ProviderDiffCache(store.backend);
  seeded.set(unknown, complete('old'));
  await vi.advanceTimersByTimeAsync(0);
  seeded.stop();
  const waiting = deferred<ProviderDiffResult>();
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockReturnValue(waiting.promise);
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend));
  source.get(unknown, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchDiff).toHaveBeenCalledTimes(1);
  expect(source.get(unknown, true)).toEqual({ status: 'loading' });
  waiting.resolve(complete('new'));
  await vi.advanceTimersByTimeAsync(0);
  expect(source.get(unknown, true)).toMatchObject({ status: 'ready', result: { revision: 'new' } });
});

it('keeps stale list counts explicitly provisional during a failed revalidation', async () => {
  const store = cacheStore();
  const unknown = { ...page('1'), headSha: null, version: 'latest' };
  const seeded = new ProviderDiffCache(store.backend);
  seeded.set(unknown, complete('old'));
  await vi.advanceTimersByTimeAsync(0);
  seeded.stop();
  await vi.advanceTimersByTimeAsync(PROVIDER_CACHE_FRESH_MS + 1);
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValue(complete('new'));
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend));
  source.get(unknown);
  await vi.advanceTimersByTimeAsync(0);
  expect(source.get(unknown)).toMatchObject({ status: 'ready', cached: true, provisional: true, refreshError: 'Temporary failure', result: { revision: 'old' } });
  await vi.advanceTimersByTimeAsync(4000);
  expect(source.get(unknown)).toMatchObject({ status: 'ready', result: { revision: 'new' } });
});

it('cannot replay old hydration or an old queued review after SPA navigation', async () => {
  const store = cacheStore();
  const hydration = deferred<unknown>();
  const oldPage = page('1');
  let fresh = page('2');
  while (providerCacheSlot(providerDiffKey(oldPage)) === providerCacheSlot(providerDiffKey(fresh))) fresh = page(String(Number(fresh.number) + 1));
  const oldSlot = providerCacheSlot(providerDiffKey(oldPage));
  const backend = { ...store.backend, read: (slot: number) => slot === oldSlot ? hydration.promise : store.backend.read(slot) };
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockResolvedValue(complete('fresh'));
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(backend));
  source.beginVisit('old');
  source.get(oldPage, true);
  source.beginVisit('new');
  source.get(fresh, true);
  hydration.resolve(null);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchDiff.mock.calls.map((call) => ('number' in call[0] ? call[0].number : ''))).toEqual([fresh.number]);
});

it('never starts work or publishes late cache hydration after stop', async () => {
  const loaded = deferred<unknown>();
  const changed = vi.fn();
  const cache = new ProviderDiffCache({ read: () => loaded.promise, write: async () => undefined, watch: () => () => undefined });
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>();
  const source = sourceFor(fetchDiff, changed, cache);
  source.get(page('1'), true);
  source.stop();
  loaded.resolve(null);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchDiff).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});

it('honors Retry-After milliseconds, seconds and dates without shortening a long pause', () => {
  expect(providerRetryAfter({ retryAfterMs: 3_600_000 })).toBe(3_600_000);
  expect(providerRetryAfter({ retryAfter: '20' })).toBe(20_000);
  expect(providerRetryAfter({ retryAfter: 'Sun, 01 Nov 2026 12:01:00 GMT' })).toBe(60_000);
  expect(providerRetryAfter({ retryAfterMs: Number.NaN, retryAfter: 'invalid' })).toBeNull();
});

it('isolates an origin cooldown while allowing another provider host to make progress', async () => {
  const store = cacheStore();
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockImplementation(async (request) => {
    if (('number' in request ? request.number : '') === '1') throw Object.assign(new Error('Rate limited'), { retryAfterMs: 20_000 });
    return complete('other');
  });
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend));
  const other = page('3');
  const hosted = { ...other, repository: { ...other.repository, origin: 'https://forge.example' }, url: other.url.replace('https://gitlab.com', 'https://forge.example') };
  source.get(page('1'));
  source.get(page('2'));
  source.get(hosted);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchDiff.mock.calls.map((call) => ('number' in call[0] ? call[0].number : ''))).toEqual(['1', '3']);
  await vi.advanceTimersByTimeAsync(21_999);
  expect(fetchDiff.mock.calls.some((call) => ('number' in call[0] ? call[0].number : '') === '2')).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchDiff.mock.calls.some((call) => ('number' in call[0] ? call[0].number : '') === '2')).toBe(true);
});

it('promotes the current review ahead of pending list rows while keeping two in flight', async () => {
  const store = cacheStore();
  const waiting = deferred<ProviderDiffResult>();
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockReturnValue(waiting.promise);
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend));
  source.get(page('1'));
  source.get(page('2'));
  source.get(page('3'));
  await vi.advanceTimersByTimeAsync(0);
  source.get(page('4'), true);
  await vi.advanceTimersByTimeAsync(750);
  expect(fetchDiff.mock.calls.map((call) => ('number' in call[0] ? call[0].number : ''))).toEqual(['1', '4']);
});

it('aborts an old in-flight visit and ignores its late response after the new head completed', async () => {
  const store = cacheStore();
  const old = deferred<ProviderDiffResult>();
  const signals: AbortSignal[] = [];
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockImplementation((request, signal) => {
    signals.push(signal);
    return request.version === 'a' ? old.promise : Promise.resolve(complete('b'.repeat(40)));
  });
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend));
  source.beginVisit('a');
  source.get(page('1', 'a'), true);
  await vi.advanceTimersByTimeAsync(0);
  source.beginVisit('b');
  expect(signals[0]?.aborted).toBe(true);
  source.get(page('1', 'b'), true);
  await vi.advanceTimersByTimeAsync(750);
  old.resolve(complete('a'.repeat(40)));
  await vi.advanceTimersByTimeAsync(0);
  expect(source.get(page('1', 'b'), true)).toMatchObject({ status: 'ready', result: { revision: 'b'.repeat(40) } });
  expect(JSON.stringify([...store.values.values()])).not.toContain(`src/${'a'.repeat(40)}.ts`);
});

it('does not spend retries on a definitive authentication refusal', async () => {
  const store = cacheStore();
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockRejectedValue(Object.assign(new Error('Sign in to Bitbucket to read this review.'), { reason: 'authentication' }));
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend));
  source.get(page('1'));
  await vi.advanceTimersByTimeAsync(0);
  for (let pass = 0; pass < 10; pass += 1) { await vi.advanceTimersByTimeAsync(60_000); source.get(page('1')); }
  expect(fetchDiff).toHaveBeenCalledTimes(1);
  expect(source.get(page('1'))).toMatchObject({ status: 'failed' });
});

it('clears memory and disk together and cannot restore a pre-clear in-flight reply', async () => {
  const store = cacheStore();
  const old = deferred<ProviderDiffResult>();
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockReturnValueOnce(old.promise).mockResolvedValue(complete('a'.repeat(40)));
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend));
  source.get(page('1'), true);
  await vi.advanceTimersByTimeAsync(0);
  await source.clearCache();
  old.resolve(complete('old'));
  await vi.advanceTimersByTimeAsync(0);
  expect(source.get(page('1'), true)).toEqual({ status: 'loading' });
  await vi.advanceTimersByTimeAsync(750);
  expect(source.get(page('1'), true)).toMatchObject({ status: 'ready', result: { revision: 'a'.repeat(40) } });
  expect(JSON.stringify([...store.values.values()])).not.toContain('src/old.ts');
});
