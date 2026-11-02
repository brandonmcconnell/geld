import 'server-only';
import { z } from 'zod';
import { allowedRelayUrl, relayFetch, publicHttpsFetch } from '@geld/relay';
import type { FetchLike } from '@geld/github';
import { database } from './db';
import { decryptCredential } from './crypto';
import { configured } from './env';
export async function registeredEnterpriseHost(host: string, userId?: string): Promise<boolean> {
  const db = database();
  if (!db) return false;
  const result = await db.query(
    'SELECT h.host FROM enterprise_hosts h WHERE h.host=$1 AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM enterprise_host_teams t JOIN team_members m ON m.team_id=t.team_id WHERE t.host=h.host AND m.user_id=$2))',
    [host, userId ?? null],
  );
  return result.rows.length > 0;
}
export async function enterpriseFetch(host: string): Promise<FetchLike> {
  const db = database();
  if (!db) throw new Error('Enterprise hosts are not configured');
  const row = z
    .object({
      direct_allowed: z.boolean(),
      relay_channel: z.string().nullable(),
      encrypted_relay_secret: z.string().nullable(),
    })
    .safeParse((await db.query('SELECT * FROM enterprise_hosts WHERE host=$1', [host])).rows[0]);
  if (!row.success) throw new Error('Register this Enterprise host first');
  const broker = configured(process.env.RELAY_BROKER_URL);
  const key = row.data.encrypted_relay_secret ? await decryptCredential(row.data.encrypted_relay_secret) : null;
  const viaRelay =
    broker && key && row.data.relay_channel
      ? relayFetch(
          {
            url: broker,
            channel: row.data.relay_channel,
            secret: key,
            allowHttp: process.env.RELAY_ALLOW_HTTP === 'true',
          },
          host,
        )
      : null;
  return enterpriseTransport({ host, directAllowed: row.data.direct_allowed, viaRelay });
}
export function enterpriseTransport({
  host,
  directAllowed,
  viaRelay,
  direct = publicHttpsFetch,
}: {
  readonly host: string;
  readonly directAllowed: boolean;
  readonly viaRelay: FetchLike | null;
  readonly direct?: FetchLike;
}): FetchLike {
  return async (url, init) => {
    if (!allowedRelayUrl(url, host)) throw new Error('Enterprise destination rejected');
    if (directAllowed) {
      try {
        return await direct(url, init);
      } catch (error) {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') throw error;
      }
    }
    if (viaRelay) return viaRelay(url, init);
    throw new Error('This instance needs its customer relay to be connected');
  };
}
