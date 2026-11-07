import { isDiscordTarget, resolveDiscordAsBot } from '@geld/review/link-resolvers/index';
import type { NextRequest } from 'next/server';
import { connection, NextResponse } from 'next/server';

/**
 * Geld's Discord resolver: the extension posts a Discord link and the reader's own Discord token, and gets back what
 * the link holds only when that reader may see it (`resolveDiscordAsBot`). The bot's token stays here; nothing is
 * stored or logged.
 */
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  await connection();
  const bot = process.env.DISCORD_BOT_TOKEN ?? '';
  if (bot === '') return NextResponse.json({ status: 'failed', reason: 'unavailable', message: 'Discord is not set up on geld.sh yet' }, { status: 503 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ status: 'failed', reason: 'invalid', message: 'Too large' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ status: 'failed', reason: 'invalid', message: 'Not JSON' }, { status: 400 });
  }
  const value = typeof body === 'object' && body !== null ? Object.fromEntries(Object.entries(body)) : {};
  const token = typeof value.token === 'string' && value.token.length > 0 && value.token.length < 512 ? value.token : null;
  const target = { guild: value.guild, channel: value.channel, message: value.message ?? null };
  if (token === null || !isDiscordTarget(target)) return NextResponse.json({ status: 'failed', reason: 'invalid', message: 'Send a token, a server, a channel and optionally a message' }, { status: 400 });
  const resolution = await resolveDiscordAsBot(target, token, bot, (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }));
  return NextResponse.json(resolution, { headers: { 'Cache-Control': 'no-store' } });
}
