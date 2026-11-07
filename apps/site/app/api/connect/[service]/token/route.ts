import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

import { exchangeToken, parseTokenRequest, PROXY_SERVICES } from '@/lib/connect-token';

/**
 * Geld's token proxy (`lib/connect-token.ts`): the extension posts a code with its PKCE verifier, or a refresh token,
 * and gets the provider's tokens back. Nothing is stored or logged.
 */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: NextRequest, { params }: { readonly params: Promise<{ readonly service: string }> }): Promise<NextResponse> {
  await connection();
  const { service } = await params;
  const target = PROXY_SERVICES[service];
  if (target === undefined) return NextResponse.json({ ok: false, error: 'Unknown service' }, { status: 404 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: 'Too large' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: 'Not JSON' }, { status: 400 });
  }
  const parsed = parseTokenRequest(body);
  if (parsed === null) return NextResponse.json({ ok: false, error: 'Send a code with its verifier, or a refresh token' }, { status: 400 });
  const { status, answer } = await exchangeToken(target, parsed, process.env, (input, init) => fetch(input, init));
  return NextResponse.json(answer, { status, headers: { 'Cache-Control': 'no-store' } });
}
