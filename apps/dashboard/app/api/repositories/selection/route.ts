import { readJson } from '@/lib/http';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { transaction } from '@/lib/transactions';
import { json, sameOrigin } from '@/lib/http';
import { auditedRoute } from '@/lib/request-audit';
const choice = z.object({
  provider: z.enum(['github', 'gitlab', 'bitbucket']),
  host: z.string().max(253),
  id: z.string().max(200),
  visible: z.boolean(),
});
async function readGET(): Promise<Response> {
  await connection();
  const actor = await currentActor();
  if (!actor) return json({ choices: [] }, 401);
  const db = database();
  return json({
    choices: db
      ? (
          await db.query('SELECT provider,host,external_id AS id,visible FROM repository_visibility WHERE user_id=$1', [
            actor.id,
          ])
        ).rows
      : [],
  });
}
async function save(request: Request): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in first' }, 401);
  const input = z.object({ choices: z.array(choice).max(1000) }).safeParse(await readJson(request));
  if (!input.success) return json({ error: 'Invalid repository selection' }, 400);
  const db = database();
  if (!db) return json({ error: 'Repository storage is unavailable' }, 503);
  await transaction(db, async (sql) => {
    for (const row of input.data.choices)
      await sql.query(
        'INSERT INTO repository_visibility(user_id,provider,host,external_id,visible) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,provider,host,external_id) DO UPDATE SET visible=EXCLUDED.visible',
        [actor.id, row.provider, row.host, row.id, row.visible],
      );
  });
  return json({ saved: true });
}
export const POST = auditedRoute(save, 'repositories.selection');

export const GET = auditedRoute(readGET, 'repositories.selection.get');
