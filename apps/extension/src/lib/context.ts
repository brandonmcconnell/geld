import { browser } from 'wxt/browser';

/**
 * Whether this script's extension context still exists. A content script
 * outlives its extension: after a reload, update or removal the copy left in
 * an open tab keeps running with `chrome.runtime.id` undefined and
 * `chrome.storage` gone. A newer copy asks it to retire (`geld:takeover`),
 * but work already in flight — a diff arriving, a MutationObserver
 * callback — must check for itself before touching extension APIs.
 */
export function extensionAlive(): boolean {
  const runtime: { readonly id?: string } | undefined = browser.runtime;
  return runtime?.id !== undefined;
}

/**
 * A fire-and-forget storage write from a content script. From an orphaned
 * copy the write rejects — wxt/storage words it as "You must add the
 * 'storage' permission to your manifest", meaning `chrome.storage` is gone —
 * and an unhandled rejection is a red line in the page's console.
 */
export function persist(write: Promise<unknown>): void {
  void write.catch(() => undefined);
}
