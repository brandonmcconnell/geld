import type { FileStats } from '../lib/diff-parse';
import { parseUnifiedDiff } from '../lib/diff-parse';

/** Refuse to parse diffs larger than this; GitHub's UI is unusable there anyway. */
const MAX_DIFF_BYTES = 20 * 1024 * 1024;

export type DiffFetchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly files: readonly FileStats[] }
  | { readonly status: 'failed' };

/**
 * Lazily fetches `<page>.diff` from GitHub (same origin, so the user's session
 * cookies apply to private repositories) and caches the per-file statistics.
 * Used where the page does not render per-file diffs, such as the PR
 * conversation tab, or when the page has only rendered part of a large PR.
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
    try {
      const response = await fetch(diffUrl, { credentials: 'same-origin', headers: { Accept: 'text/plain' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
      if (declared > MAX_DIFF_BYTES) throw new Error('Diff too large');
      const text = await readWithLimit(response, MAX_DIFF_BYTES);
      this.cache.set(diffUrl, { status: 'ready', files: parseUnifiedDiff(text) });
    } catch {
      this.cache.set(diffUrl, { status: 'failed' });
    }
    this.onChange();
  }
}

async function readWithLimit(response: Response, limit: number): Promise<string> {
  if (response.body === null) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new Error('Diff too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}
