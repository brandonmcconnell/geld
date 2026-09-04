import { browser } from 'wxt/browser';
import type { FileStats } from '../lib/diff-parse';
import type { FetchDiffRequest } from '../lib/messages';
import { isFetchDiffResponse } from '../lib/messages';

export type DiffFetchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly files: readonly FileStats[] }
  | { readonly status: 'failed' };

/**
 * Lazily asks the background script for `<page>.diff` and caches the per-file
 * statistics. Used where the page does not render per-file diffs, such as the
 * PR conversation tab, or when only part of a large PR has been rendered.
 */
export class DiffSource {
  private readonly cache = new Map<string, DiffFetchState>();

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
    void this.load(diffUrl);
    return loading;
  }

  private async load(diffUrl: string): Promise<void> {
    const request: FetchDiffRequest = { type: 'geld:fetch-diff', url: diffUrl };
    try {
      const response: unknown = await browser.runtime.sendMessage(request);
      if (isFetchDiffResponse(response) && response.ok) {
        this.cache.set(diffUrl, { status: 'ready', files: response.files });
      } else {
        this.cache.set(diffUrl, { status: 'failed' });
      }
    } catch {
      this.cache.set(diffUrl, { status: 'failed' });
    }
    this.onChange();
  }
}
