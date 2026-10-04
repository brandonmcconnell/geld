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
 * Pull request *lists* know no head commit (the list markup carries none), so
 * their rows are cached under `…:{pull}:latest`, served stale-while-revalidate:
 * an entry is used for up to {@link LATEST_MAX_AGE_MS} so a row is never
 * blank, and one older than {@link LATEST_FRESH_MS} is refreshed in the
 * background once shown. GitHub rate-limits `.diff` requests by burst (about
 * 45–48, then a block of a minute or more), and a list page revisited or paged
 * through would otherwise spend that budget on diffs it fetched minutes ago.
 * A SHA-keyed write refreshes the `latest` entry too, so opening a pull
 * request keeps its row exact.
 */
export type { CachedDiff, CacheMap } from './diff-cache-map';
import type { CachedDiff, CacheMap } from './diff-cache-map';
import { cleanMap, isLatest, LATEST_FRESH_MS, LATEST_MAX_AGE_MS, MAX_FILES_PER_ENTRY, writeEntry } from './diff-cache-map';
export { diffCacheKey, latestCacheKey } from './diff-cache-map';

const cacheItem = storage.defineItem<CacheMap>('local:diffCache', { fallback: {} });

/**
 * How long entries are gathered before one write stores them all. A list page
 * produces a dozen diffs within a second or two; one write per diff meant a
 * dozen storage writes and a dozen `onChanged` deliveries to every other
 * GitHub tab, each of which rebuilt its copy of the whole map.
 */
const WRITE_DELAY_MS = 250;

export class DiffCache {
  private loaded: Promise<void> | null = null;
  private map: CacheMap = {};
  /** Writes are serialised so two flushes cannot race each other's read-merge-write. */
  private writing: Promise<void> = Promise.resolve();
  /** Entries set since the last flush, in order; one read-merge-write stores them all. */
  private pendingWrites = new Map<string, CachedDiff>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private unwatch: (() => void) | null = null;
  /**
   * Another tab's write that arrived while this tab was hidden. Rebuilding the
   * map is work nobody in a hidden tab is waiting for; the latest version is
   * kept and taken up by the first read after the tab shows again.
   */
  private deferred: CacheMap | null = null;

  /** Load once; subsequent calls are instant. */
  async ready(): Promise<void> {
    if (this.loaded === null) {
      this.loaded = cacheItem.getValue().then((value) => {
        this.map = cleanMap(value);
        // Every GitHub tab has its own copy of this map. Another tab's write
        // (a pull request opened from a list) lands here as it happens, so
        // this tab neither re-fetches what that tab just counted nor, on its
        // own next write, overwrites it with a snapshot from before.
        this.unwatch ??= cacheItem.watch((next) => {
          if (next === null) return;
          if (typeof document !== 'undefined' && document.hidden) {
            this.deferred = next;
            return;
          }
          this.deferred = null;
          this.map = cleanMap(next);
        });
      });
    }
    await this.loaded;
  }

  /** Take up a write deferred while hidden, with this tab's own unflushed entries kept on top. */
  private settle(): void {
    if (this.deferred === null) return;
    let map = cleanMap(this.deferred);
    this.deferred = null;
    for (const [key, entry] of this.pendingWrites) map = writeEntry(map, key, entry);
    this.map = map;
  }

  get(key: string): readonly FileStats[] | null {
    this.settle();
    const entry = this.map[key];
    if (entry === undefined) return null;
    if (isLatest(key) && Date.now() - entry.at > LATEST_MAX_AGE_MS) return null;
    return entry.files;
  }

  /** Whether an entry can be shown without a background refresh (SHA-keyed entries always can). */
  isFresh(key: string): boolean {
    this.settle();
    const entry = this.map[key];
    return entry !== undefined && (!isLatest(key) || Date.now() - entry.at <= LATEST_FRESH_MS);
  }

  set(key: string, files: readonly FileStats[]): void {
    if (files.length > MAX_FILES_PER_ENTRY) return;
    this.settle();
    const entry: CachedDiff = { files, at: Date.now() };
    // Visible to this tab at once...
    this.map = writeEntry(this.map, key, entry);
    // ...and stored shortly, together with whatever else lands meanwhile.
    this.pendingWrites.set(key, entry);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, WRITE_DELAY_MS);
  }

  /**
   * One write for every entry gathered, merged into what is *stored* now, not
   * into this tab's snapshot of it: writing the snapshot back used to drop
   * every entry other tabs had added since it was taken, so counts kept
   * getting fetched again.
   */
  private flush(): void {
    const batch = this.pendingWrites;
    if (batch.size === 0) return;
    this.pendingWrites = new Map();
    this.writing = this.writing
      .then(async () => {
        let stored = cleanMap(await cacheItem.getValue());
        for (const [key, entry] of batch) stored = writeEntry(stored, key, entry);
        await cacheItem.setValue(stored);
      })
      .catch(() => undefined);
    persist(this.writing);
  }

  async clear(): Promise<void> {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pendingWrites = new Map();
    this.deferred = null;
    this.map = {};
    await cacheItem.setValue({});
  }
}
