import { browser } from 'wxt/browser';
import type { FileStats } from '@geld/core';
import type { DiffPriority, FetchDiffRequest } from '../lib/messages';
import { isFetchDiffResponse } from '../lib/messages';
import { DiffCache, diffCacheKey, latestCacheKey } from './diff-cache';

export type DiffFetchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly files: readonly FileStats[] }
  | { readonly status: 'failed'; readonly reason: string; readonly attempts: number };

/** PR lists request one diff per row; the background paces them further, under GitHub's burst limit. */
const MAX_CONCURRENT_FETCHES = 4;
/** When the background did not say how long its rate-limit block lasts. */
const RATE_LIMIT_RETRY_MS = 70 * 1000;
/** Retry a little after the block lifts, not exactly as it does. */
const RATE_LIMIT_SLACK_MS = 2 * 1000;
/**
 * Transient failures (the MV3 service worker restarting mid-request, a network
 * blip, a 5xx) retry on this schedule, then keep retrying at its last step;
 * without it one row in a list could stay blank until a reload while its
 * neighbours were fine.
 */
const TRANSIENT_RETRY_MS: readonly number[] = [4 * 1000, 15 * 1000, 45 * 1000];
/** Give up on a transient failure after this many tries; the row then says so. */
const TRANSIENT_MAX_ATTEMPTS = 8;
/** A little spread so a page of queued rows does not re-ask in one burst. */
const QUEUE_JITTER_MS = 400;
/** GitHub answering 5xx keeps a row loading through this many pauses before the row says so. */
const BUSY_MAX_WAITS = 6;
/**
 * The page's own subject does not sit out a busy pause with the rows: one
 * request is a fair probe, and the header is what the reader opened the page
 * for. It asks again on this schedule (then keeps the last step) until the
 * host answers or `BUSY_MAX_WAITS` is spent.
 */
const PAGE_BUSY_RETRY_MS: readonly number[] = [1500, 3000, 6000, 12000];

/**
 * Failures that will not change by asking again on this page. Sign-in
 * problems (a 404 or GitHub's login page for a private repository) are among
 * them: the fix is signing in and reloading, and retrying every row of a list
 * in the meantime would only spend the rate budget. The background does not
 * cache them, so the reload after signing in gets fresh answers.
 */
function isDefinitive(reason: string): boolean {
  return reason === 'too-large' || reason === 'invalid-url' || reason === 'disallowed-url' || reason === 'signed-out' || reason === 'not-a-diff' || /^http-4\d\d$/.test(reason);
}

/**
 * Lazily asks the background script for `<page>.diff` and caches the per-file
 * statistics — in memory for this page, and on disk keyed by commit SHA so a
 * pull request that has not changed never needs a second request.
 */
export class DiffSource {
  /** Keyed by cache key when the commit is known (so a new push is a new entry), else by URL. */
  private readonly memory = new Map<string, DiffFetchState>();
  private readonly queue: Array<{ readonly url: string; readonly key: string; readonly persistKey: string | null; readonly revalidate: boolean; readonly priority: DiffPriority }> = [];
  private readonly persistent = new DiffCache();
  /** Keys whose stale on-disk entry is on screen while a fresh copy is fetched. */
  private readonly revalidating = new Set<string>();
  /** Failed attempts so far per key, carried across the idle gap between retries. */
  private readonly retryAttempts = new Map<string, number>();
  /** Pauses waited per key while GitHub answered 5xx. */
  private readonly busyWaits = new Map<string, number>();
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
   * Start fetching if needed and return the current state. When the diff is
   * on disk — pinned to `sha`, or a recent enough `latest` for a list row that
   * knows no SHA — the result is ready immediately with no request. Until the
   * on-disk cache has loaded, a request waits (reported as `loading`) rather
   * than fetching something we very likely already have.
   *
   * A subject with a SHA is what the reader is looking at (a pull request's
   * or commit's own page, a commit they hover): it goes to the front of this
   * queue and to the background as `page`, which keeps budget for it. List
   * rows know no SHA and, like every refresh of stale counts, wait their turn.
   */
  request(diffUrl: string, sha: string | null = null, priority: DiffPriority = sha === null ? 'background' : 'page'): DiffFetchState {
    const key = this.keyFor(diffUrl, sha);
    const current = this.memory.get(key) ?? { status: 'idle' };
    if (current.status !== 'idle') return current;

    const persistKey = sha === null ? latestCacheKey(diffUrl) : diffCacheKey(diffUrl, sha);
    if (persistKey !== null) {
      if (!this.cacheReady) return { status: 'loading' };
      const cached = this.persistent.get(persistKey);
      if (cached !== null) {
        const ready: DiffFetchState = { status: 'ready', files: cached };
        this.memory.set(key, ready);
        // Stale-while-revalidate for list rows: show the old counts now,
        // refresh them in the background; the chip updates when that lands.
        // An entry with no files at all is refreshed too: older builds cached
        // GitHub's sign-in page as an empty diff, and those entries live on
        // devices until they are replaced.
        if ((!this.persistent.isFresh(persistKey) || cached.length === 0) && !this.revalidating.has(key)) {
          this.revalidating.add(key);
          this.queue.push({ url: diffUrl, key, persistKey, revalidate: true, priority: 'background' });
          this.pump();
        }
        return ready;
      }
    }

    const loading: DiffFetchState = { status: 'loading' };
    this.memory.set(key, loading);
    const item = { url: diffUrl, key, persistKey, revalidate: false, priority };
    if (priority === 'page') this.queue.unshift(item);
    else this.queue.push(item);
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
      void this.load(next.url, next.key, next.persistKey, next.revalidate, next.priority).finally(() => {
        this.inFlight -= 1;
        this.pump();
      });
    }
  }

