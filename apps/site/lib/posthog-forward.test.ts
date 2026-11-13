import { afterEach, describe, expect, it, vi } from 'vitest';

import { forwardToPostHog, postHogKey } from './posthog-forward';

describe('forwarding events to PostHog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends one batch with a random id per event and nothing that names the sender', async () => {
    const calls: Array<{ readonly url: string; readonly body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 200 });
    });
    const failure = await forwardToPostHog('phc_key', [
      { event: 'extension_error', timestamp: '2026-11-13T00:00:00.000Z', properties: { where: 'background:ai', message: 'Completion failed (400)' } },
      { event: 'extension_error', timestamp: '2026-11-13T00:00:01.000Z', properties: { where: 'content:pass', message: 'x is undefined' } },
    ]);
    expect(failure).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://us.i.posthog.com/batch/');
    expect(calls[0]?.body).toMatchObject({
      api_key: 'phc_key',
      batch: [
        { event: 'extension_error', properties: { where: 'background:ai', message: 'Completion failed (400)', $process_person_profile: false, $geoip_disable: true } },
        { event: 'extension_error', properties: { where: 'content:pass' } },
      ],
    });
  });

  it('says why PostHog did not take a batch', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }));
    expect(await forwardToPostHog('phc_key', [{ event: 'e', timestamp: 't', properties: {} }])).toBe('status 500');
  });

  it('has no key where none is set', () => {
    vi.stubEnv('POSTHOG_USAGE_KEY', '  ');
    expect(postHogKey()).toBeNull();
  });
});
