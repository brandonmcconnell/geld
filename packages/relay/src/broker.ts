import { z } from 'zod';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ReplayGuard, relayRequestSchema, relayResultSchema, allowedRelayUrl, signRelay } from './protocol';
import type { RelayRequest, RelayResult } from './protocol';
export interface RelayChannel {
  readonly id: string;
  readonly secret: string;
  readonly host: string;
  readonly kind?: 'github' | 'claude';
}
interface Pending {
  readonly request: RelayRequest;
  readonly complete: (result: RelayResult | null) => void;
  claimed: boolean;
}
async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > 12500000) throw new Error('Request too large');
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function createRelayBroker(
  channels: readonly RelayChannel[],
  resolveChannel?: (id: string) => Promise<RelayChannel | null>,
  now: () => number = Date.now,
) {
  let lookupTokens = 16;
  let lookupAt = now();
  let lookupsRunning = 0;
  const pending = new Map<string, Map<string, Pending>>();
  const guards = new Map<string, ReplayGuard>();
  const polls = new Map<string, () => void>();
  const touched = new Map<string, number>();
  const pruneIdle = () => {
    const cutoff = now() - 120000;
    for (const [id, last] of touched)
      if (last < cutoff && !pending.get(id)?.size && !polls.has(id)) {
        pending.delete(id);
        guards.delete(id);
        touched.delete(id);
      }
  };
  const sweep = setInterval(pruneIdle, 30000);
  sweep.unref();
  function answer(response: ServerResponse, channel: RelayChannel, path: string, value: unknown, status = 200) {
    const text = JSON.stringify(value);
    response.writeHead(status, { 'cache-control': 'no-store', ...signRelay(channel.secret, 'RESPONSE', path, text) });
    response.end(text);
  }
  const server = createServer(async (request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    const match = /^\/v1\/channels\/([a-zA-Z0-9_-]{1,100})\/(request|poll|result|status)$/.exec(path);
    const id = match?.[1];
    if (!id || request.method !== 'POST') {
      response.writeHead(404);
      response.end();
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers))
      if (typeof value === 'string') headers.set(name, value);
    const at = headers.get('x-geld-time');
    if (
      !at ||
      !/^\d+$/.test(at) ||
      Math.abs(now() - Number(at)) > 60000 ||
      !z.uuid().safeParse(headers.get('x-geld-nonce')).success ||
      !/^[a-f0-9]{64}$/.test(headers.get('x-geld-signature') ?? '')
    ) {
      response.writeHead(401);
      response.end();
      return;
    }
    let channel = channels.find((c) => c.id === id);
    if (!channel && resolveChannel) {
      const time = now();
      lookupTokens = Math.min(16, lookupTokens + Math.max(0, time - lookupAt) * 0.008);
      lookupAt = time;
      if (lookupTokens < 1 || lookupsRunning >= 2) {
        response.writeHead(429, { 'retry-after': '1' });
        response.end();
        return;
      }
      lookupTokens -= 1;
      lookupsRunning += 1;
      try {
        channel = (await resolveChannel(id)) ?? undefined;
      } catch {
        response.writeHead(503);
        response.end();
        return;
      } finally {
        lookupsRunning -= 1;
      }
    }
    if (!channel) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const body = await bodyOf(request);
      let guard = guards.get(channel.id);
      if (!guard) guard = new ReplayGuard();
      if (!guard.verify(channel.secret, 'POST', path, body, headers, now())) {
        response.writeHead(401);
        response.end();
        return;
      }
      guards.set(channel.id, guard);
      touched.set(channel.id, now());
      const reply = (value: unknown, status = 200) =>
        answer(response, channel, `${path}#${headers.get('x-geld-nonce')}`, value, status);
      let queue = pending.get(channel.id);
      if (!queue) {
        queue = new Map();
        pending.set(channel.id, queue);
      }
      const method = match[2];
      if (method === 'status') {
        const input = z
          .object({ ids: z.array(z.uuid()).max(5) })
          .strict()
          .safeParse(JSON.parse(body));
        if (!input.success) {
          reply({ error: 'Invalid status request' }, 400);
          return;
        }
        reply({ active: input.data.ids.filter((id) => queue.has(id)) });
        return;
      }
      if (method === 'request') {
        const parsed = relayRequestSchema.safeParse(JSON.parse(body));
        if (!parsed.success || !allowedRelayUrl(parsed.data.url, channel.host, channel.kind) || queue.size >= 10) {
          reply({ error: 'Relay request rejected' }, 400);
          return;
        }
        if (queue.has(parsed.data.id)) {
          reply({ error: 'Duplicate relay request' }, 409);
          return;
        }
        const id = parsed.data.id;
        const result = await new Promise<RelayResult | null>((resolve) => {
          let finished = false;
          const complete = (value: RelayResult | null) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            queue.delete(id);
            resolve(value);
          };
          const timeout = setTimeout(() => complete(null), channel.kind === 'claude' ? 120000 : 45000);
          queue.set(id, { request: parsed.data, complete, claimed: false });
          response.once('close', () => complete(null));
          polls.get(channel.id)?.();
        });
        reply(result ?? { error: 'Relay request timed out' }, result ? 200 : 503);
        return;
      }
      if (method === 'poll') {
        const previous = polls.get(channel.id);
        if (previous) {
          reply({ error: 'A connector is already polling' }, 409);
          return;
        }
        const available = () => Array.from(queue.values()).filter((p) => !p.claimed);
        if (!available().length)
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timeout);
              polls.delete(channel.id);
              resolve();
            };
            const timeout = setTimeout(finish, 20000);
            polls.set(channel.id, finish);
            response.once('close', finish);
          });
        const work = available().slice(0, 5);
        for (const item of work) item.claimed = true;
        reply({ requests: work.map((w) => w.request), supportsCancellation: true });
        return;
      }
      const parsed = relayResultSchema.safeParse(JSON.parse(body));
      if (!parsed.success) {
        reply({ error: 'Invalid relay result' }, 400);
        return;
      }
      const work = queue.get(parsed.data.id);
      if (!work || !work.claimed) {
        reply({ error: 'Unknown relay result' }, 404);
        return;
      }
      work.complete(parsed.data);
      reply({ received: true });
    } catch {
      if (!response.headersSent) {
        response.writeHead(400);
        response.end();
      }
    }
  });
  server.once('close', () => clearInterval(sweep));
  return {
    server,
    pruneIdle,
    channelCount: () => guards.size,
    pendingCount: () => Array.from(pending.values()).reduce((total, q) => total + q.size, 0),
    close: () => {
      clearInterval(sweep);
      for (const q of pending.values()) for (const p of q.values()) p.complete(null);
      for (const finish of polls.values()) finish();
      server.close();
    },
  };
}
