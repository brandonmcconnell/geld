import { connection } from 'next/server';
import { currentActor } from '@/lib/session';
import { configured, dashboardOrigin } from '@/lib/env';
import { json } from '@/lib/http';
export async function GET(): Promise<Response> {
  await connection();
  if (!await currentActor()) return Response.redirect(new URL('/sign-in', dashboardOrigin()));
  const slug = configured(process.env.GITHUB_REPOSITORY_APP_SLUG);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return json({ error: 'A repository App must be configured before installation' }, 503);
  return Response.redirect(`https://github.com/apps/${slug}/installations/new`);
}
