import type { Catalog, GeldSettings, RepoConfig, RepoConfigParse, RepositoryIdentity } from '@geld/core';
import { applyRepoConfigs, BUNDLED_CATALOG, declaredReviewBots, describeRepoConfig, generatedConfigFrom, parseRepoConfig, repositoryKey } from '@geld/core';
import { REVIEW_BOTS } from '@geld/review';
import { storage } from 'wxt/utils/storage';
import type { RepoConfigChoices } from '../lib/local-state';
import type { TabRepoConfig } from '../lib/messages';
import { looksLikeHtml } from '../lib/http';
import type { ProviderPage } from './types';

export type ProviderConfigPath = '.github/geld.yml' | '.gitattributes';
export const PROVIDER_CONFIG_PATHS: readonly ProviderConfigPath[] = ['.github/geld.yml', '.gitattributes'];
export const CONFIG_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
export const MAX_CONFIG_BYTES = 256 * 1024;
const TTL_MS = 30 * 60_000;
const RETRY_MS = 60_000;
const CACHE_LIMIT = 400;

export interface ProviderRepositoryConfigFile {
  readonly kind: 'repo' | 'gitattributes';
  readonly path: ProviderConfigPath;
  readonly url: string;
  readonly text: string | null;
}

export interface ProviderRepositoryConfig {
  readonly repository: RepositoryIdentity;
  readonly ref: string;
  readonly files: readonly ProviderRepositoryConfigFile[];
}

export type ProviderConfigFetcher = (page: ProviderPage, signal: AbortSignal) => Promise<ProviderRepositoryConfig>;

export interface ProviderConfigResolution {
  readonly settings: GeldSettings;
  readonly tab: TabRepoConfig | null;
  readonly status: 'loading' | 'ready' | 'failed';
  readonly error: string | null;
  readonly reviewBots: readonly string[];
}

export class ProviderConfigError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) { super(message); this.name = 'ProviderConfigError'; }
}

export function repositoryConfigChoiceKey(repository: RepositoryIdentity): string {
  return repository.provider === 'github' ? repository.path : repositoryKey(repository);
}

export function configRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteSize(text: string): number { return new TextEncoder().encode(text).byteLength; }

async function boundedBody(response: Response, signal: AbortSignal, limit: number): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > limit) throw new ProviderConfigError('Repository configuration exceeds its size limit');
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new ProviderConfigError('Repository configuration exceeds its size limit'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function readConfigResource(
  url: URL,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  options: { readonly missing?: boolean; readonly json?: boolean; readonly credentials?: RequestCredentials } = {},
): Promise<{ readonly text: string | null; readonly headers: Headers }> {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new ProviderConfigError('Invalid repository configuration source');
  const response = await fetcher(url.href, {
    signal, credentials: options.credentials ?? 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { Accept: options.json === true ? 'application/json' : 'text/plain' },
  });
  if (response.redirected || (response.url !== '' && response.url !== url.href)) throw new ProviderConfigError('Repository configuration source redirected unexpectedly');
  const text = await boundedBody(response, signal, options.json === true ? 2 * 1024 * 1024 : MAX_CONFIG_BYTES);
  if (looksLikeHtml(response.headers.get('content-type'), text)) throw new ProviderConfigError('Repository configuration source returned a sign-in page');
  if (response.status === 404 && options.missing === true) return { text: null, headers: response.headers };
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    const seconds = retry === null ? NaN : Number(retry);
    const date = retry === null ? NaN : Date.parse(retry) - Date.now();
    const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date) : undefined;
    throw new ProviderConfigError(response.status === 401 || response.status === 403 ? 'Sign in to read repository configuration' : `Repository configuration source returned HTTP ${response.status}`, delay);
  }
  if (options.json === true && !/^application\/(?:[\w.+-]*\+)?json\b/i.test(response.headers.get('content-type') ?? '')) throw new ProviderConfigError('Repository configuration metadata is not JSON');
  return { text, headers: response.headers };
}

