import { connection } from 'next/server';
import { getAuth } from '@/lib/auth';
import { currentActor } from '@/lib/session';
import { json } from '@/lib/http';
import { demoEnabled } from '@/lib/env';
import { connectedProviderViewers } from '@/lib/provider-viewers';
export async function GET(): Promise<Response> {
  await connection();
  const user = await currentActor();
  const viewers = demoEnabled() ? { github: 'alex' } : user ? await connectedProviderViewers() : {};
  return json({ user, configured: getAuth() !== null, demo: demoEnabled(), viewers });
}
