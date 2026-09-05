import { describe, expect, it } from 'vitest';

import { installLinks, STORE_URLS } from './downloads';
import { FALLBACK_RELEASE, parseRelease } from './release';
import { RELEASES_URL } from './site';

describe('parseRelease', () => {
  it('reads the tag, page and zip assets from a GitHub release payload', () => {
    const release = parseRelease({
      tag_name: 'v0.1.0',
      html_url: 'https://github.com/brandonmcconnell/geld/releases/tag/v0.1.0',
      assets: [
        { name: 'geld-0.1.0-chrome.zip', browser_download_url: 'https://example.test/chrome.zip' },
        { name: 'not-an-asset' },
        42,
      ],
    });
    expect(release).toEqual({
      tag: 'v0.1.0',
      url: 'https://github.com/brandonmcconnell/geld/releases/tag/v0.1.0',
      assets: [{ name: 'geld-0.1.0-chrome.zip', url: 'https://example.test/chrome.zip' }],
    });
  });

  it('rejects payloads without a tag (for example a 404 body)', () => {
    expect(parseRelease({ message: 'Not Found' })).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease([])).toBeNull();
  });
});

describe('installLinks', () => {
  it('falls back to the Releases page when nothing has been published', () => {
    const links = installLinks(FALLBACK_RELEASE);
    expect(links).toHaveLength(4);
    for (const link of links) {
      if (STORE_URLS[link.browser.id] !== undefined) continue;
      expect(link.source).toBe('release-page');
      expect(link.href).toBe(RELEASES_URL);
    }
  });

  it('prefers the matching zip asset of the latest release', () => {
    const links = installLinks({
      tag: 'v0.2.0',
      url: 'https://github.com/brandonmcconnell/geld/releases/tag/v0.2.0',
      assets: [
        { name: 'geld-0.2.0-firefox.zip', url: 'https://example.test/firefox.zip' },
        { name: 'geld-0.2.0-sources.zip', url: 'https://example.test/sources.zip' },
      ],
    });
    const firefox = links.find((link) => link.browser.id === 'firefox');
    const chrome = links.find((link) => link.browser.id === 'chrome');
    expect(firefox?.source).toBe(STORE_URLS.firefox === undefined ? 'release-asset' : 'store');
    if (STORE_URLS.firefox === undefined) expect(firefox?.href).toBe('https://example.test/firefox.zip');
    if (STORE_URLS.chrome === undefined) {
      expect(chrome?.source).toBe('release-page');
      expect(chrome?.href).toBe('https://github.com/brandonmcconnell/geld/releases/tag/v0.2.0');
    }
  });
});
