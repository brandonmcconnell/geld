import { pullRefSchema } from '@geld/domain';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { providerClient } from '@/lib/providers';
import { auditedRoute } from '@/lib/request-audit';
import { json } from '@/lib/http';
const querySchema = pullRefSchema.extend({
  section: z.enum(['activity', 'checks']),
  cursor: z
    .string()
    .regex(/^[1-9]\d{0,4}$/)
    .optional(),
  revision: z.string().regex(/^[a-f0-9]{40,64}$/i),
});
async function readGET(request: Request) {
  if (!(await currentActor())) return json({ error: 'Sign in to read review activity' }, 401);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse({ ...params, number: Number(params.number) });
  if (!parsed.success) return json({ error: 'Invalid activity request' }, 400);
  const { section, cursor, revision, ...ref } = parsed.data;
  const client = await providerClient(ref.provider, ref.host, ref.owner);
  const pull = await client.pull(ref);
  if (!pull.ok) return json({ error: 'Pull request unavailable' }, pull.reason === 'permission' ? 403 : 404);
  if (pull.value.headSha !== revision)
    return json({ error: 'The pull request changed. Refresh to read its activity.' }, 409);
  const result =
    section === 'activity'
      ? await client.activity?.(ref, cursor)
      : await client.checks?.(ref, revision, cursor);
  if (!result?.ok) return json({ error: 'Review activity could not be loaded' }, 503);
  return json({ headSha: revision, page: result.value });
}
export const GET = auditedRoute(readGET, 'pull.activity');
