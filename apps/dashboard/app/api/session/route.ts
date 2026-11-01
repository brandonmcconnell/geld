import {featureFlags} from '@/lib/features';
import { connection } from 'next/server';
import { getAuth } from '@/lib/auth';
import { currentActor, syncProviderProfiles } from '@/lib/session';
import { json } from '@/lib/http';
import { demoEnabled } from '@/lib/env';
export async function GET(): Promise<Response> {
  await connection();
  const user = await currentActor();
  const viewers = demoEnabled() ? { github: 'alex' } : user ? await syncProviderProfiles(user.id).catch(() => ({})) : {};
  return json({ user, viewers, features:await featureFlags(), configured: getAuth() !== null, demo: demoEnabled() });
}
