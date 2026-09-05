import { browser } from 'wxt/browser';
import type { FileStats } from '../lib/diff-parse';
import type { FetchDiffRequest } from '../lib/messages';
import { isFetchDiffResponse } from '../lib/messages';

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
 * statistics. Used where the page does not render per-file diffs (the PR
 * conversation tab, PR lists) or when only part of a large PR is rendered.
 */
export class DiffSource {
  private readonly cache = new Map<string, DiffFetchState>();
  private readonly queue: string[] = [];
  private inFlight = 0;

  constructor(private readonly onChange: () => void) {}

  get(diffUrl: string): DiffFetchState {
    return this.cache.get(diffUrl) ?? { status: 'idle' };
  }

  /** Start fetching if needed and return the current state. */
  request(diffUrl: string): DiffFetchState {
    const current = this.get(diffUrl);
    if (current.status !== 'idle') return current;
    const loading: DiffFetchState = { status: 'loading' };
    this.cache.set(diffUrl, loading);
    this.queue.push(diffUrl);
    this.pump();
    return loading;
  }

  private pump(): void {
    while (this.inFlight < MAX_CONCURRENT_FETCHES) {
      const next = this.queue.shift();
      if (next === undefined) return;
      this.inFlight += 1;
      void this.load(next).finally(() => {
        this.inFlight -= 1;
        this.pump();
      });
    }
  }

  private async load(diffUrl: string): Promise<void> {
    const request: FetchDiffRequest = { type: 'geld:fetch-diff', url: diffUrl };
    try {
      const response: unknown = await browser.runtime.sendMessage(request);
      if (isFetchDiffResponse(response) && response.ok) {
        this.cache.set(diffUrl, { status: 'ready', files: response.files });
      } else {
        this.cache.set(diffUrl, { status: 'failed' });
        if (isFetchDiffResponse(response) && !response.ok && response.reason === 'rate-limited') {
          // Forget the failure once the background cooldown has passed so the
          // page picks the numbers up later without a reload.
          setTimeout(() => {
            this.cache.delete(diffUrl);
            this.onChange();
          }, RATE_LIMIT_RETRY_MS);
        }
      }
    } catch {
      this.cache.set(diffUrl, { status: 'failed' });
    }
    this.onChange();
  }
}
