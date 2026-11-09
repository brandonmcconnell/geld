import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

import { parseErrorPayload } from '@geld/core';

/**
 * Error reports from installed extensions whose readers turned "Send error
 * reports" on (`error-uplink.ts`). Nothing is stored here: each error becomes
 * one JSON line in the deployment's runtime logs (`event: extension_error`),
 * where Vercel keeps it for a while and a log drain can carry it further.
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
  return new NextResponse(null, { status: 204 });
}
