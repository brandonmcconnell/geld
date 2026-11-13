'use client';

import { useEffect } from 'react';
import type { PostHog } from 'posthog-js';

import { siteAnalyticsConfig } from '@/lib/site-analytics';

let loaded: Promise<PostHog | null> | null = null;

/** PostHog, fetched and started once, the first time measurement is allowed: before that, not a byte of it loads. */
function startPostHog(): Promise<PostHog | null> {
  const config = siteAnalyticsConfig();
  if (config === null) return Promise.resolve(null);
  loaded ??= import('posthog-js').then(({ default: posthog }) => {
    posthog.init(config.key, {
      api_host: config.host,
      autocapture: true,
      capture_pageview: 'history_change',
      capture_pageleave: true,
      person_profiles: 'identified_only',
      disable_session_recording: true,
      disable_surveys: true,
      persistence: 'localStorage+cookie',
    });
    return posthog;
  });
  return loaded;
}

/**
 * Page views (each client navigation too), the clicks and form changes PostHog's autocapture records, how far a page
 * is read before leaving, and the referrer and region PostHog adds to every event. Only while `enabled`: a withdrawn
 * choice stops capture at once, and the next opt-in starts it again.
 */
export function SiteAnalytics({ enabled }: { readonly enabled: boolean }) {
  useEffect(() => {
    if (!enabled) {
      if (loaded !== null) void loaded.then((posthog) => posthog?.opt_out_capturing());
      return;
    }
    void startPostHog().then((posthog) => {
      if (posthog !== null && posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
    });
  }, [enabled]);
  return null;
}
