import 'server-only';
import { createHmac } from 'node:crypto';
import { configured } from './env';
export function resourceDigest(ref: unknown): string {
  const secret = configured(process.env.TOKEN_ENCRYPTION_KEY) ?? configured(process.env.BETTER_AUTH_SECRET);
  if (!secret || secret.length < 32) throw new Error('Security record signing is not configured');
  return createHmac('sha256', secret)
    .update(`resource:${JSON.stringify(ref)}`)
    .digest('hex');
}
