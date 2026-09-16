import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import type { RepoConfig, RepoConfigParse, SettingsIssue } from '@geld/core';
import { BUNDLED_CATALOG, ORG_CONFIG_PATHS, ORG_CONFIG_REPO, REPO_CONFIG_PATH, generatedConfigFrom, isEmptyRepoConfig, parseRepoConfig } from '@geld/core';
import type { Catalog } from '@geld/core';
import { looksLikeHtml } from '../lib/http';
import type { FetchFileRequest } from '../lib/messages';
import { isFetchFileResponse } from '../lib/messages';

/**
 * Fetches and caches the files a repository uses to configure Geld:
 * `.github/geld.yml` in the repository, the organisation's defaults in its
 * `.github` repository, and `.gitattributes` for `linguist-generated`.
 *
 * Most repositories have none of these, and a `fetch` that ends in 404 is
 * printed as an error in the console of whichever context made it — so no
 * request here is allowed to 404 in the page (see {@link RepoConfigSource.readFile}):
 * the repository's own files are read from the page with the session cookie
 * (private repositories work with no token) but only after GitHub's
 * directory listing said they exist; the organisation's `.github` repository,
 * public by GitHub's own rule for default community files, is read by the
 * background from raw.githubusercontent.com.
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
const PUBLIC_RAW_HOST = 'raw.githubusercontent.com';

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
  /** Parsed results per repository, invalidated whenever a file for it lands. */
  private readonly resolved = new Map<string, ResolvedRepoConfig>();

  constructor(
    private readonly onChange: () => void,
    catalog: Catalog = BUNDLED_CATALOG,
  ) {
    this.catalog = catalog;
    void cacheItem.getValue().then((value) => {
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
      text = await this.readFile(job);
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

  /**
   * The file's text, `null` when the repository has no such file; throws on
   * anything transient. Which context reads it is chosen so that an expected
   * miss never shows up as a 404 in the page's console:
   *
   * - The organisation's `.github` repository has to be public (GitHub's rule
   *   for default community files), so the background reads it — from
   *   raw.githubusercontent.com without credentials on github.com, where the
   *   host's `Access-Control-Allow-Origin: *` is accepted; from the server's
   *   own `raw` path on an Enterprise host. A miss is a 404 in the worker.
   * - The repository's own files may be private, so they are read from the
   *   page with the session cookie — but only once GitHub's directory
   *   listing (a same-origin JSON request, 200 whenever the repository is
   *   visible) says the file exists. Without a usable listing the file is
   *   fetched directly, which is the pre-listing behaviour.
   */
  private async readFile(job: Job): Promise<string | null> {
    if (job.repo.endsWith(`/${ORG_CONFIG_REPO}`)) return readViaBackground(job);
    const exists = await this.exists(job);
    if (exists === false) return null;
    return readFromPage(job);
  }

  /** Whether `job.path` exists according to the directory listings; `null` when a listing could not be read. */
  private async exists(job: Job): Promise<boolean | null> {
    let directory = '';
    for (const segment of job.path.split('/')) {
      const paths = await this.listing(job.origin, job.repo, directory);
      if (paths === null) return null;
      const path = directory === '' ? segment : `${directory}/${segment}`;
      if (!paths.has(path)) return false;
      directory = path;
    }
    return true;
  }

  private readonly listings = new Map<string, { readonly at: number; readonly paths: Promise<ReadonlySet<string> | null> }>();

  /**
   * The paths directly inside `directory` of `repo` at HEAD, from the JSON
   * GitHub's file browser serves for its tree pages. Memoised per directory
   * for {@link TTL_MS}, the same lifetime as the files themselves.
   */
  private listing(origin: string, repo: string, directory: string): Promise<ReadonlySet<string> | null> {
    const key = `${origin}/${repo}/${directory}`;
    const known = this.listings.get(key);
    if (known !== undefined && Date.now() - known.at < TTL_MS) return known.paths;
    const paths = readListing(origin, repo, directory);
    this.listings.set(key, { at: Date.now(), paths });
    return paths;
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

/** `/owner/repo/raw/HEAD/path` on the page's origin: the session cookie decides access; github.com redirects to the CORS-open raw host. */
async function readFromPage(job: Job): Promise<string | null> {
  const response = await fetch(`${job.origin}/${job.repo}/raw/HEAD/${job.path}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'follow' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  // A 200 that is really a GitHub page (SSO interstitial, sign-in wall,
  // unavailable repository) is not a config file; treat it like a blip.
  if (looksLikeHtml(response.headers.get('content-type'), body)) throw new Error('HTML page instead of a file');
  return body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
}

/** The background reads the file (`geld:fetch-file`); anything but a file or a definite miss is a blip. */
async function readViaBackground(job: Job): Promise<string | null> {
  const url =
    new URL(job.origin).hostname === 'github.com'
      ? `https://${PUBLIC_RAW_HOST}/${job.repo}/HEAD/${job.path}`
      : `${job.origin}/${job.repo}/raw/HEAD/${job.path}`;
  const request: FetchFileRequest = { type: 'geld:fetch-file', url };
  const response: unknown = await browser.runtime.sendMessage(request);
  if (!isFetchFileResponse(response) || !response.ok) throw new Error('file unavailable');
  return response.text;
}

/**
 * GitHub's file browser answers `Accept: application/json` on a tree URL with
 * the page's data, including the directory's entries (`payload.tree.items[]
 * .path`). `null` when the answer is not that shape (signed-out HTML, a
 * changed payload, an Enterprise version without this route).
 */
async function readListing(origin: string, repo: string, directory: string): Promise<ReadonlySet<string> | null> {
  try {
    const url = `${origin}/${repo}/tree/HEAD${directory === '' ? '' : `/${directory}`}?noancestors=1`;
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.payload) || !isRecord(body.payload.tree) || !Array.isArray(body.payload.tree.items)) return null;
    const paths = new Set<string>();
    for (const item of body.payload.tree.items) {
      if (isRecord(item) && typeof item.path === 'string') paths.add(item.path);
    }
    return paths;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
