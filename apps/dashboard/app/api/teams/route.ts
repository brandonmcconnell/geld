import { readJson } from '@/lib/http';
import { auditedRoute } from '@/lib/request-audit';
import { connection } from 'next/server';
import { z } from 'zod';
import { planFor } from '@geld/domain';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { transaction } from '@/lib/transactions';
import { appendAudit } from '@/lib/audit';
import { listTeams } from '@/lib/workspaces';
import { demoEnabled } from '@/lib/env';
import { json, sameOrigin } from '@/lib/http';
async function readGET(): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ teams: [] }, 401);
  if (demoEnabled())
    return json({
      teams: [
        {
          id: 'demo-team',
          name: 'Personal workspace',
          role: 'admin',
          managed_access: false,
          sync_enabled: false,
          add_approval: true,
          visibility: 'request',
          tier: 'team',
          seats: 1,
          used_credits: 12,
          cap_cents: 0,
          spent_cents: 0,
          card_on_file: false,
        },
      ],
      demo: true,
    });
  try {
    return json({ teams: await listTeams(actor.id) });
  } catch {
    return json({ error: 'Teams could not be loaded' }, 503);
  }
}
async function handlePOST(request: Request): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in to create a team' }, 401);
  const input = z.object({ name: z.string().trim().min(1).max(100) }).safeParse(await readJson(request));
  if (!input.success) return json({ error: 'Enter a team name' }, 400);
  const db = database();
  if (!db) return json({ error: 'Team storage is not configured' }, 503);
  try {
    const id = crypto.randomUUID();
    const created = await transaction(db, async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`team-limit:${actor.id}`]);
      const owned = z
        .array(
          z.object({
            tier: z.enum(['free', 'starter', 'team', 'business', 'enterprise']),
          }),
        )
        .parse(
          (
            await sql.query(
              "SELECT s.tier FROM subscriptions s JOIN team_members m ON m.team_id = s.team_id WHERE m.user_id = $1 AND m.role = 'admin'",
              [actor.id],
            )
          ).rows,
        );
      const maxima = owned.map((team) => planFor(team.tier).maxTeams);
      const limit = maxima.some((value) => value === null)
        ? null
        : Math.max(1, ...maxima.filter((value): value is number => value !== null));
      if (limit !== null && owned.length >= limit) return false;
      await sql.query('INSERT INTO teams(id,name,created_by) VALUES ($1,$2,$3)', [id, input.data.name, actor.id]);
      await sql.query("INSERT INTO team_members(team_id,user_id,role) VALUES ($1,$2,'admin')", [id, actor.id]);
      await sql.query('INSERT INTO subscriptions(team_id) VALUES ($1)', [id]);
      await appendAudit(sql, {
        teamId: id,
        actorId: actor.id,
        action: 'team.create',
        resourceType: 'team',
        resourceId: id,
        outcome: 'success',
        after: { name: input.data.name },
      });
      return true;
    });
    if (!created)
      return json(
        {
          error: 'Your plan has reached its team limit. Upgrade before creating another team.',
        },
        402,
      );
    return json({ id }, 201);
  } catch {
    return json({ error: 'This team could not be created' }, 503);
  }
}

export const POST = auditedRoute(handlePOST, 'teams.post');

export const GET = auditedRoute(readGET, 'teams.get');
