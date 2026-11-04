import { connection } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { configured } from '@/lib/env';
import { consumePullEvent } from '@/lib/webhooks';
import { json, readText } from '@/lib/http';
export async function POST(request: Request): Promise<Response> {
  await connection();
  const secret = configured(process.env.GITLAB_WEBHOOK_SECRET);
  const received = request.headers.get('x-gitlab-token');
  if (
    !secret ||
    !received ||
    Buffer.byteLength(secret) !== Buffer.byteLength(received) ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(received))
  )
    return json({ error: 'Invalid webhook token' }, 401);
  const delivery = request.headers.get('x-gitlab-event-uuid');
  if (!delivery || delivery.length > 200) return json({ error: 'Missing delivery ID' }, 400);
  const text = await readText(request, 2_000_000);
  if (text === null) return json({ error: 'The webhook body is too large or incomplete' }, 413);
  try {
    const p = z
      .object({
        object_kind: z.string(),
        project: z.object({ id: z.number() }),
        object_attributes: z.object({
          iid: z.number(),
          state: z.string(),
          action: z.string().optional(),
          draft: z.boolean().optional(),
          last_commit: z.object({ id: z.string() }),
        }),
      })
      .safeParse(JSON.parse(text));
    if (!p.success || p.data.object_kind !== 'merge_request') return json({ received: true, ignored: true });
    const d = p.data;
    const stored = await consumePullEvent(delivery, {
      provider: 'gitlab',
      host: 'gitlab.com',
      repositoryId: String(d.project.id),
      number: d.object_attributes.iid,
      headSha: d.object_attributes.last_commit.id,
      state:
        d.object_attributes.state === 'opened' ? 'open' : d.object_attributes.state === 'merged' ? 'merged' : 'closed',
      draft: d.object_attributes.draft ?? false,
      event:
        d.object_attributes.action === 'open' ? 'created' : d.object_attributes.action === 'update' ? 'push' : 'other',
    });
    return stored
      ? json({ received: true })
      : json({ error: 'Webhook storage is unavailable. Retry this delivery.' }, 503);
  } catch {
    return json({ error: 'Webhook processing will be retried' }, 503);
  }
}
