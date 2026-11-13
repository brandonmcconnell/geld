/**
 * geld.sh's own measurement: PostHog in the browser, loaded only after the visitor opts in (`PrivacyControls`). The key
 * is public by design (a PostHog project key only sends events), inlined at build time; without one, the site asks for
 * no consent and loads nothing.
 */
const DEFAULT_HOST = 'https://us.i.posthog.com';

export interface SiteAnalyticsConfig {
  readonly key: string;
  readonly host: string;
}

export function siteAnalyticsConfig(): SiteAnalyticsConfig | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? '';
  if (key === '') return null;
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_HOST).replace(/\/+$/, '');
  return { key, host };
}
