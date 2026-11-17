import { browser } from 'wxt/browser';
import type { UsageCounter } from '@geld/core';
import type { UsageCountMessage } from './messages';

/** Count one use of a feature toward the next usage ping (`usage-uplink.ts`), which drops it while the statistics are off. */
export function countUsage(counter: UsageCounter, by = 1): void {
  const message: UsageCountMessage = { type: 'geld:usage-count', counter, by };
  try {
    void browser.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // A retired copy of the content script has no extension context left to send through.
  }
}
