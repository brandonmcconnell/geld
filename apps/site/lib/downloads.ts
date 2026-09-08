import type { LatestRelease } from './release';

export type BrowserId = 'chrome' | 'edge' | 'firefox' | 'safari';

export interface BrowserTarget {
  readonly id: BrowserId;
  readonly name: string;
  /** Suffix of the zip WXT produces for this browser (`geld-<version>-<suffix>.zip`). */
  readonly zipSuffix: string;
}

export const BROWSERS: readonly BrowserTarget[] = [
  { id: 'chrome', name: 'Chrome', zipSuffix: 'chrome' },
  { id: 'edge', name: 'Edge', zipSuffix: 'edge' },
  { id: 'firefox', name: 'Firefox', zipSuffix: 'firefox' },
  { id: 'safari', name: 'Safari', zipSuffix: 'safari' },
];

/**
 * Store listings. Until a listing exists the button points at the latest
 * GitHub Release instead. Swapping a browser over is a one-line change here.
 */
export const STORE_URLS: Readonly<Partial<Record<BrowserId, string>>> = {
  chrome: 'https://chromewebstore.google.com/detail/geld/nfbkhldmnfgeeldfafojajnfanikbhia',
  edge: 'https://microsoftedge.microsoft.com/addons/detail/geld/bdakebdlgaomkblemgabkoofoiellhmi',
  firefox: 'https://addons.mozilla.org/en-US/firefox/addon/geld/',
  // safari: 'https://apps.apple.com/app/<id>',
};

export type InstallSource = 'store' | 'release-asset' | 'release-page';

export interface InstallLink {
  readonly browser: BrowserTarget;
  readonly href: string;
  readonly source: InstallSource;
  readonly label: string;
}

function findAsset(release: LatestRelease, suffix: string): string | null {
  const pattern = new RegExp(`-${suffix}\\.zip$`, 'i');
  for (const asset of release.assets) {
    if (pattern.test(asset.name)) return asset.url;
  }
  return null;
}

/** Resolve where each browser's install button should go for the given release. */
export function installLinks(release: LatestRelease): readonly InstallLink[] {
  return BROWSERS.map((browser) => {
    const store = STORE_URLS[browser.id];
    if (store !== undefined) {
      return { browser, href: store, source: 'store', label: `Add to ${browser.name}` };
    }
    const asset = findAsset(release, browser.zipSuffix);
    if (asset !== null) {
      return { browser, href: asset, source: 'release-asset', label: `Download for ${browser.name}` };
    }
    return { browser, href: release.url, source: 'release-page', label: `Download for ${browser.name}` };
  });
}
