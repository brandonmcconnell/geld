import 'server-only';
import { z } from 'zod';
import { pullRefSchema, resourceSchema } from '@geld/domain';
import { currentActor } from './session';
import { database } from './db';
import { transaction } from './transactions';
import { appendAudit } from './audit';
import { readJson } from './http';
import { resourceDigest } from './resource-digest';
export async function requestAuditResource(
  request: Request,
  action: string,
): Promise<{
  readonly type: string;
  readonly id: string;
  readonly team: string | null;
}> {
  const url = new URL(request.url);
  let raw: unknown = null;
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('content-type')?.startsWith('application/json'))
    raw = await readJson(request.clone());
  const body = z
    .object({
      ref: z.unknown().optional(),
      teamId: z.string().max(200).optional(),
    })
    .safeParse(raw);
  const query = Object.fromEntries(url.searchParams);
  const ref = body.success ? body.data.ref : { ...query, ...(query.number ? { number: Number(query.number) } : {}) };
  const pull = pullRefSchema.safeParse(ref);
  const repo = resourceSchema.safeParse(ref);
  const team =
    /^\/api\/teams\/([^/]+)/.exec(url.pathname)?.[1] ??
    (body.success ? body.data.teamId : null) ??
    url.searchParams.get('team') ??
    url.searchParams.get('teamId');
  return pull.success
    ? { type: 'pull_request', id: resourceDigest(pull.data), team }
    : repo.success
      ? { type: 'repository', id: resourceDigest(repo.data), team }
      : { type: 'endpoint', id: action, team };
}
/** Structural access receipts complement detailed mutations. Raw bodies, full URLs and credentials are never recorded. */
export function auditedRoute<T extends unknown[]>(
  handler: (request: Request, ...rest: T) => Promise<Response>,
  action: string,
): (request: Request, ...rest: T) => Promise<Response> {
  return async (request, ...rest) => {
    const actor = await currentActor();
    const db = database();
    const resource =
      actor && db ? await requestAuditResource(request, action) : { type: 'endpoint', id: action, team: null };
    const scopes =
      actor && db
        ? z
            .array(z.object({ team_id: z.string() }))
            .parse(
              (
                await db.query(
                  'SELECT m.team_id FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.user_id=$1 AND(t.personal_owner_id=$1 OR m.team_id=$2)',
                  [actor.id, resource.team],
                )
              ).rows,
            )
        : [];
    let response: Response;
    try {
      response = await handler(request, ...rest);
    } catch {
      response = Response.json(
        {
          error: 'This request could not be completed. Check its current state before retrying.',
        },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
    if (actor && db) {
      for (const scope of scopes) {
        try {
          await transaction(db, async (sql) => {
            const exists = await sql.query('SELECT id FROM teams WHERE id=$1', [scope.team_id]);
            if (!exists.rows.length) return;
            await appendAudit(sql, {
              teamId: scope.team_id,
              actorId: actor.id,
              action: `request.${action}`,
              resourceType: resource.type,
              resourceId: resource.id,
              outcome:
                response.status < 400
                  ? 'success'
                  : response.status === 401 || response.status === 403
                    ? 'denied'
                    : 'failure',
              before: { requested: true },
              after: { method: request.method, status: response.status },
            });
          });
        } catch {
          console.error('Geld structural request audit is unavailable');
        }
      }
    }
    return response;
  };
}
