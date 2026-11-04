import { auditedRoute } from '@/lib/request-audit';
import { importConfiguredRepositoryApp } from '@/lib/configured-app';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { registrySchema, appPermissions, permissionFingerprint } from '@/lib/repository-apps';
import { resourceDigest } from '@/lib/resource-digest';
import { dashboardOrigin } from '@/lib/env';
import { registeredEnterpriseHost } from '@/lib/enterprise';
import { json } from '@/lib/http';
/** Identity callback continues here; an existing installation never needs organisation admin rights merely to authorize a reader. */
async function readGET(request: Request): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return Response.redirect(new URL('/sign-in', dashboardOrigin()));
  const db = database();
  if (!db) return json({ error: 'Repository storage is unavailable' }, 503);
  const url = new URL(request.url);
  const host = url.searchParams.get('host') ?? 'github.com';
  if (host !== 'github.com' && !(await registeredEnterpriseHost(host, actor.id)))
    return json({ error: 'Register this Enterprise host first' }, 403);
  if (host === 'github.com') await importConfiguredRepositoryApp();
  const appId = url.searchParams.get('app');
  const fingerprint = permissionFingerprint(
    appPermissions({
      managedAccess: false,
      merge: false,
      settings: false,
      deletion: false,
    }),
  );
  const app = registrySchema.safeParse(
    (
      await db.query(
        'SELECT * FROM repository_apps WHERE host=$1 AND ($2::text IS NULL OR id=$2) ORDER BY CASE WHEN fingerprint=$3 THEN 0 ELSE 1 END,length(permissions::text),id LIMIT 1',
        [host, appId, fingerprint],
      )
    ).rows[0],
  );
  if (!app.success) return Response.redirect(new URL('/connect?repository=setup-needed', dashboardOrigin()));
  const team = z
    .object({ id: z.string() })
    .parse((await db.query('SELECT id FROM teams WHERE personal_owner_id=$1', [actor.id])).rows[0]);
  const state = crypto.randomUUID();
  await db.query(
    "INSERT INTO app_flows(id,actor_id,team_id,kind,app_id,state_digest,settings) VALUES($1,$2,$3,'authorize',$4,$5,'{\"personal\":true}')",
    [crypto.randomUUID(), actor.id, team.id, app.data.id, resourceDigest(state)],
  );
  return Response.redirect(
    `https://${host}/login/oauth/authorize?${new URLSearchParams({ client_id: app.data.client_id, redirect_uri: `${dashboardOrigin()}/api/apps/authorize`, state })}`,
  );
}

export const GET = auditedRoute(readGET, 'apps.connect.get');
