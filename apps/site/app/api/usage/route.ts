import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

import { parseUsagePayload, usageCaptures } from '@geld/core';

/**
 * Anonymous usage statistics from installed extensions (`usage-uplink.ts`):
 * installs, updates and one ping per day. The payload is parsed again, so only
 * the fields Geld names reach PostHog, and it is sent from here rather than
 * the browser so PostHog never sees the reader's address. Each event gets a
 * random id of its own and no person profile, which is what makes them
 * countable but not linkable. Without `POSTHOG_USAGE_KEY` (previews, local
 * development) the events are written to the runtime logs instead.
 */
const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_HOST = 'https://us.i.posthog.com';
const FORWARD_TIMEOUT_MS = 5_000;

export async function POST(request: NextRequest): Promise<NextResponse> {
  await connection();
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const payload = parseUsagePayload(body);
  if (payload === null) return new NextResponse(null, { status: 400 });
  const captures = usageCaptures(payload, Date.now());
  const key = process.env.POSTHOG_USAGE_KEY?.trim() ?? '';
  if (key === '') {
    for (const capture of captures) console.log(JSON.stringify({ event: 'extension_usage', name: capture.event, timestamp: capture.timestamp, ...capture.properties }));
    return new NextResponse(null, { status: 204 });
  }
  const host = (process.env.POSTHOG_USAGE_HOST?.trim() || DEFAULT_HOST).replace(/\/+$/, '');
  const batch = captures.map((capture) => ({
    event: capture.event,
    timestamp: capture.timestamp,
    properties: { ...capture.properties, distinct_id: crypto.randomUUID(), $process_person_profile: false, $geoip_disable: true, $lib: 'geld-site' },
  }));
  try {
    const response = await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, batch }),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (!response.ok) console.error(JSON.stringify({ event: 'extension_usage_forward_failed', status: response.status, count: batch.length }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'extension_usage_forward_failed', reason: error instanceof Error ? error.name : 'unknown', count: batch.length }));
  }
  return new NextResponse(null, { status: 204 });
}
