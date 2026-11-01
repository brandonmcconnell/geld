import { auditedRoute } from '@/lib/request-audit';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { teamMembership } from '@/lib/workspaces';
import { json } from '@/lib/http';
async function readGET(request: Request): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in first' }, 401);
  const db = database();
  if (!db) return json({ error: 'Security storage is not configured' }, 503);
  const url = new URL(request.url);
  const team = url.searchParams.get('team');
  if (!team)
    return json({
      events: (
        await db.query(
          'SELECT id,provider,action,outcome,created_at FROM review_receipts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',
          [actor.id],
        )
      ).rows,
    });
  if (!(await teamMembership(actor.id, team, true))) return json({ error: 'Team admin permission is required' }, 403);
  const exportRequested = url.searchParams.get('export') === 'true';
  if (exportRequested) {
    const s = z
      .object({ tier: z.string() })
      .parse((await db.query('SELECT tier FROM subscriptions WHERE team_id=$1', [team])).rows[0]);
    if (!['business', 'enterprise'].includes(s.tier))
      return json({ error: 'Audit export needs Business or Enterprise' }, 402);
  }
  const cursor = z.coerce
    .number()
    .int()
    .nonnegative()
    .safeParse(url.searchParams.get('after') ?? 0);
  if (!cursor.success) return json({ error: 'Invalid cursor' }, 400);
  const events = await db.query(
    'SELECT id,sequence,actor_digest,action,resource_type,resource_id,outcome,before_state,after_state,request_id,previous_hash,hash,created_at FROM audit_events WHERE team_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 500',
    [team, cursor.data],
  );
  return json({
    events: events.rows,
    retentionDays: 365,
    next:
      events.rows.length === 500
        ? z.object({ sequence: z.union([z.string(), z.number()]) }).parse(events.rows.at(-1)).sequence
        : null,
  });
}

export const GET = auditedRoute(readGET, 'security.get');
