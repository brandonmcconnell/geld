import { storage } from 'wxt/utils/storage';
import type { FileStats } from '@geld/core';
import { persist } from '../lib/context';

/**
 * Parsed diffs on disk, keyed by `github:{owner}:{repo}:{pull}:{sha}` (or
 * `github:{owner}:{repo}:commit:{sha}`; GitHub Enterprise hosts get
 * `github@{host}:` instead of `github:`). A pull request whose head commit has
 * not moved is served from here with no network request; when it moves, the
 * entry for the old SHA is dropped as the new one is written. The provider
 * prefix leaves room for other forges later.
 *
 * Pull request *lists* know no head commit, so their rows are cached under
 * `…:{pull}:latest` for {@link LATEST_TTL_MS}: GitHub rate-limits `.diff`
 * requests by burst (about 48, then a block of a minute or more), and a list
 * page revisited or paged through would otherwise spend that budget on diffs
 * it fetched minutes ago. A SHA-keyed write refreshes the `latest` entry too,
 * so opening a pull request keeps its row exact.
 */
interface CachedDiff {
  readonly files: readonly FileStats[];
  readonly at: number;
}

type CacheMap = Record<string, CachedDiff>;

const MAX_ENTRIES = 400;
const MAX_FILES_PER_ENTRY = 2000;
/** How long a list row may show counts from a diff fetched without knowing the head commit. */
const LATEST_TTL_MS = 30 * 60 * 1000;
const LATEST = 'latest';

const cacheItem = storage.defineItem<CacheMap>('local:diffCache', { fallback: {} });

function isCachedDiff(value: unknown): value is CachedDiff {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return Array.isArray(record.files) && typeof record.at === 'number';
}

const PULL_DIFF = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\.diff$/;
const COMMIT_DIFF = /^\/([^/]+)\/([^/]+)\/commit\/[0-9a-f]+\.diff$/i;

/**
 * Cache key for a diff URL pinned to a commit, or `null` when the URL is not
 * something we cache (compare ranges have no single head commit).
 */
export function diffCacheKey(diffUrl: string, sha: string): string | null {
  let url: URL;
  try {
    url = new URL(diffUrl);
  } catch {
    return null;
  }
  const provider = url.hostname === 'github.com' ? 'github' : `github@${url.hostname}`;
  const pull = PULL_DIFF.exec(url.pathname);
  if (pull !== null) return `${provider}:${pull[1]}:${pull[2]}:${pull[3]}:${sha.toLowerCase()}`;
  const commit = COMMIT_DIFF.exec(url.pathname);
  if (commit !== null) return `${provider}:${commit[1]}:${commit[2]}:commit:${sha.toLowerCase()}`;
  return null;
}

/** The `…:{pull}:latest` key for a pull request diff URL, or `null` for anything else (compare ranges, commits). */
export function latestCacheKey(diffUrl: string): string | null {
  const key = diffCacheKey(diffUrl, LATEST);
  return key !== null && !key.includes(':commit:') ? key : null;
}

/** Everything before the SHA: entries sharing it describe the same pull request. */
function subjectOf(key: string): string {
  return key.slice(0, key.lastIndexOf(':'));
}

function isLatest(key: string): boolean {
  return key.endsWith(`:${LATEST}`);
}

export class DiffCache {
  private loaded: Promise<CacheMap> | null = null;
  private map: CacheMap = {};

  /** Load once; subsequent calls are instant. */
  async ready(): Promise<void> {
    if (this.loaded === null) {
      this.loaded = cacheItem.getValue().then((value) => {
        const clean: CacheMap = {};
        // Entries from before the key format was fixed (keyed by URL) are simply dropped.
        for (const [key, entry] of Object.entries(value)) if (key.startsWith('github') && isCachedDiff(entry)) clean[key] = entry;
        this.map = clean;
        return clean;
      });
    }
    await this.loaded;
  }

  get(key: string): readonly FileStats[] | null {
    const entry = this.map[key];
    if (entry === undefined) return null;
    if (isLatest(key) && Date.now() - entry.at > LATEST_TTL_MS) return null;
    return entry.files;
  }

  set(key: string, files: readonly FileStats[]): void {
    if (files.length > MAX_FILES_PER_ENTRY) return;
    const subject = subjectOf(key);
    const at = Date.now();
    if (isLatest(key)) {
      // A list row's fetch: never newer than knowledge pinned to a commit, so
      // it replaces only a previous `latest`.
      this.map[key] = { files, at };
    } else {
      for (const existing of Object.keys(this.map)) {
        if (existing !== key && subjectOf(existing) === subject) delete this.map[existing];
      }
      this.map[key] = { files, at };
      if (!key.includes(':commit:')) this.map[`${subject}:${LATEST}`] = { files, at };
    }
    const keys = Object.keys(this.map);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => (this.map[a]?.at ?? 0) - (this.map[b]?.at ?? 0))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((key) => delete this.map[key]);
    }
    persist(cacheItem.setValue(this.map));
  }

  async clear(): Promise<void> {
    this.map = {};
    await cacheItem.setValue({});
  }
}
