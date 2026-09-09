import { storage } from 'wxt/utils/storage';
import type { RepoConfig, RepoConfigParse, SettingsIssue } from '@geld/core';
import { BUNDLED_CATALOG, ORG_CONFIG_PATHS, ORG_CONFIG_REPO, REPO_CONFIG_PATH, generatedConfigFrom, isEmptyRepoConfig, parseRepoConfig } from '@geld/core';
import type { Catalog } from '@geld/core';

/**
 * Fetches and caches the files a repository uses to configure Geld:
 * `.github/geld.yml` in the repository, the organisation's defaults in its
 * `.github` repository, and `.gitattributes` for `linguist-generated`.
 *
 * Requests go through the page's own origin (`/owner/repo/raw/HEAD/path`),
 * so the session cookie is sent and private repositories work with no extra
 * permission or token: github.com answers with a redirect to
 * raw.githubusercontent.com, which allows any origin to read the file.
 *
 * Files are cached on disk per `github:{owner}:{repo}:{path}` (a missing file
 * is cached too) and refreshed after {@link TTL_MS}; a network error is
 * retried after a minute and never cached.
 */

const TTL_MS = 30 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const MAX_ENTRIES = 400;
const MAX_CONCURRENT = 2;
const MAX_BYTES = 256 * 1024;

interface CachedFile {
  /** `null`: the repository has no such file. */
  readonly text: string | null;
  readonly at: number;
}

type CacheMap = Record<string, CachedFile>;

const cacheItem = storage.defineItem<CacheMap>('local:repoConfigCache', { fallback: {} });

function isCachedFile(value: unknown): value is CachedFile {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (record.text === null || typeof record.text === 'string') && typeof record.at === 'number';
}

/** One config file that was looked up. */
export interface RepoConfigFile {
  readonly kind: 'repo' | 'org' | 'gitattributes';
  /** `owner/repo` the file lives in (the org's `.github` repository for `org`). */
  readonly repo: string;
  readonly path: string;
  /** Where to open it on GitHub. */
  readonly url: string;
  readonly parse: RepoConfigParse;
}

/** Everything known about a repository's configuration right now. */
export interface ResolvedRepoConfig {
  readonly repo: string;
  /** Some lookups have not finished yet; the popup shows a spinner-ish hint and the result refines later. */
  readonly loading: boolean;
  /** Files that exist, in application order (org defaults, then the repository's own, then `.gitattributes`). */
  readonly files: readonly RepoConfigFile[];
}

/** The valid configs of `resolved`, ready for `applyRepoConfigs`. */
export function validConfigs(resolved: ResolvedRepoConfig): readonly RepoConfig[] {
  const configs: RepoConfig[] = [];
  for (const file of resolved.files) if (file.parse.ok) configs.push(file.parse.config);
  return configs;
}

/** Problems across all files, prefixed with the file they belong to. */
export function configIssues(resolved: ResolvedRepoConfig): readonly { readonly file: RepoConfigFile; readonly issues: readonly SettingsIssue[] }[] {
  return resolved.files.flatMap((file) => (file.parse.ok ? [] : [{ file, issues: file.parse.issues }]));
}

type Lookup =
  | { readonly status: 'loading' }
  /** `transient`: a failed fetch, treated as "no file" until {@link RETRY_MS} has passed. */
  | { readonly status: 'done'; readonly text: string | null; readonly transient?: boolean };

interface Job {
  readonly key: string;
  readonly origin: string;
  readonly repo: string;
  readonly path: string;
}

export class RepoConfigSource {
  private catalog: Catalog;
  private readonly memory = new Map<string, Lookup>();
  private readonly retryAt = new Map<string, number>();
  private readonly queue: Job[] = [];
  private inFlight = 0;
  private persistent: CacheMap = {};
  private cacheReady = false;
  private readonly ready: Promise<void>;
  /** Parsed results per repository, invalidated whenever a file for it lands. */
  private readonly resolved = new Map<string, ResolvedRepoConfig>();

  constructor(
    private readonly onChange: () => void,
    catalog: Catalog = BUNDLED_CATALOG,
  ) {
    this.catalog = catalog;
    this.ready = cacheItem.getValue().then((value) => {
      const clean: CacheMap = {};
      const now = Date.now();
      for (const [key, entry] of Object.entries(value)) if (isCachedFile(entry) && now - entry.at < TTL_MS) clean[key] = entry;
      this.persistent = clean;
      this.cacheReady = true;
      if (Object.keys(clean).length !== Object.keys(value).length) void cacheItem.setValue(clean);
      this.onChange();
    });
  }

  /** A new catalog changes which group keys are valid; parse everything again. */
  setCatalog(catalog: Catalog): void {
    if (catalog === this.catalog) return;
    this.catalog = catalog;
    this.resolved.clear();
  }

