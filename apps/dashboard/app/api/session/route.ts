import { connection } from 'next/server';
import { getAuth } from '@/lib/auth';
import { currentActor } from '@/lib/session';
import { json } from '@/lib/http';
import { demoEnabled } from '@/lib/env';
export async function GET(): Promise<Response> {
  await connection();
  return json({ user: await currentActor(), configured: getAuth() !== null, demo: demoEnabled() });
}
