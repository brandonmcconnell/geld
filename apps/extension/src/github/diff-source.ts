import { browser } from 'wxt/browser';
import type { FileStats } from '@geld/core';
import type { FetchDiffRequest } from '../lib/messages';
import { isFetchDiffResponse } from '../lib/messages';
import { DiffCache, diffCacheKey } from './diff-cache';

export type DiffFetchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly files: readonly FileStats[] }
  | { readonly status: 'failed'; readonly reason: string; readonly attempts: number };

/** PR lists request one diff per row; keep GitHub happy by pacing them. */
const MAX_CONCURRENT_FETCHES = 4;
/** Slightly longer than the background cooldown so retries are not wasted. */
const RATE_LIMIT_RETRY_MS = 70 * 1000;
/**
 * Transient failures (the MV3 service worker restarting mid-request, a network
 * blip, a 5xx) retry on this schedule; without it one row in a list could stay
 * blank until a reload while its neighbours were fine.
 */
const TRANSIENT_RETRY_MS: readonly number[] = [4 * 1000, 15 * 1000, 45 * 1000];

/** Failures that will not change by asking again. */
function isDefinitive(reason: string): boolean {
  return reason === 'too-large' || reason === 'invalid-url' || reason === 'disallowed-url' || /^http-4\d\d$/.test(reason);
}

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
  /** Failed attempts so far per key, carried across the idle gap between retries. */
  private readonly retryAttempts = new Map<string, number>();
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
    const attempts = (this.retryAttempts.get(key) ?? 0) + 1;
    let reason: string;
    try {
      const response: unknown = await browser.runtime.sendMessage(request);
      if (isFetchDiffResponse(response) && response.ok) {
        this.memory.set(key, { status: 'ready', files: response.files });
        this.retryAttempts.delete(key);
        if (persistKey !== null) this.persistent.set(persistKey, response.files);
        this.onChange();
        return;
      }
      reason = isFetchDiffResponse(response) && !response.ok ? response.reason : 'bad-response';
    } catch (error) {
      // Typically "message port closed": the service worker went away mid-request.
      reason = error instanceof Error ? error.message : 'fetch-failed';
    }
    this.memory.set(key, { status: 'failed', reason, attempts });
    // Forget the failure later so the next apply() asks again — after the
    // background cooldown for rate limits, on a short backoff for anything
    // transient. Definitive failures stay failed for this page.
    const delay = reason === 'rate-limited' ? RATE_LIMIT_RETRY_MS : isDefinitive(reason) ? null : (TRANSIENT_RETRY_MS[attempts - 1] ?? null);
    if (delay !== null) {
      setTimeout(() => {
        const current = this.memory.get(key);
        if (current?.status !== 'failed') return;
        // Keep the attempt count so the backoff continues from where it was.
        this.memory.set(key, { status: 'idle' });
        this.retryAttempts.set(key, attempts);
        this.onChange();
      }, delay);
    }
    this.onChange();
  }
}
