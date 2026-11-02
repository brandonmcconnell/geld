import { createHash, webcrypto } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import type { RelayChannel } from './broker';
const rowSchema = z.object({
  id: z.string(),
  kind: z.enum(['github', 'claude']),
  host: z.string(),
  encrypted_secret: z.string(),
});
/** This credential authorizes Geld relay traffic only. It is never a Claude login credential. */
export async function decryptRelaySecret(value: string, secret: string): Promise<string | null> {
  const [version, iv, data, ...extra] = value.split('.');
  if (version !== 'v1' || !iv || !data || extra.length || secret.length < 32) return null;
  try {
    const key = await webcrypto.subtle.importKey(
      'raw',
      createHash('sha256').update(secret).digest(),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    return new TextDecoder().decode(
      await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Buffer.from(iv, 'base64url') },
        key,
        Buffer.from(data, 'base64url'),
      ),
    );
  } catch {
    return null;
  }
}
export function databaseChannelResolver(): ((id: string) => Promise<RelayChannel | null>) | null {
  const url = process.env.RELAY_DATABASE_URL;
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!url || !encryptionKey) return null;
  const db = new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  });
  db.on('error', () => undefined);
  return async (id) => {
    const result = await db.query(
      'SELECT id,kind,host,encrypted_secret FROM relay_channels WHERE id=$1 AND enabled=true',
      [id],
    );
    const row = rowSchema.safeParse(result.rows[0]);
    if (!row.success) return null;
    const secret = await decryptRelaySecret(row.data.encrypted_secret, encryptionKey);
    return secret ? { id: row.data.id, kind: row.data.kind, host: row.data.host, secret } : null;
  };
}
