import type { FileStats } from '@geld/core';

/**
 * The diff cache's map, without the storage behind it (diff-cache.ts): keys,
 * the entry shape, and `writeEntry`, which keeps the map within its bounds.
 * Pure, so the eviction rules can be tested without a browser.
 */
export interface CachedDiff {
  readonly files: readonly FileStats[];
  readonly at: number;
}

export type CacheMap = Record<string, CachedDiff>;

export const MAX_ENTRIES = 400;
/**
 * A pull request with more files than this is not kept (GitHub's own files
 * tab stops listing at 3000). The cap used to be 2000, which left every
 * larger pull request fetching its counts afresh on each visit — the very
 * pages on which that takes longest.
 */
export const MAX_FILES_PER_ENTRY = 6000;
/**
 * The map's size is bounded by files, not entries: an entry weighs about a
 * hundred bytes per file, and `storage.local` gives the extension 10 MB in
 * all. Forty thousand files is roughly 4 MB; the oldest entries go first.
 */
export const MAX_TOTAL_FILES = 40_000;
/** A list row's counts are shown from disk without a refresh for this long... */
export const LATEST_FRESH_MS = 30 * 60 * 1000;
/** ...and shown at all (while a refresh runs) for this long. */
export const LATEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LATEST = 'latest';

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

export function isLatest(key: string): boolean {
  return key.endsWith(`:${LATEST}`);
}

/** Drop malformed and pre-format entries; the rest is the map as stored. */
export function cleanMap(value: CacheMap): CacheMap {
  const clean: CacheMap = {};
  for (const [key, entry] of Object.entries(value)) if (key.startsWith('github') && isCachedDiff(entry)) clean[key] = entry;
  return clean;
}

/**
 * Write `entry` into a map: a list row's `latest` replaces only a previous
 * `latest`; a SHA-keyed entry replaces every entry of the same pull request
 * and refreshes its `latest`. Oldest entries go when the map is full.
 */
export function writeEntry(map: CacheMap, key: string, entry: CachedDiff): CacheMap {
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
  const keys = Object.keys(next).sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0));
  let total = keys.reduce((sum, candidate) => sum + (next[candidate]?.files.length ?? 0), 0);
  // Oldest first, until both bounds hold; the entry just written is the newest and stays.
  for (const stale of keys) {
    if (Object.keys(next).length <= MAX_ENTRIES && total <= MAX_TOTAL_FILES) break;
    if (stale === key) continue;
    total -= next[stale]?.files.length ?? 0;
    delete next[stale];
  }
  return next;
}

