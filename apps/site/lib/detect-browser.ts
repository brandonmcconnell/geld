import { useSyncExternalStore } from 'react';

import type { BrowserId } from './downloads';

/**
 * Best guess at which of the supported browsers is running, from the user
 * agent string. Order matters: Edge and every Chromium browser announce
 * Chrome, and everything WebKit-based announces Safari.
 */
export function detectBrowser(userAgent: string): BrowserId {
  if (/\bEdg(?:e|A|iOS)?\//.test(userAgent)) return 'edge';
  if (/\b(?:Firefox|FxiOS)\//.test(userAgent)) return 'firefox';
  if (/\b(?:Chrome|Chromium|CriOS)\//.test(userAgent)) return 'chrome';
  if (/\bSafari\//.test(userAgent) && /\bVersion\//.test(userAgent)) return 'safari';
  return 'chrome';
}

/** The browser never changes during a page's life, so there is nothing to subscribe to. */
const subscribe = (): (() => void) => () => {};
const getClientBrowser = (): BrowserId => detectBrowser(navigator.userAgent);
const getServerBrowser = (): BrowserId => 'chrome';

/** Current browser; `chrome` during server rendering and hydration, then the real one. */
export function useCurrentBrowser(): BrowserId {
  return useSyncExternalStore(subscribe, getClientBrowser, getServerBrowser);
}
