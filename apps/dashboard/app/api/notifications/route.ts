import { auditedRoute } from '@/lib/request-audit';
import { connection } from 'next/server';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { json } from '@/lib/http';
async function readGET(): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ notifications: [] }, 401);
  const db = database();
  return json({
    invites: db
      ? (
          await db.query(
            "SELECT i.team_id,t.name FROM team_invites i JOIN teams t ON t.id=i.team_id WHERE i.invited_user_id=$1 AND i.state='pending' AND i.expires_at>now()",
            [actor.id],
          )
        ).rows
      : [],
    notifications: db
      ? (
          await db.query(
            'SELECT id,team_id,kind,resource_id,created_at FROM notifications WHERE user_id=$1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 50',
            [actor.id],
          )
        ).rows
      : [],
  });
}

export const GET = auditedRoute(readGET, 'notifications.get');
