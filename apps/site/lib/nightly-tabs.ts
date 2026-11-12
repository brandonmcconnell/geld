import { detectBrowser } from './detect-browser';

/** The browser tabs on /nightly, one per set of setup steps. */
export const NIGHTLY_TABS = ['chrome', 'brave', 'chromium', 'firefox', 'safari'] as const;
export type NightlyTab = (typeof NIGHTLY_TABS)[number];

export function isNightlyTab(value: unknown): value is NightlyTab {
  return typeof value === 'string' && NIGHTLY_TABS.some((id) => id === value);
}

/**
 * The tab to show for an address. A tab id in the hash wins and is remembered, so moving to a section anchor
 * (`#updates`), by a click or by Back and Forward, keeps the browser the reader chose. With nothing chosen yet,
 * the guess decides.
 */
export function createTabMemory(): (hash: string, guess: () => NightlyTab) => NightlyTab {
  let remembered: NightlyTab | null = null;
  return (hash, guess) => {
    const linked = hash.startsWith('#') ? hash.slice(1) : hash;
    if (isNightlyTab(linked)) remembered = linked;
    return remembered ?? guess();
  };
}

/**
 * The tab for the reader's browser. Brave reads as Chrome in its user agent and says so only through
 * `navigator.brave`. Opera, Vivaldi and Yandex name themselves and get the other Chromium browsers' tab, while
 * Helium, Arc, Dia and Comet read as Chrome, whose steps they share. Edge shares Chrome's tab.
 */
export function nightlyTabFor(userAgent: string, isBrave: boolean): NightlyTab {
  if (isBrave) return 'brave';
  const browser = detectBrowser(userAgent);
  if (browser === 'firefox' || browser === 'safari') return browser;
  if (/\b(?:OPR|Vivaldi|YaBrowser)\//.test(userAgent)) return 'chromium';
  return 'chrome';
}
