import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

import { parseErrorPayload } from '@geld/core';

import { forwardToPostHog, postHogKey } from '@/lib/posthog-forward';

/**
 * Error reports from installed extensions whose readers turned "Send error
 * reports" on (`error-uplink.ts`). Nothing is stored here: each error becomes
 * one JSON line in the deployment's runtime logs (`event: extension_error`),
 * where Vercel keeps it for a while, and the same event in PostHog (forwarded
 * like the usage statistics, with no address and a random id of its own), so
 * what failed can be grouped by its message.
 * The payload is parsed and scrubbed again, so a client that sends more than
 * Geld's own code would gets nothing extra into the logs. The extension sends
 * `no-cors` and never reads the answer.
 */
const MAX_BODY_BYTES = 64 * 1024;

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
  const payload = parseErrorPayload(body);
  if (payload === null) return new NextResponse(null, { status: 400 });
  for (const error of payload.errors) {
    console.log(JSON.stringify({ event: 'extension_error', version: payload.version, browser: payload.browser, ...error }));
  }
  const key = postHogKey();
  if (key !== null) {
    const failure = await forwardToPostHog(
      key,
      payload.errors.map((error) => ({
        event: 'extension_error',
        timestamp: new Date(error.lastAt).toISOString(),
        properties: { version: payload.version, browser: payload.browser, where: error.where, kind: error.kind, message: error.message, stack: error.stack.join('\n'), count: error.count, first_at: new Date(error.firstAt).toISOString() },
      })),
    );
    // The extension never reads the answer: the log lines above stand for a batch PostHog did not take.
    if (failure !== null) console.error(JSON.stringify({ event: 'extension_error_forward_failed', reason: failure, count: payload.errors.length }));
  }
  return new NextResponse(null, { status: 204 });
}
