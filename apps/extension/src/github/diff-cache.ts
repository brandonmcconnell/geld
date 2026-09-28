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
interface CachedDiff {
  readonly files: readonly FileStats[];
  readonly at: number;
}

type CacheMap = Record<string, CachedDiff>;

const MAX_ENTRIES = 400;
const MAX_FILES_PER_ENTRY = 2000;
/** A list row's counts are shown from disk without a refresh for this long... */
const LATEST_FRESH_MS = 30 * 60 * 1000;
/** ...and shown at all (while a refresh runs) for this long. */
const LATEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
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

/** Drop malformed and pre-format entries; the rest is the map as stored. */
function cleanMap(value: CacheMap): CacheMap {
  const clean: CacheMap = {};
  for (const [key, entry] of Object.entries(value)) if (key.startsWith('github') && isCachedDiff(entry)) clean[key] = entry;
  return clean;
}

/**
 * Write `entry` into a map: a list row's `latest` replaces only a previous
 * `latest`; a SHA-keyed entry replaces every entry of the same pull request
 * and refreshes its `latest`. Oldest entries go when the map is full.
 */
function writeEntry(map: CacheMap, key: string, entry: CachedDiff): CacheMap {
  const next: CacheMap = { ...map };
  const subject = subjectOf(key);
  if (isLatest(key)) {
    next[key] = entry;
  } else {
    for (const existing of Object.keys(next)) {
      if (existing !== key && subjectOf(existing) === subject) delete next[existing];
    }
    next[key] = entry;
    if (!key.includes(':commit:')) next[`${subject}:${LATEST}`] = entry;
  }
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((stale) => delete next[stale]);
  }
  return next;
}

export class DiffCache {
  private loaded: Promise<void> | null = null;
  private map: CacheMap = {};
  /** Writes are serialised so two quick `set`s cannot race each other's read-merge-write. */
  private writing: Promise<void> = Promise.resolve();
  private unwatch: (() => void) | null = null;

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
          if (next !== null) this.map = cleanMap(next);
        });
      });
    }
    await this.loaded;
  }

  get(key: string): readonly FileStats[] | null {
    const entry = this.map[key];
    if (entry === undefined) return null;
    if (isLatest(key) && Date.now() - entry.at > LATEST_MAX_AGE_MS) return null;
    return entry.files;
  }

  /** Whether an entry can be shown without a background refresh (SHA-keyed entries always can). */
  isFresh(key: string): boolean {
    const entry = this.map[key];
    return entry !== undefined && (!isLatest(key) || Date.now() - entry.at <= LATEST_FRESH_MS);
  }

  set(key: string, files: readonly FileStats[]): void {
    if (files.length > MAX_FILES_PER_ENTRY) return;
    const entry: CachedDiff = { files, at: Date.now() };
    // Visible to this tab at once...
    this.map = writeEntry(this.map, key, entry);
    // ...and merged into what is *stored* now, not into this tab's snapshot of
    // it: writing the snapshot back used to drop every entry other tabs had
    // added since it was taken, so counts kept getting fetched again.
    this.writing = this.writing
      .then(async () => {
        const stored = cleanMap(await cacheItem.getValue());
        await cacheItem.setValue(writeEntry(stored, key, entry));
      })
      .catch(() => undefined);
    persist(this.writing);
  }

  async clear(): Promise<void> {
    this.map = {};
    await cacheItem.setValue({});
  }
}
