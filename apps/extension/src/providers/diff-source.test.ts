import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BITBUCKET_ANONYMOUS_DIFF_FRESH_MS, ProviderDiffSource, providerRetryAfter } from './diff-source';
import type { ProviderDiffSourceOptions } from './diff-source';
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
function sourceFor(fetchDiff: ProviderAdapter['fetchDiff'], changed = vi.fn(), cache?: ProviderDiffCache, options?: ProviderDiffSourceOptions, provider: ProviderAdapter['id'] = 'gitlab'): ProviderDiffSource {
  const adapter: ProviderAdapter = {
    id: provider, describe: () => null, readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff,
  };
  const source = new ProviderDiffSource(adapter, changed, cache, options);
  sources.push(source);
  return source;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
});

function bitbucketPage(number: string): ProviderReviewPage {
  const url = `https://bitbucket.org/acme/widgets/pull-requests/${number}`;
  return { provider: 'bitbucket', repository: { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'acme/widgets' }, number, url, diffPageUrl: `${url}/diff`, diffUrl: `${url}/diff`, kind: 'overview', headSha: null, version: 'current' };
}

describe('anonymous Bitbucket passive demand protection', () => {
  it('hydrates 25 passive rows without starting any API snapshots or timer-driven refreshes', async () => {
    const store = cacheStore();
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockResolvedValue(complete('unexpected'));
    const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend), undefined, 'bitbucket');
    const rows = Array.from({ length: 25 }, (_, index) => bitbucketPage(String(index + 1)));
    for (const row of rows) expect(source.get(row, false, false)).toMatchObject({ status: 'deferred', reason: 'Hover to count changes' });
    await vi.advanceTimersByTimeAsync(0);
    for (let minute = 0; minute < 65; minute += 1) {
      for (const row of rows) source.get(row, false, false);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(fetchDiff).not.toHaveBeenCalled();
    expect(rows.every((row) => source.get(row, false, false).status === 'deferred')).toBe(true);
  });

  it('shows complete stale cache provisionally without revalidation until actual intent promotes it', async () => {
    const store = cacheStore();
    const page = bitbucketPage('1');
    const seeded = new ProviderDiffCache(store.backend);
    seeded.set(page, complete('old'));
    await vi.advanceTimersByTimeAsync(0);
    seeded.stop();
    await vi.advanceTimersByTimeAsync(PROVIDER_CACHE_FRESH_MS + 1);
    const pending = deferred<ProviderDiffResult>();
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockReturnValue(pending.promise);
    const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend), undefined, 'bitbucket');
    source.get(page, false, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.get(page, false, false)).toMatchObject({ status: 'ready', cached: true, provisional: true, result: { revision: 'old', complete: true } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchDiff).not.toHaveBeenCalled();
    expect(source.get(page, true)).toMatchObject({ status: 'ready', cached: true, provisional: true, refreshing: true, result: { revision: 'old' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    pending.resolve(complete('verified'));
    await vi.advanceTimersByTimeAsync(0);
    expect(source.get(page, true)).toMatchObject({ status: 'ready', result: { revision: 'verified', complete: true } });
  });

  it('preserves explicit intent through a passive read while disk hydration is still pending', async () => {
    const hydration = deferred<unknown>();
    const backend: ProviderCacheStorage = { read: () => hydration.promise, write: async () => undefined, watch: () => () => undefined };
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockResolvedValue(complete('intent'));
    const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(backend), undefined, 'bitbucket');
    const page = bitbucketPage('1');
    source.get(page, false, false);
    source.get(page, true);
    expect(source.get(page, false, false)).toEqual({ status: 'loading' });
    hydration.resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledExactlyOnceWith(page, expect.any(AbortSignal));
    expect(source.get(page, false, false)).toMatchObject({ status: 'ready', result: { revision: 'intent' } });
  });

  it('does not cancel an explicit queued hover when a passive list refresh reads it', async () => {
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockResolvedValue(complete('intent'));
    const store = cacheStore();
    const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend), undefined, 'bitbucket');
    source.get(bitbucketPage('1'), true);
    await vi.advanceTimersByTimeAsync(0);
    const intended = bitbucketPage('2');
    source.get(intended, true);
    await vi.advanceTimersByTimeAsync(0);
    source.get(intended, false, false);
    await vi.advanceTimersByTimeAsync(749);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
    expect(fetchDiff.mock.calls[1]?.[0]).toEqual(intended);
  });

  it('reuses a current-visit verified unknown head for 30 minutes instead of refetching every minute', async () => {
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockResolvedValue(complete('verified'));
    const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(cacheStore().backend), undefined, 'bitbucket');
    const page = bitbucketPage('1');
    source.get(page, true);
    await vi.advanceTimersByTimeAsync(0);
    for (let minute = 0; minute < 29; minute += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(source.get(page, true)).toMatchObject({ status: 'ready', result: { revision: 'verified' } });
    }
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BITBUCKET_ANONYMOUS_DIFF_FRESH_MS - 29 * 60_000);
    source.get(page, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
  });

  it('keeps the existing 60-second refresh for reliable authenticated capability, including a session change', async () => {
    let anonymous = true;
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockResolvedValue(complete('verified'));
    const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(cacheStore().backend), { anonymous: () => anonymous }, 'bitbucket');
    const page = bitbucketPage('1');
    source.get(page, true);
    await vi.advanceTimersByTimeAsync(60_000);
    source.get(page, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    anonymous = false;
    source.get(page, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    source.get(page, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(3);
  });

  it('revokes authenticated eager list work on logout while preserving later explicit intent', async () => {
    let anonymous = false;
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockResolvedValue(complete('verified'));
    const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(cacheStore().backend), { anonymous: () => anonymous }, 'bitbucket');
    source.get(bitbucketPage('1'));
    source.get(bitbucketPage('2'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    anonymous = true;
    expect(source.get(bitbucketPage('2'), false, false)).toMatchObject({ status: 'deferred' });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    source.get(bitbucketPage('2'), true);
    source.get(bitbucketPage('2'), false, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
  });

  it('does not renew failed explicit retry demand from passive list reads', async () => {
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockRejectedValue(new Error('Temporary outage'));
    const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(cacheStore().backend), undefined, 'bitbucket');
    const page = bitbucketPage('1');
    source.get(page, true);
    await vi.advanceTimersByTimeAsync(0);
    for (let second = 0; second < 180; second += 1) {
      source.get(page, false, false);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(fetchDiff).toHaveBeenCalledTimes(3);
  });

  it('shares a missing-header anonymous 429 pause with other queued reviews without fabricated empty counts', async () => {
    const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>()
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 429'), { reason: 'rate-limited' }))
      .mockResolvedValue(complete('after-pause'));
    const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(cacheStore().backend), undefined, 'bitbucket');
    source.get(bitbucketPage('1'), true);
    source.get(bitbucketPage('2'), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.get(bitbucketPage('1'), false, false)).toMatchObject({ status: 'failed', reason: 'HTTP 429' });
    await vi.advanceTimersByTimeAsync(60 * 60_000 - 1);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
    expect(source.get(bitbucketPage('2'), false, false)).toMatchObject({ status: 'ready', result: { revision: 'after-pause' } });
  });
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
  source.get(unknown, true, true, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchDiff).toHaveBeenCalledTimes(1);
  expect(source.get(unknown, true, true, true)).toEqual({ status: 'loading' });
  expect(source.get(unknown, true)).toMatchObject({ status: 'ready', cached: true, provisional: true, refreshing: true, result: { revision: 'old' } });
  waiting.resolve(complete('new'));
  await vi.advanceTimersByTimeAsync(0);
  expect(source.get(unknown, true, true, true)).toMatchObject({ status: 'ready', result: { revision: 'new' } });
});

it('retains cached counts and definitive refresh errors for hover while strict headers report failure', async () => {
  const store = cacheStore();
  const unknown = { ...page('1'), headSha: null, version: 'latest' };
  const seeded = new ProviderDiffCache(store.backend);
  seeded.set(unknown, complete('old'));
  await vi.advanceTimersByTimeAsync(0);
  seeded.stop();
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockRejectedValue(Object.assign(new Error('Sign in to GitLab to read this diff.'), { reason: 'authentication' }));
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend));
  source.get(unknown, false, false);
  await vi.advanceTimersByTimeAsync(0);
  // Actual hover intent revalidates even a fresh latest cache, but never
  // replaces its complete counts with a loading placeholder.
  expect(source.get(unknown, true)).toMatchObject({ status: 'ready', cached: true, provisional: true, refreshing: true, result: { revision: 'old' } });
  await vi.advanceTimersByTimeAsync(0);
  for (let pass = 0; pass < 3; pass += 1) {
    expect(source.get(unknown, true, true, true)).toEqual({ status: 'failed', reason: 'Sign in to GitLab to read this diff.' });
    expect(source.get(unknown, true)).toMatchObject({ status: 'ready', cached: true, provisional: true, refreshError: 'Sign in to GitLab to read this diff.', result: { revision: 'old' } });
    await vi.advanceTimersByTimeAsync(60_000);
  }
  expect(fetchDiff).toHaveBeenCalledTimes(1);
});

