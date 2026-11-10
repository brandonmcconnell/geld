import { z } from 'zod';
import { pullRefSchema } from '@geld/domain';
import { currentActor } from '@/lib/session';
import { providerClient } from '@/lib/providers';
import { json } from '@/lib/http';
import { auditedRoute } from '@/lib/request-audit';
const schema = pullRefSchema.extend({
  path: z.string().min(1).max(2000),
  revision: z.string().regex(/^[a-f0-9]{40,64}$/i),
});
async function readGET(request: Request) {
  if (!(await currentActor())) return json({ error: 'Sign in to view source' }, 401);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse({ ...query, number: Number(query.number) });
  if (
    !parsed.success ||
    parsed.data.path.split('/').some((part) => !part || part === '.' || part === '..') ||
    /[\\\x00-\x1f]/.test(parsed.data.path)
  )
    return json({ error: 'Invalid file reference' }, 400);
  const { path, revision, ...ref } = parsed.data;
  try {
    const client = await providerClient(ref.provider, ref.host, ref.owner);
    const pull = await client.pull(ref);
    if (!pull.ok) return json({ error: 'File unavailable' }, 404);
    if (![pull.value.headSha, pull.value.baseSha].includes(revision))
      return json({ error: 'The pull request changed. Refresh before expanding context.' }, 409);
    const source = await client.fileContent?.(ref, path, revision);
    if (!source?.ok) return json({ error: 'Source unavailable for this file' }, 404);
    if (query.raw === 'true')
      return new Response(source.value, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    return json({ lines: source.value.split('\n'), revision });
  } catch {
    return json({ error: 'Source could not be loaded. Try again.' }, 503);
  }
}
export const GET = auditedRoute(readGET, 'pull.file');
