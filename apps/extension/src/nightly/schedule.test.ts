import { tagFromReleaseUrl } from '@geld/core/nightly';
import { DETAILS_RETRY_MS, LIMITED_DEFAULT_MS, limitedUntil, NAVIGATION_GAP_MS, navigationDue, needsDetails } from './schedule';
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
  limitedUntil: null,
  writing: null,
  ...patch,
});
const release = (tag: string): NightlyStatus['latest'] => ({ tag, version: '0.1.2.1', build: 1, assetName: '', assetUrl: '', checksumUrl: '', size: 0, publishedAt: '', htmlUrl: '' });

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

  it('asks at most once per retry delay while the latest-release page cannot be read', () => {
    const asked = status({ askedTag: null, askedAt: new Date(NOW - 1000).toISOString() });
    expect(needsDetails(asked, null, NOW)).toBe(false);
    expect(needsDetails(asked, null, NOW + DETAILS_RETRY_MS)).toBe(true);
    expect(needsDetails(status({}), null, NOW)).toBe(true);
  });

  it('never asks while the API has limited Geld, whatever the tag', () => {
    const limited = status({ limitedUntil: new Date(NOW + 60_000).toISOString(), askedAt: new Date(NOW - DETAILS_RETRY_MS).toISOString() });
    expect(needsDetails(limited, 'v0.1.2-build.9', NOW)).toBe(false);
    expect(needsDetails(limited, null, NOW)).toBe(false);
    expect(needsDetails(limited, 'v0.1.2-build.9', NOW + 60_000)).toBe(true);
  });
});

describe('limitedUntil', () => {
  it('reads retry-after, then the reset time, then waits a while', () => {
    expect(limitedUntil('30', null, NOW)).toBe(NOW + 30_000);
    expect(limitedUntil(null, String(NOW / 1000 + 600), NOW)).toBe(NOW + 600_000);
    expect(limitedUntil(null, null, NOW)).toBe(NOW + LIMITED_DEFAULT_MS);
    expect(limitedUntil(null, String(NOW / 1000 - 5), NOW)).toBe(NOW + LIMITED_DEFAULT_MS);
  });

  it('never waits more than an hour', () => {
    expect(limitedUntil('86400', null, NOW)).toBe(NOW + 60 * 60_000);
  });
});
