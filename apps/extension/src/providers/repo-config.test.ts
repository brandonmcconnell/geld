import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatcher, DEFAULT_SETTINGS, isCategoryEnabled } from '@geld/core';
import type { GeldSettings, RepositoryIdentity } from '@geld/core';

const stored = vi.hoisted(() => {
  let value: unknown = {};
  return { get: () => value, set: (next: unknown) => { value = next; }, reset: () => { value = {}; } };
});
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => stored.get(), setValue: async (value: unknown) => stored.set(value) }) } }));

import { loadProviderConfig, MAX_CONFIG_BYTES, ProviderRepoConfigSource, readConfigResource, repositoryConfigChoiceKey } from './repo-config';
import type { ProviderConfigFetcher, ProviderConfigPath, ProviderRepositoryConfig } from './repo-config';
import type { ProviderPage, ProviderReviewPage, ReviewProvider } from './types';

const REF = 'a'.repeat(40);
const sources: ProviderRepoConfigSource[] = [];
function page(provider: ReviewProvider = 'gitlab'): ProviderReviewPage {
  const origin = provider === 'gitlab' ? 'https://gitlab.com' : 'https://bitbucket.org';
  const url = `${origin}/acme/widgets/${provider === 'gitlab' ? '-/merge_requests' : 'pull-requests'}/1`;
  return { provider, repository: { provider, origin, path: 'acme/widgets' }, number: '1', url, diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, kind: 'diff', headSha: 'f'.repeat(40), version: '1' };
}
function snapshot(request: ProviderPage, text = 'categories:\n  tests: false\n  generated: true\ncategoryPatterns:\n  generated:\n    - built/**\nreviewBots:\n  - coderabbit\n'): ProviderRepositoryConfig {
  return {
    repository: request.repository, ref: REF,
    files: [
      { kind: 'repo', path: '.github/geld.yml', url: `${request.repository.origin}/${request.repository.path}/blob/${REF}/.github/geld.yml`, text },
      { kind: 'gitattributes', path: '.gitattributes', url: `${request.repository.origin}/${request.repository.path}/blob/${REF}/.gitattributes`, text: 'generated/** linguist-generated' },
    ],
  };
}
function source(fetchConfig: ProviderConfigFetcher): ProviderRepoConfigSource {
  const result = new ProviderRepoConfigSource(fetchConfig, () => undefined); sources.push(result); return result;
}
function fileUrl(repository: RepositoryIdentity): (path: ProviderConfigPath) => string { return (path) => `${repository.origin}/${repository.path}/blob/${REF}/${path}`; }

beforeEach(() => { stored.reset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z')); });
afterEach(() => { for (const item of sources) item.stop(); sources.length = 0; vi.useRealTimers(); });

it('uses provider-qualified consent while preserving existing bare GitHub answers', () => {
  const gitlab = page('gitlab').repository;
  const bitbucket = page('bitbucket').repository;
  expect(repositoryConfigChoiceKey({ provider: 'github', origin: 'https://github.com', path: gitlab.path })).toBe('acme/widgets');
  expect(repositoryConfigChoiceKey(gitlab)).not.toBe('acme/widgets');
  expect(repositoryConfigChoiceKey(gitlab)).not.toBe(repositoryConfigChoiceKey(bitbucket));
});

it.each<ReviewProvider>(['gitlab', 'bitbucket'])('requires %s consent and preserves user rescues when repository patterns are applied', async (provider) => {
  const request = page(provider);
  const configs = source(async (current) => snapshot(current));
  const settings: GeldSettings = { ...DEFAULT_SETTINGS, categoryPatterns: { generated: ['!built/keep.ts'] } };
  configs.get(request, settings);
  await vi.advanceTimersByTimeAsync(0);
  const undecided = configs.get(request, settings, { 'acme/widgets': 'use' });
  expect(undecided.tab).toMatchObject({ decision: 'undecided', status: 'ready', ref: REF });
  expect(isCategoryEnabled(undecided.settings, 'tests')).toBe(true);
  expect(undecided.reviewBots).toEqual([]);
  const allowed = configs.get(request, settings, { [repositoryConfigChoiceKey(request.repository)]: 'use' });
  expect(isCategoryEnabled(allowed.settings, 'tests')).toBe(false);
  expect(allowed.reviewBots).toEqual(['coderabbit']);
  const matcher = createMatcher(allowed.settings);
  expect(matcher.categorize('built/keep.ts')).toBeNull();
  expect(matcher.categorize('built/auto.ts')?.id).toBe('generated');
  expect(matcher.categorize('generated/auto.ts')?.id).toBe('generated');
  expect(configs.get(request, settings, { [repositoryConfigChoiceKey(request.repository)]: 'ignore' }).settings).toBe(settings);
});

it('performs no source lookup when repository configurations are disabled', () => {
  const fetchConfig = vi.fn<ProviderConfigFetcher>();
  const result = source(fetchConfig).get(page(), { ...DEFAULT_SETTINGS, repoConfigs: 'never' });
  expect(result.tab).toBeNull(); expect(fetchConfig).not.toHaveBeenCalled();
});

it('keeps passive list configuration reads local until a review is demanded', async () => {
  const fetchConfig = vi.fn<ProviderConfigFetcher>(async (request) => snapshot(request));
  const configs = source(fetchConfig);
  const settings = { ...DEFAULT_SETTINGS, repoConfigs: 'always' as const };
  expect(configs.get(page(), settings, {}, false).status).toBe('loading');
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchConfig).not.toHaveBeenCalled();
  configs.get(page(), settings);
  await vi.advanceTimersByTimeAsync(0);
  expect(configs.get(page(), settings, {}, false).status).toBe('ready');
  expect(fetchConfig).toHaveBeenCalledOnce();
});

it('does not retry repository configuration before a provider cooldown longer than fifteen minutes', async () => {
  const fetchConfig = vi.fn<ProviderConfigFetcher>().mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { retryAfterMs: 60 * 60_000 }))
    .mockImplementation(async (request) => snapshot(request));
  const configs = source(fetchConfig);
  configs.get(page(), DEFAULT_SETTINGS);
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  configs.get(page(), DEFAULT_SETTINGS);
  expect(fetchConfig).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  configs.get(page(), DEFAULT_SETTINGS);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchConfig).toHaveBeenCalledTimes(2);
});

