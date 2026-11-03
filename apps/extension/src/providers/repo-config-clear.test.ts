import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';

const store = vi.hoisted(() => ({
  value: {},
  get: vi.fn(async (): Promise<unknown> => store.value),
  set: vi.fn(async (value: object) => { store.value = value; }),
  remove: vi.fn(async () => { store.value = {}; }),
}));
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: store.get, setValue: store.set, removeValue: store.remove }) } }));
import { clearProviderConfigCache, loadProviderConfig, ProviderRepoConfigSource } from './repo-config';
import type { ProviderPage, ProviderReviewPage } from './types';

const ref = 'a'.repeat(40);
const page: ProviderReviewPage = {
  provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'owner/repo' },
  number: '42', url: 'https://gitlab.com/owner/repo/-/merge_requests/42', diffPageUrl: 'https://gitlab.com/owner/repo/-/merge_requests/42/diffs',
  diffUrl: 'https://gitlab.com/owner/repo/-/merge_requests/42.diff', kind: 'diff', headSha: ref, version: '1',
};
const fileUrl = (path: string): string => `https://gitlab.com/owner/repo/-/raw/${ref}/${path}`;
function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(finish => { resolve = finish; });
  return { promise, resolve };
}
const sources: ProviderRepoConfigSource[] = [];
beforeEach(() => { store.value = {}; store.get.mockReset().mockImplementation(async () => store.value); store.set.mockReset().mockImplementation(async value => { store.value = value; }); store.remove.mockClear(); });
afterEach(() => { for (const source of sources) source.stop(); sources.length = 0; });

it('aborts pending and queued lookups and discards a late response after clearing', async () => {
  const pending = deferred();
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn(async (request: ProviderPage, signal: AbortSignal) => {
    signals.push(signal);
    await pending.promise;
    return loadProviderConfig(request.repository, ref, signal, async () => null, fileUrl);
  });
  const source = new ProviderRepoConfigSource(fetcher, () => undefined);
  sources.push(source);
  source.get(page, DEFAULT_SETTINGS);
  source.get({ ...page, repository: { ...page.repository, path: 'owner/two' } }, DEFAULT_SETTINGS);
  source.get({ ...page, repository: { ...page.repository, path: 'owner/three' } }, DEFAULT_SETTINGS);
  expect(fetcher).toHaveBeenCalledTimes(2);
  source.setActive(false);
  await source.clearCache();
  expect(signals.every(signal => signal.aborted)).toBe(true);
  pending.resolve();
  await vi.waitFor(() => expect(store.get).toHaveBeenCalledTimes(2));
  expect(store.value).toEqual({});
  expect(source.get(page, DEFAULT_SETTINGS).status).toBe('loading');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('invalidates a file read that completes after cache removal even without an abort signal', async () => {
  const pending = deferred();
  const reader = vi.fn(async () => { await pending.promise; return 'categories:\n  tests: false'; });
  const result = loadProviderConfig(page.repository, ref, new AbortController().signal, reader, fileUrl);
  const rejected = expect(result).rejects.toThrow('cache was cleared');
  await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
  await clearProviderConfigCache();
  pending.resolve();
  await rejected;
  expect(store.value).toEqual({});
});

it.each(['read', 'write'])('clears after an already queued storage %s without restoring old data', async phase => {
  const entered = deferred(), release = deferred();
  if (phase === 'read') {
    store.get.mockImplementationOnce(async () => store.value).mockImplementationOnce(async () => { entered.resolve(); await release.promise; return store.value; });
  } else {
    store.set.mockImplementationOnce(async value => { entered.resolve(); await release.promise; store.value = value; });
  }
  const old = loadProviderConfig(page.repository, ref, new AbortController().signal, async () => 'categories:\n  tests: false', fileUrl);
  const rejected = expect(old).rejects.toThrow('cache was cleared');
  await entered.promise;
  const clearing = clearProviderConfigCache();
  release.resolve();
  await clearing;
  await rejected;
  expect(store.value).toEqual({});
  await loadProviderConfig(page.repository, ref, new AbortController().signal, async () => null, fileUrl);
  expect(Object.keys(store.value)).toHaveLength(2);
});

it.each(['read', 'write'])('keeps fetched repository rules when the cache %s fails', async phase => {
  if (phase === 'read') store.get.mockImplementationOnce(async () => store.value).mockRejectedValueOnce(new Error('Cache read failed'));
  else store.set.mockRejectedValueOnce(new Error('Storage quota exceeded'));
  const source = new ProviderRepoConfigSource((request, signal) => loadProviderConfig(request.repository, ref, signal, async path => path === '.github/geld.yml' ? 'categories:\n  tests: false' : null, fileUrl), () => undefined);
  sources.push(source);
  const settings = { ...DEFAULT_SETTINGS, repoConfigs: 'always' as const };
  source.get(page, settings);
  await vi.waitFor(() => expect(source.get(page, settings).status).toBe('ready'));
  expect(source.get(page, settings).settings.categories.tests).toBe(false);
});
