import { readJson } from '@/lib/http';
import { auditedRoute } from '@/lib/request-audit';
import { registeredEnterpriseHost } from '@/lib/enterprise';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { teamMembership } from '@/lib/workspaces';
import { appOwner, appOptionsSchema, manifestFor, registrySchema } from '@/lib/repository-apps';
import { resourceDigest } from '@/lib/resource-digest';
import { dashboardOrigin } from '@/lib/env';
import { json, sameOrigin } from '@/lib/http';
async function handlePOST(request: Request): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in first' }, 401);
  const db = database();
  if (!db) return json({ error: 'App storage is not configured' }, 503);
  const input = appOptionsSchema.extend({ teamId: z.string() }).safeParse(await readJson(request));
  if (!input.success) return json({ error: 'Choose a permission set' }, 400);
  if (!(await teamMembership(actor.id, input.data.teamId, true)))
    return json({ error: 'Team admin permission is required' }, 403);
  const host = input.data.host ?? 'github.com';
  if (host !== 'github.com' && !(await registeredEnterpriseHost(host, actor.id)))
    return json({ error: 'Register this Enterprise host first' }, 403);
  const { fingerprint, manifest } = manifestFor(input.data);
  const existing = registrySchema.safeParse(
    (
      await db.query("SELECT * FROM repository_apps WHERE provider='github' AND host=$2 AND fingerprint=$1", [
        fingerprint,
        host,
      ])
    ).rows[0],
  );
  const state = crypto.randomUUID();
  const id = crypto.randomUUID();
  if (existing.success) {
    await db.query(
      "INSERT INTO app_flows(id,actor_id,team_id,kind,app_id,state_digest) VALUES($1,$2,$3,'install',$4,$5)",
      [id, actor.id, input.data.teamId, existing.data.id, resourceDigest(state)],
    );
    return json({
      url: `https://${host}/apps/${existing.data.slug}/installations/new?state=${state}`,
    });
  }
  if (host === 'github.com' && !appOwner(actor.id))
    return json(
      {
        error:
          'This permission set needs one owner confirmation. An existing matching App can be installed immediately.',
        ownerConfirmation: true,
        fingerprint,
      },
      409,
    );
  await db.query(
    "INSERT INTO app_flows(id,actor_id,team_id,kind,fingerprint,state_digest,settings) VALUES($1,$2,$3,'manifest',$4,$5,$6)",
    [id, actor.id, input.data.teamId, fingerprint, resourceDigest(state), JSON.stringify(input.data)],
  );
  return json({
    manifest,
    manifestUrl: `https://${host}/settings/apps/new?state=${state}`,
    callback: `${dashboardOrigin()}/api/apps/callback`,
    fingerprint,
  });
}
async function readGET(request: Request): Promise<Response> {
  await connection();
  const actor = await currentActor();
  const team = new URL(request.url).searchParams.get('team');
  if (!actor || !team || !(await teamMembership(actor.id, team, true)))
    return json({ error: 'Team admin permission is required' }, 403);
  const db = database();
  return json({
    installations: db
      ? (
          await db.query(
            'SELECT i.id,i.account_slug,i.permission_fingerprint,i.state,a.slug FROM app_installations i JOIN team_app_installations t ON t.installation_id=i.id JOIN repository_apps a ON a.id=i.registry_id WHERE t.team_id=$1',
            [team],
          )
        ).rows
      : [],
  });
}

export const POST = auditedRoute(handlePOST, 'apps.post');

export const GET = auditedRoute(readGET, 'apps.get');
