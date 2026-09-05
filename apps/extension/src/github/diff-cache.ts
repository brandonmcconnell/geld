import { storage } from 'wxt/utils/storage';
import type { FileStats } from '@geld/core';

/**
 * Parsed diffs keyed by their `.diff` URL and pinned to a commit SHA. A pull
 * request whose head commit has not changed since we last saw it needs no
 * network request at all; when the head moves, the entry is simply replaced.
 */
interface CachedDiff {
  readonly sha: string;
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
  return typeof record.sha === 'string' && Array.isArray(record.files) && typeof record.at === 'number';
}

export class DiffCache {
  private loaded: Promise<CacheMap> | null = null;
  private map: CacheMap = {};

  /** Load once; subsequent calls are instant. */
  async ready(): Promise<void> {
    if (this.loaded === null) {
      this.loaded = cacheItem.getValue().then((value) => {
        const clean: CacheMap = {};
        for (const [key, entry] of Object.entries(value)) if (isCachedDiff(entry)) clean[key] = entry;
        this.map = clean;
        return clean;
      });
    }
    await this.loaded;
  }

  get(diffUrl: string, sha: string): readonly FileStats[] | null {
    const entry = this.map[diffUrl];
    return entry !== undefined && entry.sha === sha ? entry.files : null;
  }

  set(diffUrl: string, sha: string, files: readonly FileStats[]): void {
    if (files.length > MAX_FILES_PER_ENTRY) return;
    this.map[diffUrl] = { sha, files, at: Date.now() };
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