it('preserves a provisional snapshot through strict async hydration and a rate-limit cooldown', async () => {
  const store = cacheStore();
  const unknown = { ...page('1'), headSha: null, version: 'latest' };
  const seeded = new ProviderDiffCache(store.backend);
  seeded.set(unknown, complete('old'));
  await vi.advanceTimersByTimeAsync(0);
  seeded.stop();
  const disk = deferred<unknown>();
  const slot = providerCacheSlot(providerDiffKey(unknown));
  const backend: ProviderCacheStorage = { ...store.backend, read: (id) => id === slot ? disk.promise : store.backend.read(id) };
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>()
    .mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { retryAfterMs: 20_000 }))
    .mockResolvedValue(complete('new'));
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(backend));
  source.get(unknown, true, true, true);
  source.get(unknown, false, false);
  disk.resolve(store.values.get(slot));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchDiff).toHaveBeenCalledTimes(1);
  expect(source.get(unknown, true, true, true)).toEqual({ status: 'failed', reason: 'Rate limited' });
  expect(source.get(unknown, true)).toMatchObject({ status: 'ready', cached: true, provisional: true, refreshError: 'Rate limited', result: { revision: 'old' } });
  await vi.advanceTimersByTimeAsync(21_999);
  expect(fetchDiff).toHaveBeenCalledTimes(1);
  expect(source.get(unknown, false, false)).toMatchObject({ status: 'ready', result: { revision: 'old' } });
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchDiff).toHaveBeenCalledTimes(2);
  expect(source.get(unknown, true, true, true)).toMatchObject({ status: 'ready', result: { revision: 'new' } });
});

