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
 * development) the events are written to the runtime logs instead, and so are
 * they when PostHog does not take them, answered with a 503 the extension
 * reads as "send again".
 */
const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_HOST = 'https://us.i.posthog.com';
const FORWARD_TIMEOUT_MS = 5_000;

/** The body as text, or null past `limit` bytes: read as a stream, so a chunked request with no length stops there too. */
async function readBody(request: NextRequest, limit: number): Promise<string | null> {
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** The extension reads the status (a 5xx keeps its queue for the next ping), and it is a simple request, so a wildcard origin is all it needs. */
function answer(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { 'Access-Control-Allow-Origin': '*' } });
}

function logCaptures(captures: ReturnType<typeof usageCaptures>): void {
  for (const capture of captures) console.log(JSON.stringify({ event: 'extension_usage', name: capture.event, timestamp: capture.timestamp, ...capture.properties }));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  await connection();
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return answer(413);
  const text = await readBody(request, MAX_BODY_BYTES);
  if (text === null) return answer(413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return answer(400);
  }
  const payload = parseUsagePayload(body);
  if (payload === null) return answer(400);
  const captures = usageCaptures(payload, Date.now());
  if (captures.length === 0) return answer(204);
  const key = process.env.POSTHOG_USAGE_KEY?.trim() ?? '';
  if (key === '') {
    logCaptures(captures);
    return answer(204);
  }
  const host = (process.env.POSTHOG_USAGE_HOST?.trim() || DEFAULT_HOST).replace(/\/+$/, '');
  const batch = captures.map((capture) => ({
    event: capture.event,
    timestamp: capture.timestamp,
    properties: { ...capture.properties, distinct_id: crypto.randomUUID(), $process_person_profile: false, $geoip_disable: true, $lib: 'geld-site' },
  }));
  let failure: string | null = null;
  try {
    const response = await fetch(`${host}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, batch }),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (!response.ok) failure = `status ${response.status}`;
  } catch (error) {
    failure = error instanceof Error ? error.name : 'unknown';
  }
  if (failure === null) return answer(204);
  // The extension keeps the batch and sends it again with its next ping; the log keeps a copy should that never come.
  console.error(JSON.stringify({ event: 'extension_usage_forward_failed', reason: failure, count: batch.length }));
  logCaptures(captures);
  return answer(503);
}