  /**
   * The configuration of `repo` as far as it is known, kicking off whatever
   * lookups are still needed. `onChange` fires when more arrives.
   */
  resolve(origin: string, repo: string): ResolvedRepoConfig {
    const cached = this.resolved.get(repo);
    if (cached !== undefined && !cached.loading) return cached;

    const owner = repo.slice(0, repo.indexOf('/'));
    const orgRepo = `${owner}/${ORG_CONFIG_REPO}`;
    const files: RepoConfigFile[] = [];
    let loading = false;

    // Organisation defaults: the first path that exists wins.
    if (repo !== orgRepo) {
      for (const path of ORG_CONFIG_PATHS) {
        const lookup = this.lookup(origin, orgRepo, path);
        if (lookup.status === 'loading') {
          loading = true;
          break;
        }
        if (lookup.text !== null) {
          files.push({ kind: 'org', repo: orgRepo, path, url: fileUrl(origin, orgRepo, path), parse: parseRepoConfig(lookup.text, this.catalog) });
          break;
        }
      }
    }
    const own = this.lookup(origin, repo, REPO_CONFIG_PATH);
    if (own.status === 'loading') loading = true;
    else if (own.text !== null) files.push({ kind: 'repo', repo, path: REPO_CONFIG_PATH, url: fileUrl(origin, repo, REPO_CONFIG_PATH), parse: parseRepoConfig(own.text, this.catalog) });

    const attributes = this.lookup(origin, repo, '.gitattributes');
    if (attributes.status === 'loading') loading = true;
    else if (attributes.text !== null) {
      const config = generatedConfigFrom(attributes.text);
      if (!isEmptyRepoConfig(config)) {
        files.push({ kind: 'gitattributes', repo, path: '.gitattributes', url: fileUrl(origin, repo, '.gitattributes'), parse: { ok: true, config } });
      }
    }

    const result: ResolvedRepoConfig = { repo, loading, files };
    this.resolved.set(repo, result);
    return result;
  }

  private lookup(origin: string, repo: string, path: string): Lookup {
    const key = cacheKey(origin, repo, path);
    const inMemory = this.memory.get(key);
    if (inMemory !== undefined) {
      const retry = this.retryAt.get(key);
      if (inMemory.status !== 'done' || inMemory.transient !== true || retry === undefined || Date.now() < retry) return inMemory;
      // The retry window is over: fetch again, still answering "no file" meanwhile.
      this.queue.push({ key, origin, repo, path });
      this.pump();
      return inMemory;
    }
    if (!this.cacheReady) return { status: 'loading' };
    const cached = this.persistent[key];
    if (cached !== undefined && Date.now() - cached.at < TTL_MS) {
      const done: Lookup = { status: 'done', text: cached.text };
      this.memory.set(key, done);
      return done;
    }
    this.memory.set(key, { status: 'loading' });
    this.queue.push({ key, origin, repo, path });
    this.pump();
    return { status: 'loading' };
  }

  private pump(): void {
    while (this.inFlight < MAX_CONCURRENT) {
      const job = this.queue.shift();
      if (job === undefined) return;
      this.inFlight += 1;
      void this.fetchFile(job).finally(() => {
        this.inFlight -= 1;
        this.pump();
      });
    }
  }

  private async fetchFile(job: Job): Promise<void> {
    let text: string | null;
    try {
      const response = await fetch(`${job.origin}/${job.repo}/raw/HEAD/${job.path}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'follow' });
      if (response.status === 404) {
        text = null;
      } else if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      } else {
        const body = await response.text();
        text = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
      }
    } catch {
      // Network blip, rate limit, signed-out redirect loop: behave as if there
      // were no file so the page settles, try again in a while, store nothing.
      this.memory.set(job.key, { status: 'done', text: null, transient: true });
      this.retryAt.set(job.key, Date.now() + RETRY_MS);
      this.invalidate(job.repo);
      this.onChange();
      return;
    }
    this.retryAt.delete(job.key);
    this.memory.set(job.key, { status: 'done', text });
    this.persistent[job.key] = { text, at: Date.now() };
    this.trim();
    void cacheItem.setValue(this.persistent);
    this.invalidate(job.repo);
    this.onChange();
  }

  /** A file of `repo` changed; every repository that may read it (all of an org's repos for `.github`) is re-resolved. */
  private invalidate(repo: string): void {
    if (repo.endsWith(`/${ORG_CONFIG_REPO}`)) {
      const owner = repo.slice(0, repo.indexOf('/'));
      for (const key of [...this.resolved.keys()]) if (key.startsWith(`${owner}/`)) this.resolved.delete(key);
    } else {
      this.resolved.delete(repo);
    }
  }

  private trim(): void {
    const keys = Object.keys(this.persistent);
    if (keys.length <= MAX_ENTRIES) return;
    keys.sort((a, b) => (this.persistent[a]?.at ?? 0) - (this.persistent[b]?.at ?? 0));
    for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete this.persistent[key];
  }
}

function cacheKey(origin: string, repo: string, path: string): string {
  const host = new URL(origin).hostname;
  const provider = host === 'github.com' ? 'github' : `github@${host}`;
  return `${provider}:${repo.replace('/', ':')}:${path}`;
}

function fileUrl(origin: string, repo: string, path: string): string {
  return `${origin}/${repo}/blob/HEAD/${path}`;
}
