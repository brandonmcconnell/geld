import { connection } from 'next/server';
import { z } from 'zod';
import type { ProviderResult } from '@geld/domain';
import { pullRefSchema } from '@geld/domain';
import { currentActor, providerViewer } from '@/lib/session';
import { providerClient } from '@/lib/providers';
import { database } from '@/lib/db';
import { json, sameOrigin } from '@/lib/http';
import { resourceDigest } from '@/lib/resource-digest';
import { submitProviderReview } from '@/lib/review-write';
import { demoEnabled } from '@/lib/env';
const requestSchema = z.object({ ref: pullRefSchema, kind: z.enum(['review','comment','line_comment','reply','resolve']), event: z.enum(['comment','approve','request_changes']).optional(), body: z.string().max(60000), headSha: z.string().min(1).max(100), path: z.string().max(1000).optional(), oldPath: z.string().max(1000).optional(), line: z.number().int().positive().optional(), side: z.enum(['old','new']).optional(), threadId: z.string().max(200).optional(), resolved: z.boolean().optional() });
export async function POST(request: Request): Promise<Response> {
  await connection();
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  const actor = await currentActor();
  if (!actor) return json({ error: 'Sign in to post a review' }, 401);
  if (demoEnabled()) return json({ error: 'Provider writes are disabled in the local demonstration' }, 409);
  const value: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return json({ error: 'Invalid review request' }, 400);
  const input = parsed.data;
  const db = database();
  if (!db) return json({ error: 'Security record storage is not configured' }, 503);
  try {
    const digest = resourceDigest(input.ref);
    const id = crypto.randomUUID();
    await db.query('INSERT INTO review_receipts(id,user_id,provider,resource_fingerprint,action,outcome) VALUES ($1,$2,$3,$4,$5,\'pending\')', [id, actor.id, input.ref.provider, digest, input.kind]);
    const client = await providerClient(input.ref.provider, input.ref.host);
    const current = await client.pull(input.ref);
    if (!current.ok || current.value.headSha !== input.headSha) { await db.query('UPDATE review_receipts SET outcome = \'denied\' WHERE id = $1', [id]); return json({ error: 'The pull request changed or could not be verified. Reload before posting.' }, 409); }
    const result: ProviderResult<string | void> | { readonly ok: false; readonly reason: 'stale' | 'own_review' } = input.kind === 'review' && input.event
      ? await submitProviderReview({ client, ref: input.ref, review: { event: input.event, body: input.body, headSha: input.headSha }, viewer: await providerViewer(input.ref.provider) })
      : input.kind === 'reply' && input.threadId
        ? await client.reply(input.ref, input.threadId, input.body)
        : input.kind === 'resolve' && input.threadId && input.resolved !== undefined
          ? await client.resolve(input.ref, input.threadId, input.resolved)
      : input.kind === 'comment'
        ? await client.comment(input.ref, input.body)
        : input.kind === 'line_comment' && input.path && input.line && input.side
          ? await client.lineComment(input.ref, { body: input.body, path: input.path, ...(input.oldPath ? { oldPath: input.oldPath } : {}), line: input.line, side: input.side, headSha: input.headSha })
          : { ok: false, reason: 'invalid_response' };
    await db.query('UPDATE review_receipts SET outcome = $2 WHERE id = $1', [id, result.ok ? 'success' : 'failure']);
    return result.ok ? json({ posted: true, reference: result.value }) : json({ error: result.reason === 'permission' ? 'The provider or repository App does not grant this permission. Open the pull request on the provider or update the installation.' : result.reason === 'unsupported' ? 'This provider does not support this action through Geld yet. Open the pull request on the provider.' : result.reason === 'own_review' ? 'You cannot approve or request changes on your own pull request.' : 'The provider could not confirm this review. Check its current state before trying again.', ...(result.reason === 'permission' ? { required: result.required } : {}) }, result.reason === 'permission' ? 403 : result.reason === 'unsupported' ? 501 : 409);
  } catch { return json({ error: 'This review could not be posted. Check the provider before trying again.' }, 503); }
}