  private async load(diffUrl: string, key: string, persistKey: string | null, revalidate: boolean, priority: DiffPriority): Promise<void> {
    const request: FetchDiffRequest = { type: 'geld:fetch-diff', url: diffUrl, priority };
    const attempts = (this.retryAttempts.get(key) ?? 0) + 1;
    let reason: string;
    let retryAfterMs: number | null = null;
    try {
      const response: unknown = await browser.runtime.sendMessage(request);
      if (isFetchDiffResponse(response) && response.ok) {
        this.memory.set(key, { status: 'ready', files: response.files });
        this.retryAttempts.delete(key);
        this.busyWaits.delete(key);
        this.revalidating.delete(key);
        if (persistKey !== null) this.persistent.set(persistKey, response.files);
        this.onChange();
        return;
      }
      reason = isFetchDiffResponse(response) && !response.ok ? response.reason : 'bad-response';
      if (isFetchDiffResponse(response) && !response.ok && typeof response.retryAfterMs === 'number') retryAfterMs = response.retryAfterMs;
    } catch (error) {
      // Typically "message port closed": the service worker went away mid-request.
      reason = error instanceof Error && /port closed|receiving end/i.test(error.message) ? 'port-closed' : error instanceof Error ? error.message : 'fetch-failed';
    }
    if (revalidate) {
      // The stale counts stay on screen; a later visit tries again.
      this.revalidating.delete(key);
      return;
    }
    // GitHub answering 5xx pauses everyone briefly; a row waits through a few
    // such pauses as "loading" before it is called unavailable.
    if (reason === 'busy') {
      const waits = (this.busyWaits.get(key) ?? 0) + 1;
      this.busyWaits.set(key, waits);
      if (waits <= BUSY_MAX_WAITS) reason = 'queued';
      if (priority === 'page') retryAfterMs = PAGE_BUSY_RETRY_MS[Math.min(waits, PAGE_BUSY_RETRY_MS.length) - 1] ?? retryAfterMs;
    }
    // Waiting for a budget slot is not a failure and not an attempt: the row
    // stays "loading" and asks again when the background said a slot frees.
    if (reason === 'queued') {
      this.memory.set(key, { status: 'loading' });
      setTimeout(
        () => {
          if (this.memory.get(key)?.status !== 'loading') return;
          this.memory.set(key, { status: 'idle' });
          this.onChange();
        },
        (retryAfterMs ?? 1000) + Math.random() * QUEUE_JITTER_MS,
      );
      return;
    }
    this.memory.set(key, { status: 'failed', reason, attempts });
    // Forget the failure later so the next apply() asks again — once the
    // background's rate-limit block lifts, on a backoff for anything
    // transient. Definitive failures stay failed for this page.
    const delay =
      reason === 'rate-limited'
        ? (retryAfterMs ?? RATE_LIMIT_RETRY_MS) + RATE_LIMIT_SLACK_MS
        : isDefinitive(reason) || attempts >= TRANSIENT_MAX_ATTEMPTS
          ? null
          : (TRANSIENT_RETRY_MS[Math.min(attempts, TRANSIENT_RETRY_MS.length) - 1] ?? null);
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