it('retains complete snapshots across visits without carrying old explicit retry demand', async () => {
  const store = cacheStore();
  const unknown = bitbucketPage('1');
  const seeded = new ProviderDiffCache(store.backend);
  seeded.set(unknown, complete('old'));
  await vi.advanceTimersByTimeAsync(0);
  seeded.stop();
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>()
    .mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { retryAfterMs: 20_000 }))
    .mockResolvedValue(complete('new'));
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(store.backend), undefined, 'bitbucket');
  source.beginVisit('first');
  source.get(unknown, true, true, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(source.get(unknown, true)).toMatchObject({ status: 'ready', refreshError: 'Rate limited', result: { revision: 'old' } });
  source.beginVisit('second');
  expect(source.get(unknown, false, false)).toMatchObject({ status: 'ready', cached: true, provisional: true, result: { revision: 'old' } });
  // Waking the scheduler must not turn a prior visit's priority/retry into
  // fresh intent merely because a passive row reads the retained snapshot.
  source.setActive(true);
  await vi.advanceTimersByTimeAsync(22_000);
  expect(fetchDiff).toHaveBeenCalledTimes(1);
  source.get(unknown, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchDiff).toHaveBeenCalledTimes(2);
  expect(source.get(unknown, true)).toMatchObject({ status: 'ready', result: { revision: 'new' } });
});

it('keeps an immutable verified snapshot usable after visit demand is reset', async () => {
  const fetchDiff = vi.fn<ProviderAdapter['fetchDiff']>().mockResolvedValue(complete('a'.repeat(40)));
  const source = sourceFor(fetchDiff, vi.fn(), new ProviderDiffCache(cacheStore().backend));
  source.beginVisit('first');
  source.get(page('1'), true, true, true);
  await vi.advanceTimersByTimeAsync(0);
  source.beginVisit('second');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(source.get(page('1'), true, true, true)).toMatchObject({ status: 'ready', result: { revision: 'a'.repeat(40) } });
  expect(fetchDiff).toHaveBeenCalledTimes(1);
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