export async function configJson(url: URL, signal: AbortSignal, fetcher: typeof fetch = fetch, credentials: RequestCredentials = 'same-origin'): Promise<{ readonly value: unknown; readonly headers: Headers }> {
  const response = await readConfigResource(url, signal, fetcher, { json: true, credentials });
  try { const value: unknown = JSON.parse(response.text ?? ''); return { value, headers: response.headers }; }
  catch { throw new ProviderConfigError('Repository configuration metadata is invalid JSON'); }
}

interface CachedFile { readonly text: string | null; readonly at: number; }
const cacheItem = storage.defineItem<Readonly<Record<string, CachedFile>>>('local:providerRepoConfigCache', { fallback: {} });
let writeQueue: Promise<unknown> = Promise.resolve();

function cachedFile(value: unknown): value is CachedFile {
  return configRecord(value) && (value.text === null || typeof value.text === 'string') && typeof value.at === 'number'
    && Number.isFinite(value.at) && (value.text === null || byteSize(value.text) <= MAX_CONFIG_BYTES);
}

async function cacheFile(key: string, text: string | null): Promise<void> {
  const run = writeQueue.then(async () => {
    const stored = await cacheItem.getValue();
    const now = Date.now();
    const entries = Object.entries(stored).filter(([storedKey, value]) => storedKey !== key && cachedFile(value) && now >= value.at && now - value.at < TTL_MS);
    entries.push([key, { text, at: now }]);
    entries.sort((left, right) => right[1].at - left[1].at);
    await cacheItem.setValue(Object.fromEntries(entries.slice(0, CACHE_LIMIT)));
  });
  writeQueue = run.catch(() => undefined);
  await writeQueue;
}

export async function loadProviderConfig(
  repository: RepositoryIdentity,
  ref: string,
  signal: AbortSignal,
  readFile: (path: ProviderConfigPath) => Promise<string | null>,
  fileUrl: (path: ProviderConfigPath) => string,
): Promise<ProviderRepositoryConfig> {
  if (!CONFIG_SHA.test(ref)) throw new ProviderConfigError('Repository configuration is not pinned to an immutable revision');
  const stored = await cacheItem.getValue();
  const files: ProviderRepositoryConfigFile[] = [];
  for (const path of PROVIDER_CONFIG_PATHS) {
    signal.throwIfAborted();
    const key = JSON.stringify([repositoryKey(repository), ref, path]);
    const cached = stored[key];
    const usable = cachedFile(cached) && Date.now() >= cached.at && Date.now() - cached.at < TTL_MS;
    const url = new URL(fileUrl(path));
    if (url.origin !== repository.origin || url.username !== '' || url.password !== '') throw new ProviderConfigError('Invalid repository configuration file link');
    const text = usable ? cached.text : await readFile(path);
    signal.throwIfAborted();
    if (text !== null && (byteSize(text) > MAX_CONFIG_BYTES || looksLikeHtml(null, text))) throw new ProviderConfigError('Repository configuration is not a valid bounded text file');
    if (!usable) await cacheFile(key, text);
    files.push({ kind: path === '.gitattributes' ? 'gitattributes' : 'repo', path, url: url.href, text });
  }
  return { repository, ref, files };
}

interface Lookup {
  readonly page: ProviderPage;
  status: 'loading' | 'ready' | 'failed';
  snapshot: ProviderRepositoryConfig | null;
  error: string | null;
  at: number;
  retryAt: number;
  abort: AbortController | null;
  queued: boolean;
}

export class ProviderRepoConfigSource {
  private readonly lookups = new Map<string, Lookup>();
  private readonly queue: Lookup[] = [];
  private running = 0;
  private active = true;
  private stopped = false;
  private catalog: Catalog;

  constructor(private readonly fetchConfig: ProviderConfigFetcher, private readonly changed: () => void, catalog: Catalog = BUNDLED_CATALOG) { this.catalog = catalog; }

  setCatalog(catalog: Catalog): void { this.catalog = catalog; }
  setActive(active: boolean): void { this.active = active; if (active) this.pump(); }
  stop(): void {
    this.stopped = true;
    for (const lookup of this.lookups.values()) lookup.abort?.abort();
    this.lookups.clear(); this.queue.length = 0;
  }

