import 'server-only';
import { createHmac } from 'node:crypto';
import type { PullRef } from '@geld/domain';
import { configured } from './env';
export function resourceDigest(ref: PullRef): string {
  const secret = configured(process.env.TOKEN_ENCRYPTION_KEY);
  if (!secret || secret.length < 32) throw new Error('Security record signing is not configured');
  return createHmac('sha256', secret).update(`resource:${JSON.stringify(ref)}`).digest('hex');
}
