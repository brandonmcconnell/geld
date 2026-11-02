import { readJson } from '@/lib/http';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { teamMembership } from '@/lib/workspaces';
import { accessAdapter, repoRowSchema, refFor, providerAdmin } from '@/lib/team-access';
import { previewCollaborators, queueOutsideGrant, auditPerson } from '@/lib/collaborator-audit';
import { transaction } from '@/lib/transactions';
import { appendAudit } from '@/lib/audit';
import { auditedRoute } from '@/lib/request-audit';
import { json, sameOrigin } from '@/lib/http';
async function readGET(request: Request, { params }: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const actor = await currentActor();
  const { id } = await params;
  if (!actor || !(await teamMembership(actor.id, id, true)))
    return json({ error: 'Team admin permission is required' }, 403);
  const db = database();
  if (!db) return json({ error: 'Team storage is unavailable' }, 503);
  const tier = z
    .object({ tier: z.string() })
    .parse((await db.query('SELECT tier FROM subscriptions WHERE team_id=$1', [id])).rows[0]);
  if (!['team', 'business', 'enterprise'].includes(tier.tier))
    return json({ error: 'Outside collaborator audit needs Team or above' }, 402);
  const url = new URL(request.url);
  const page = z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .safeParse(url.searchParams.get('page') ?? 1);
  if (!page.success) return json({ error: 'Invalid page' }, 400);
  const rows = z
    .array(repoRowSchema)
    .parse(
      (await db.query('SELECT * FROM team_repos WHERE team_id=$1 AND approved AND removed_at IS NULL', [id])).rows,
    );
  const collaborators = [];
  const repositories = [];
  const unavailable = [];
  let more = false;
  for (const repo of rows) {
    if (!(await providerAdmin(repo))) {
      unavailable.push(repo.id);
      continue;
    }
    repositories.push({
      id: repo.id,
      name: repo.name,
      owner: repo.owner,
      provider: repo.provider,
      host: repo.host,
    });
    const adapter = await accessAdapter(repo.provider, id, repo.owner, undefined, repo.host);
    const result = await adapter.collaborators(refFor(repo), page.data);
    if (!result.ok) {
      unavailable.push(repo.id);
      continue;
    }
    more ||= result.value.more;
    for (const user of result.value.users) {
      const membership = await adapter.user(refFor(repo), user.login);
      if (!membership.ok) {
        unavailable.push(`${repo.id}:${user.id}`);
        continue;
      }
      if (!membership.value.organisationMember)
        collaborators.push({
          ...user,
          repoId: repo.id,
          repository: `${repo.owner}/${repo.name}`,
          provider: repo.provider,
          host: repo.host,
        });
    }
  }
  return json({
    collaborators,
    repositories,
    unavailable,
    next: more ? page.data + 1 : null,
  });
}

async function handle(request: Request, { params }: { readonly params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  const { id } = await params;
  if (!actor || !(await teamMembership(actor.id, id, true)))
    return json({ error: 'Team admin permission is required' }, 403);
  const db = database();
  if (!db) return json({ error: 'Team storage is unavailable' }, 503);
  const eligible = await db.query(
    "SELECT t.id FROM teams t JOIN subscriptions s ON s.team_id=t.id WHERE t.id=$1 AND t.managed_access AND s.tier IN('team','business','enterprise')",
    [id],
  );
  if (!eligible.rows.length) return json({ error: 'Outside grants require managed access on Team or above' }, 402);
  const input = z
    .object({
      people: z.array(auditPerson).min(1).max(100),
      confirmation: z.string().optional(),
    })
    .safeParse(await readJson(request));
  if (!input.success) return json({ error: 'Select outside collaborators first' }, 400);
  try {
    const preview = await previewCollaborators(id, input.data.people);
    if (!input.data.confirmation) return json(preview);
    if (input.data.confirmation !== preview.confirmation)
      return json(
        {
          error: 'Provider access changed. Preview the invitation count again.',
        },
        409,
      );
    await transaction(db, async (sql) => {
      const enabled = await sql.query('SELECT id FROM teams WHERE id=$1 AND managed_access FOR UPDATE', [id]);
      if (!enabled.rows.length) throw new Error('Managed access was disabled');
      for (const person of preview.missing) await queueOutsideGrant(sql, id, actor.id, person);
      await appendAudit(sql, {
        teamId: id,
        actorId: actor.id,
        action: 'collaborators.include',
        resourceType: 'team',
        resourceId: id,
        outcome: 'pending',
        after: {
          newGrants: preview.missing.length,
          people: input.data.people.length,
        },
      });
    });
    return json({ saved: true, pending: preview.missing.length });
  } catch {
    return json(
      {
        error:
          'The outside collaborator audit changed or provider admin access could not be verified. Nothing was granted. Refresh before continuing.',
      },
      409,
    );
  }
}
export const POST = auditedRoute(handle, 'teams.collaborators');

export const GET = auditedRoute(readGET, 'teams.team.collaborators.get');
