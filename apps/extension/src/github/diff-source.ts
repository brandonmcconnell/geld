import { browser } from 'wxt/browser';
import type { FileStats } from '@geld/core';
import type { FetchDiffRequest } from '../lib/messages';
import { isFetchDiffResponse } from '../lib/messages';
import { DiffCache, diffCacheKey } from './diff-cache';

export type DiffFetchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly files: readonly FileStats[] }
  | { readonly status: 'failed' };

/** PR lists request one diff per row; keep GitHub happy by pacing them. */
const MAX_CONCURRENT_FETCHES = 4;
/** Slightly longer than the background cooldown so retries are not wasted. */
const RATE_LIMIT_RETRY_MS = 70 * 1000;

/**
 * Lazily asks the background script for `<page>.diff` and caches the per-file
 * statistics — in memory for this page, and on disk keyed by commit SHA so a
 * pull request that has not changed never needs a second request.
 */
export class DiffSource {
  /** Keyed by cache key when the commit is known (so a new push is a new entry), else by URL. */
  private readonly memory = new Map<string, DiffFetchState>();
  private readonly queue: Array<{ readonly url: string; readonly key: string; readonly persistKey: string | null }> = [];
  private readonly persistent = new DiffCache();
  private cacheReady = false;
  private inFlight = 0;

  constructor(private readonly onChange: () => void) {
    void this.persistent.ready().then(() => {
      this.cacheReady = true;
      this.onChange();
    });
  }

  get(diffUrl: string, sha: string | null = null): DiffFetchState {
    return this.memory.get(this.keyFor(diffUrl, sha)) ?? { status: 'idle' };
  }

  /**
   * Start fetching if needed and return the current state. When `sha` is known
   * and the diff is on disk, the result is ready immediately with no request.
   * Until the on-disk cache has loaded, a request with a SHA waits (reported as
   * `loading`) rather than fetching something we very likely already have.
   */
  request(diffUrl: string, sha: string | null = null): DiffFetchState {
    const key = this.keyFor(diffUrl, sha);
    const current = this.memory.get(key) ?? { status: 'idle' };
    if (current.status !== 'idle') return current;

    const persistKey = sha === null ? null : diffCacheKey(diffUrl, sha);
    if (persistKey !== null) {
      if (!this.cacheReady) return { status: 'loading' };
      const cached = this.persistent.get(persistKey);
      if (cached !== null) {
        const ready: DiffFetchState = { status: 'ready', files: cached };
        this.memory.set(key, ready);
        return ready;
      }
    }

    const loading: DiffFetchState = { status: 'loading' };
    this.memory.set(key, loading);
    this.queue.push({ url: diffUrl, key, persistKey });
    this.pump();
    return loading;
  }

  private keyFor(diffUrl: string, sha: string | null): string {
    return (sha === null ? null : diffCacheKey(diffUrl, sha)) ?? diffUrl;
  }

  /** Drop everything cached on disk (options page action). */
  async clearPersistent(): Promise<void> {
    await this.persistent.clear();
  }

  private pump(): void {
    while (this.inFlight < MAX_CONCURRENT_FETCHES) {
      const next = this.queue.shift();
      if (next === undefined) return;
      this.inFlight += 1;
      void this.load(next.url, next.key, next.persistKey).finally(() => {
        this.inFlight -= 1;
        this.pump();
      });
    }
  }

  private async load(diffUrl: string, key: string, persistKey: string | null): Promise<void> {
    const request: FetchDiffRequest = { type: 'geld:fetch-diff', url: diffUrl };
    try {
      const response: unknown = await browser.runtime.sendMessage(request);
      if (isFetchDiffResponse(response) && response.ok) {
        this.memory.set(key, { status: 'ready', files: response.files });
        if (persistKey !== null) this.persistent.set(persistKey, response.files);
      } else {
        this.memory.set(key, { status: 'failed' });
        if (isFetchDiffResponse(response) && !response.ok && response.reason === 'rate-limited') {
          // Forget the failure once the background cooldown has passed so the
          // page picks the numbers up later without a reload.
          setTimeout(() => {
            this.memory.delete(key);
            this.onChange();
          }, RATE_LIMIT_RETRY_MS);
        }
      }
    } catch {
      this.memory.set(key, { status: 'failed' });
    }
    this.onChange();
  }
}
