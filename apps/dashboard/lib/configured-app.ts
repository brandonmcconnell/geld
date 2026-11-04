import 'server-only';
import { z } from 'zod';
import { createApiTransport } from '@geld/github';
import { database } from './db';
import { configured } from './env';
import { encryptCredential } from './crypto';
import { appTokenSource, permissionFingerprint, registrySchema } from './repository-apps';
export async function importConfiguredRepositoryApp(): Promise<void> {
  const db = database();
  if (!db) return;
  const clientId = configured(process.env.GITHUB_REPOSITORY_CLIENT_ID);
  const clientSecret = configured(process.env.GITHUB_REPOSITORY_CLIENT_SECRET);
  const appId = configured(process.env.GITHUB_REPOSITORY_APP_ID);
  const privateKey = configured(process.env.GITHUB_REPOSITORY_PRIVATE_KEY);
  const webhook =
    configured(process.env.GITHUB_REPOSITORY_WEBHOOK_SECRET) ?? configured(process.env.GITHUB_WEBHOOK_SECRET);
  if (
    !clientId ||
    !clientSecret ||
    !appId ||
    !privateKey ||
    !webhook ||
    clientId === configured(process.env.GITHUB_IDENTITY_CLIENT_ID)
  )
    return;
  if ((await db.query("SELECT id FROM repository_apps WHERE host='github.com' AND app_id=$1", [appId])).rows.length)
    return;
  const temp = {
    id: crypto.randomUUID(),
    host: 'github.com',
    app_id: appId,
    slug: 'configured',
    client_id: clientId,
    encrypted_secret: await encryptCredential(clientSecret),
    encrypted_private_key: await encryptCredential(privateKey),
    encrypted_webhook_secret: await encryptCredential(webhook),
    permissions: {},
    fingerprint: '',
  };
  const api = createApiTransport({
    baseUrl: 'https://api.github.com/',
    source: await appTokenSource(temp),
  });
  const result = await api.request('app');
  if (!result.ok) return;
  const metadata = z
    .object({
      id: z.number(),
      slug: z.string(),
      client_id: z.string().optional(),
      permissions: z.record(z.string(), z.string()),
    })
    .safeParse(result.value);
  if (
    !metadata.success ||
    String(metadata.data.id) !== appId ||
    (metadata.data.client_id && metadata.data.client_id !== clientId)
  )
    return;
  const app = registrySchema.parse({
    ...temp,
    slug: metadata.data.slug,
    permissions: metadata.data.permissions,
    fingerprint: permissionFingerprint(metadata.data.permissions),
  });
  await db.query(
    'INSERT INTO repository_apps(id,host,fingerprint,permissions,app_id,slug,client_id,encrypted_secret,encrypted_private_key,encrypted_webhook_secret) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(provider,host,fingerprint) DO NOTHING',
    [
      app.id,
      app.host,
      app.fingerprint,
      JSON.stringify(app.permissions),
      app.app_id,
      app.slug,
      app.client_id,
      app.encrypted_secret,
      app.encrypted_private_key,
      app.encrypted_webhook_secret,
    ],
  );
}
