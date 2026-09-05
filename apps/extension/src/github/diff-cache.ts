import { storage } from 'wxt/utils/storage';
import type { FileStats } from '@geld/core';

/**
 * Parsed diffs on disk, keyed by `github:{owner}:{repo}:{pull}:{sha}` (or
 * `github:{owner}:{repo}:commit:{sha}`; GitHub Enterprise hosts get
 * `github@{host}:` instead of `github:`). A pull request whose head commit has
 * not moved is served from here with no network request; when it moves, the
 * entry for the old SHA is dropped as the new one is written. The provider
 * prefix leaves room for other forges later.
 */
interface CachedDiff {
  readonly files: readonly FileStats[];
  readonly at: number;
}

type CacheMap = Record<string, CachedDiff>;

const MAX_ENTRIES = 150;
const MAX_FILES_PER_ENTRY = 2000;

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

/** Everything before the SHA: entries sharing it describe the same pull request. */
function subjectOf(key: string): string {
  return key.slice(0, key.lastIndexOf(':'));
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
    return this.map[key]?.files ?? null;
  }

  set(key: string, files: readonly FileStats[]): void {
    if (files.length > MAX_FILES_PER_ENTRY) return;
    const subject = subjectOf(key);
    for (const existing of Object.keys(this.map)) {
      if (existing !== key && subjectOf(existing) === subject) delete this.map[existing];
    }
    this.map[key] = { files, at: Date.now() };
    const keys = Object.keys(this.map);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => (this.map[a]?.at ?? 0) - (this.map[b]?.at ?? 0))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((key) => delete this.map[key]);
    }
    void cacheItem.setValue(this.map);
  }

  async clear(): Promise<void> {
    this.map = {};
    await cacheItem.setValue({});
  }
}
