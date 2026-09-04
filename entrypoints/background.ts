import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { parseUnifiedDiff } from '../src/lib/diff-parse';
import type { FetchDiffResponse } from '../src/lib/messages';
import { isFetchDiffRequest } from '../src/lib/messages';

/** Refuse to parse diffs larger than this; GitHub's UI is unusable there anyway. */
const MAX_DIFF_BYTES = 20 * 1024 * 1024;

const ALLOWED_HOSTS = new Set(['github.com', 'patch-diff.githubusercontent.com']);

/**
 * `https://github.com/<owner>/<repo>/pull/<n>.diff` redirects to
 * `patch-diff.githubusercontent.com`, which does not send CORS headers. Content
 * scripts therefore cannot fetch it, but the background script can thanks to
 * the extension's host permissions. Cookies are included so private
 * repositories work for signed-in users.
 */
async function fetchDiff(url: string): Promise<FetchDiffResponse> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname) || !parsed.pathname.endsWith('.diff')) {
    return { ok: false, reason: 'disallowed-url' };
  }

  try {
    const response = await fetch(parsed.toString(), {
      credentials: 'include',
      headers: { Accept: 'text/plain' },
      redirect: 'follow',
    });
    if (!response.ok) return { ok: false, reason: `http-${response.status}` };
    const declared = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
    if (declared > MAX_DIFF_BYTES) return { ok: false, reason: 'too-large' };
    const text = await readWithLimit(response, MAX_DIFF_BYTES);
    return { ok: true, files: parseUnifiedDiff(text) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'fetch-failed' };
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
      throw new Error('too-large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isFetchDiffRequest(message)) return undefined;
    void fetchDiff(message.url).then(sendResponse);
    // Returning true keeps the message channel open for the async response.
    return true;
  });
});
