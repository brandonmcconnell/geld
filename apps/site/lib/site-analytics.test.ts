import { afterEach, describe, expect, it, vi } from 'vitest';

import { capturedOn, siteAnalyticsConfig } from './site-analytics';

describe('the site’s measurement', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('asks nothing and loads nothing without a key', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    expect(siteAnalyticsConfig()).toBeNull();
  });

  it('sends to PostHog’s US host unless another is set', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_site');
    expect(siteAnalyticsConfig()).toEqual({ key: 'phc_site', host: 'https://us.i.posthog.com' });
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com/');
    expect(siteAnalyticsConfig()).toEqual({ key: 'phc_site', host: 'https://eu.i.posthog.com' });
  });
});

describe('where the site captures nothing', () => {
  it('drops every event on the pages a visitor is signed in on, and keeps the rest', () => {
    expect(capturedOn('/settings')).toBe(false);
    expect(capturedOn('/settings/sync')).toBe(false);
    expect(capturedOn('/auth')).toBe(false);
    expect(capturedOn('/auth/start')).toBe(false);
    expect(capturedOn('/')).toBe(true);
    expect(capturedOn('/how-it-works')).toBe(true);
    expect(capturedOn('/settingsx')).toBe(true);
  });
});
