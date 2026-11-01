import 'server-only';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { configured } from './env';
import type { SqlExecutor } from './transactions';
const stateSchema = z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]));
export interface AuditInput {
  readonly teamId: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: 'success' | 'denied' | 'pending' | 'failure';
  readonly before?: z.infer<typeof stateSchema>;
  readonly after?: z.infer<typeof stateSchema>;
  readonly requestId?: string;
}
function digest(value: string): string {
  const secret = configured(process.env.TOKEN_ENCRYPTION_KEY) ?? configured(process.env.BETTER_AUTH_SECRET);
  if (!secret || secret.length < 32) throw new Error('Security record signing is not configured');
  return createHmac('sha256', secret).update(value).digest('hex');
}
export async function appendAudit(sql: SqlExecutor, input: AuditInput): Promise<void> {
  await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.teamId]);
  const previous = z
    .object({ hash: z.string() })
    .safeParse(
      (
        await sql.query('SELECT hash FROM audit_events WHERE team_id = $1 ORDER BY sequence DESC LIMIT 1', [
          input.teamId,
        ])
      ).rows[0],
    );
  const prior = previous.success ? previous.data.hash : '';
  const at = new Date().toISOString();
  const actor = digest(`actor:${input.actorId}`);
  const before = stateSchema.parse(input.before ?? {});
  const after = stateSchema.parse(input.after ?? {});
  const requestId = input.requestId ?? crypto.randomUUID();
  const hash = digest(
    JSON.stringify([
      input.teamId,
      actor,
      input.action,
      input.resourceType,
      input.resourceId,
      input.outcome,
      before,
      after,
      requestId,
      at,
      prior,
    ]),
  );
  await sql.query(
    'INSERT INTO audit_events(id,team_id,actor_id,actor_digest,action,resource_type,resource_id,outcome,before_state,after_state,request_id,previous_hash,hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [
      crypto.randomUUID(),
      input.teamId,
      input.actorId,
      actor,
      input.action,
      input.resourceType,
      input.resourceId,
      input.outcome,
      JSON.stringify(before),
      JSON.stringify(after),
      requestId,
      prior,
      hash,
      at,
    ],
  );
}