  get(page: ProviderPage, settings: GeldSettings, choices: RepoConfigChoices = {}, allowFetch = true): ProviderConfigResolution {
    if (settings.repoConfigs === 'never') return { settings, tab: null, status: 'ready', error: null, reviewBots: [] };
    const key = repositoryKey(page.repository);
    let lookup = this.lookups.get(key);
    if (lookup === undefined) {
      lookup = { page, status: 'loading', snapshot: null, error: null, at: 0, retryAt: 0, abort: null, queued: false };
      this.lookups.set(key, lookup);
      for (const [candidate, entry] of this.lookups) {
        if (this.lookups.size <= 100) break;
        if (candidate !== key && entry.abort === null && !entry.queued) this.lookups.delete(candidate);
      }
    }
    if (allowFetch && !this.stopped && !lookup.queued && lookup.abort === null && Date.now() >= lookup.retryAt && (lookup.status !== 'ready' || Date.now() - lookup.at >= TTL_MS)) {
      lookup.queued = true; this.queue.push(lookup); this.pump();
    }
    const choice = choices[repositoryConfigChoiceKey(page.repository)];
    const decision = settings.repoConfigs === 'always' || choice === 'use' ? 'use' : choice === 'ignore' ? 'ignore' : 'undecided';
    const configs: RepoConfig[] = [];
    const files = (lookup.snapshot?.files ?? []).flatMap((file) => {
      if (file.text === null) return [];
      const parsed: RepoConfigParse = file.kind === 'gitattributes' ? { ok: true, config: generatedConfigFrom(file.text) } : parseRepoConfig(file.text, this.catalog, REVIEW_BOTS.map((bot) => bot.id));
      if (parsed.ok) configs.push(parsed.config);
      return [{ kind: file.kind, repo: page.repository.path, path: file.path, url: file.url, summary: parsed.ok ? describeRepoConfig(parsed.config) : '', issues: parsed.ok ? [] : parsed.issues }];
    });
    const tab: TabRepoConfig = {
      repo: page.repository.path, mode: settings.repoConfigs, decision, loading: lookup.status === 'loading', files, status: lookup.status,
      ...(lookup.error === null ? {} : { error: lookup.error }), ...(lookup.snapshot === null ? {} : { ref: lookup.snapshot.ref }),
    };
    return {
      settings: decision === 'use' ? applyRepoConfigs(settings, configs) : settings,
      tab, status: lookup.status, error: lookup.error,
      reviewBots: decision === 'use' ? declaredReviewBots(configs) : [],
    };
  }

  private pump(): void {
    if (this.stopped || !this.active) return;
    while (this.running < 2) {
      const lookup = this.queue.shift();
      if (lookup === undefined) break;
      lookup.queued = false;
      const abort = new AbortController();
      lookup.abort = abort;
      this.running += 1;
      void this.fetchConfig(lookup.page, abort.signal).then((snapshot) => {
        if (this.stopped) return;
        if (!CONFIG_SHA.test(snapshot.ref) || repositoryKey(snapshot.repository) !== repositoryKey(lookup.page.repository)
          || snapshot.files.length !== PROVIDER_CONFIG_PATHS.length || PROVIDER_CONFIG_PATHS.some((path) => snapshot.files.filter((file) => file.path === path).length !== 1)) throw new ProviderConfigError('Repository configuration source returned a different repository or incomplete files');
        lookup.snapshot = snapshot; lookup.status = 'ready'; lookup.error = null; lookup.at = Date.now(); lookup.retryAt = 0;
      }).catch((error: unknown) => {
        if (this.stopped) return;
        lookup.snapshot = null; lookup.status = 'failed'; lookup.error = error instanceof Error ? error.message : 'Repository configuration unavailable';
        const retry = configRecord(error) ? error.retryAfterMs : undefined;
        lookup.retryAt = Date.now() + (typeof retry === 'number' && Number.isFinite(retry) && retry > 0 ? retry : RETRY_MS);
      }).finally(() => {
        lookup.abort = null; this.running -= 1;
        if (!this.stopped) { this.changed(); this.pump(); }
      });
    }
  }
}
