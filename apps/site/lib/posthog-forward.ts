/**
 * Events geld.sh forwards to PostHog from its own server, so PostHog never sees a reader's address: each gets a random
 * id of its own and no person profile, which makes the events countable but not linkable to each other or to anyone.
 * The key and host are the extension usage project's (`POSTHOG_USAGE_KEY`, `POSTHOG_USAGE_HOST`).
 */
const DEFAULT_HOST = 'https://us.i.posthog.com';
const FORWARD_TIMEOUT_MS = 5_000;

export interface ForwardedEvent {
  readonly event: string;
  readonly timestamp: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** The key, or null where none is set (previews, local development): the caller writes the events to the logs instead. */
export function postHogKey(): string | null {
  const key = process.env.POSTHOG_USAGE_KEY?.trim() ?? '';
  return key === '' ? null : key;
}

/** Sends the events in one batch; resolves with why PostHog did not take them, or null when it did. */
export async function forwardToPostHog(key: string, events: readonly ForwardedEvent[]): Promise<string | null> {
  const host = (process.env.POSTHOG_USAGE_HOST?.trim() || DEFAULT_HOST).replace(/\/+$/, '');
  const batch = events.map((entry) => ({
    event: entry.event,
    timestamp: entry.timestamp,
    properties: { ...entry.properties, distinct_id: crypto.randomUUID(), $process_person_profile: false, $geoip_disable: true, $lib: 'geld-site' },
  }));
  try {
    const response = await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, batch }),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    return response.ok ? null : `status ${response.status}`;
  } catch (error) {
    return error instanceof Error ? error.name : 'unknown';
  }
}
