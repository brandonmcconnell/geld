import { tagFromReleaseUrl } from './release';
import { DETAILS_RETRY_MS, NAVIGATION_GAP_MS, navigationDue, needsDetails } from './schedule';
import type { NightlyStatus } from './state';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const status = (patch: Partial<NightlyStatus>): NightlyStatus => ({
  checkedAt: null,
  latest: null,
  checkError: null,
  installing: null,
  failure: null,
  lastInstall: null,
  skipped: null,
  backup: null,
  askedTag: null,
  askedAt: null,
  etag: null,
  ...patch,
});
const release = (tag: string): NightlyStatus['latest'] => ({ tag, version: '0.1.2.1', build: 1, assetName: '', assetUrl: '', size: 0, publishedAt: '', htmlUrl: '' });

describe('tagFromReleaseUrl', () => {
  it('reads the tag the latest-release redirect lands on', () => {
    expect(tagFromReleaseUrl('https://github.com/brandonmcconnell/geld/releases/tag/v0.1.2-build.3272')).toBe('v0.1.2-build.3272');
  });

  it('refuses anywhere else', () => {
    expect(tagFromReleaseUrl('https://github.com/login?return_to=x')).toBeNull();
    expect(tagFromReleaseUrl('https://github.com/someone/fork/releases/tag/v0.1.2-build.3272')).toBeNull();
    expect(tagFromReleaseUrl('https://github.com/brandonmcconnell/geld/releases/tag/nightly')).toBeNull();
  });
});

describe('navigationDue', () => {
  it('lets a burst of navigations share one look', () => {
    expect(navigationDue(null, NOW)).toBe(true);
    expect(navigationDue(NOW - 2_000, NOW)).toBe(false);
    expect(navigationDue(NOW - NAVIGATION_GAP_MS, NOW)).toBe(true);
  });
});

describe('needsDetails', () => {
  it('asks the API once per new tag', () => {
    const known = status({ askedTag: 'v0.1.2-build.2', askedAt: new Date(NOW - 1000).toISOString(), latest: release('v0.1.2-build.2') });
    expect(needsDetails(known, 'v0.1.2-build.2', NOW)).toBe(false);
    expect(needsDetails(known, 'v0.1.2-build.3', NOW)).toBe(true);
  });

  it('asks again, but not on every page, about a tag the API did not describe yet', () => {
    const waiting = status({ askedTag: 'v0.1.2-build.3', askedAt: new Date(NOW - 1000).toISOString(), latest: release('v0.1.2-build.2') });
    expect(needsDetails(waiting, 'v0.1.2-build.3', NOW)).toBe(false);
    expect(needsDetails(waiting, 'v0.1.2-build.3', NOW + DETAILS_RETRY_MS)).toBe(true);
  });
});
