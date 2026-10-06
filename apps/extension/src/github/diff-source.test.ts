import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The background (a `too-large` answer for every diff) and the storage behind the on-disk cache.
vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn(async () => ({ ok: false, reason: 'too-large' })) } },
}));
vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({ getValue: vi.fn(async () => ({})), setValue: vi.fn(async () => undefined), watch: vi.fn(() => () => undefined) }),
  },
}));

import { DiffSource } from './diff-source';

const DIFF_URL = 'https://github.com/acme/widgets/pull/7.diff';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/** GitHub's files-tab JSON, as `parseDiffSummaries` reads it, with one file named after the head it is for. */
function summariesFor(head: string): unknown {
  return { payload: { diffSummaries: [{ path: `src/${head.slice(0, 4)}.ts`, linesAdded: 1, linesDeleted: 0, changeType: 'MODIFIED' }] } };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('DiffSource summaries follow the head', () => {
  const served: string[] = [];
  let current = SHA_A;

  beforeEach(() => {
    served.length = 0;
    current = SHA_A;
    vi.stubGlobal('fetch', vi.fn(async () => {
      served.push(current);
      return new Response(JSON.stringify(summariesFor(current)), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks again for a new head under the same URL and never shows the old head\u2019s counts for it', async () => {
    const source = new DiffSource(() => undefined);
    await flush();
    source.request(DIFF_URL, SHA_A, 'page');
    await flush();
    const first = source.get(DIFF_URL, SHA_A);
    expect(first.status === 'ready' && first.provisional === true && first.files[0]?.path).toBe('src/aaaa.ts');

    // A new head, the page not reloaded: the diff URL is the same, the summaries are not.
    current = SHA_B;
    source.request(DIFF_URL, SHA_B, 'page');
    const between = source.get(DIFF_URL, SHA_B);
    expect(between.status === 'ready' && between.provisional === true).toBe(false);
    await flush();
    const second = source.get(DIFF_URL, SHA_B);
    expect(second.status === 'ready' && second.provisional === true && second.files[0]?.path).toBe('src/bbbb.ts');
    expect(served).toEqual([SHA_A, SHA_B]);
  });

  it('asks once when the head is learned after the first request', async () => {
    const source = new DiffSource(() => undefined);
    await flush();
    source.request(DIFF_URL, null, 'page');
    source.request(DIFF_URL, SHA_A, 'page');
    await flush();
    expect(served).toEqual([SHA_A]);
    const state = source.get(DIFF_URL, SHA_A);
    expect(state.status === 'ready' && state.provisional === true && state.files[0]?.path).toBe('src/aaaa.ts');
  });
});