it('reports invalid repository keys and leaves personal settings unchanged', async () => {
  const configs = source(async (request) => snapshot(request, 'enabled: false\ncategories:\n  tests: false'));
  const settings: GeldSettings = { ...DEFAULT_SETTINGS, repoConfigs: 'always' };
  configs.get(page(), settings);
  await vi.advanceTimersByTimeAsync(0);
  const result = configs.get(page(), settings);
  expect(result.settings.enabled).toBe(true);
  expect(isCategoryEnabled(result.settings, 'tests')).toBe(true);
  expect(result.tab?.files[0]?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'enabled' })]));
});

it('rejects a snapshot for a different repository or a mutable branch ref', async () => {
  const settings: GeldSettings = { ...DEFAULT_SETTINGS, repoConfigs: 'always' };
  const configs = source(async (request) => ({ ...snapshot(request), ref: 'main', repository: { ...request.repository, path: 'attacker/repository' } }));
  configs.get(page(), settings);
  await vi.advanceTimersByTimeAsync(0);
  const result = configs.get(page(), settings);
  expect(result.status).toBe('failed');
  expect(result.tab?.error).toContain('different repository');
  expect(result.settings).toBe(settings);
});

it('does not turn transient authentication failures into cached missing configuration', async () => {
  const fetchConfig = vi.fn<ProviderConfigFetcher>().mockRejectedValueOnce(new Error('Sign in required')).mockImplementation(async (request) => snapshot(request));
  const configs = source(fetchConfig);
  configs.get(page(), DEFAULT_SETTINGS);
  await vi.advanceTimersByTimeAsync(0);
  expect(configs.get(page(), DEFAULT_SETTINGS).status).toBe('failed');
  expect(fetchConfig).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  configs.get(page(), DEFAULT_SETTINGS);
  await vi.advanceTimersByTimeAsync(0);
  expect(configs.get(page(), DEFAULT_SETTINGS).tab?.files).toHaveLength(2);
  expect(fetchConfig).toHaveBeenCalledTimes(2);
});

it('reuses successful and definitely missing files only for the same provider, repository and immutable ref', async () => {
  const signal = new AbortController().signal;
  const repo = page().repository;
  const reader = vi.fn(async (): Promise<string | null> => null);
  await loadProviderConfig(repo, REF, signal, reader, fileUrl(repo));
  await loadProviderConfig(repo, REF, signal, reader, fileUrl(repo));
  expect(reader).toHaveBeenCalledTimes(2);
  await loadProviderConfig(repo, 'b'.repeat(40), signal, reader, fileUrl(repo));
  const other = page('bitbucket').repository;
  await loadProviderConfig(other, REF, signal, reader, fileUrl(other));
  expect(reader).toHaveBeenCalledTimes(6);
});

it('never caches failed, HTML or oversized file reads and never accepts a mutable ref', async () => {
  const signal = new AbortController().signal;
  const repo = page().repository;
  const reader = vi.fn(async (): Promise<string | null> => { throw new Error('Rate limited'); });
  await expect(loadProviderConfig(repo, REF, signal, reader, fileUrl(repo))).rejects.toThrow('Rate limited');
  reader.mockResolvedValueOnce('<html>Sign in</html>');
  await expect(loadProviderConfig(repo, REF, signal, reader, fileUrl(repo))).rejects.toThrow('bounded text');
  reader.mockResolvedValueOnce('é'.repeat(MAX_CONFIG_BYTES));
  await expect(loadProviderConfig(repo, REF, signal, reader, fileUrl(repo))).rejects.toThrow('bounded text');
  await expect(loadProviderConfig(repo, 'main', signal, reader, fileUrl(repo))).rejects.toThrow('immutable');
  expect(reader).toHaveBeenCalledTimes(3);
  reader.mockResolvedValue(null);
  await loadProviderConfig(repo, REF, signal, reader, fileUrl(repo));
  expect(reader).toHaveBeenCalledTimes(5);
});

describe('bounded configuration transport', () => {
  const url = new URL('https://gitlab.com/api/v4/projects/acme%2Fwidgets/repository/files/.github%2Fgeld.yml/raw?ref=' + REF);
  it('distinguishes definite missing files from HTML login pages and rate limits', async () => {
    const signal = new AbortController().signal;
    const missing = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"message":"404 File Not Found"}', { status: 404, headers: { 'content-type': 'application/json' } }));
    expect((await readConfigResource(url, signal, missing, { missing: true })).text).toBeNull();
    const html = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Sign in</html>', { status: 404, headers: { 'content-type': 'text/html' } }));
    await expect(readConfigResource(url, signal, html, { missing: true })).rejects.toThrow('sign-in');
    const limited = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '30' } }));
    await expect(readConfigResource(url, signal, limited)).rejects.toMatchObject({ retryAfterMs: 30_000 });
  });
  it('limits streamed bytes even when content length lies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(MAX_CONFIG_BYTES + 1), { headers: { 'content-length': '1' } }));
    await expect(readConfigResource(url, new AbortController().signal, fetcher)).rejects.toThrow('size limit');
  });
});
