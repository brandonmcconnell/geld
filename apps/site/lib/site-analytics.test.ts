import { afterEach, describe, expect, it, vi } from 'vitest';

import { siteAnalyticsConfig } from './site-analytics';

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
