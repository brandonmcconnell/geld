import { browser } from 'wxt/browser';
import type { FileStats } from '../lib/diff-parse';
import type { FetchDiffRequest } from '../lib/messages';
import { isFetchDiffResponse } from '../lib/messages';
import { DiffCache } from './diff-cache';

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
  private readonly memory = new Map<string, DiffFetchState>();
  private readonly queue: Array<{ readonly url: string; readonly sha: string | null }> = [];
  private readonly persistent = new DiffCache();
  private inFlight = 0;

  constructor(private readonly onChange: () => void) {
    void this.persistent.ready().then(() => this.onChange());
  }

  get(diffUrl: string): DiffFetchState {
    return this.memory.get(diffUrl) ?? { status: 'idle' };
  }

  /**
   * Start fetching if needed and return the current state. When `sha` is known
   * and matches the on-disk cache, the result is ready immediately.
   */
  request(diffUrl: string, sha: string | null = null): DiffFetchState {
    const current = this.get(diffUrl);
    if (current.status !== 'idle') return current;

    if (sha !== null) {
      const cached = this.persistent.get(diffUrl, sha);
      if (cached !== null) {
        const ready: DiffFetchState = { status: 'ready', files: cached };
        this.memory.set(diffUrl, ready);
        return ready;
      }
    }

    const loading: DiffFetchState = { status: 'loading' };
    this.memory.set(diffUrl, loading);
    this.queue.push({ url: diffUrl, sha });
    this.pump();
    return loading;
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
      void this.load(next.url, next.sha).finally(() => {
        this.inFlight -= 1;
        this.pump();
      });
    }
  }

  private async load(diffUrl: string, sha: string | null): Promise<void> {
    const request: FetchDiffRequest = { type: 'geld:fetch-diff', url: diffUrl };
    try {
      const response: unknown = await browser.runtime.sendMessage(request);
      if (isFetchDiffResponse(response) && response.ok) {
        this.memory.set(diffUrl, { status: 'ready', files: response.files });
        if (sha !== null) this.persistent.set(diffUrl, sha, response.files);
      } else {
        this.memory.set(diffUrl, { status: 'failed' });
        if (isFetchDiffResponse(response) && !response.ok && response.reason === 'rate-limited') {
          // Forget the failure once the background cooldown has passed so the
          // page picks the numbers up later without a reload.
          setTimeout(() => {
            this.memory.delete(diffUrl);
            this.onChange();
          }, RATE_LIMIT_RETRY_MS);
        }
      }
    } catch {
      this.memory.set(diffUrl, { status: 'failed' });
    }
    this.onChange();
  }
}
