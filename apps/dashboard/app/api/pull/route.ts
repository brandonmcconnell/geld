import { connection } from 'next/server';
import { pullRefSchema } from '@geld/domain';
import { json } from '@/lib/http';
import { reviewContext } from '@/lib/review-context';
export async function GET(request: Request): Promise<Response> {
  await connection();
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = pullRefSchema.safeParse({ ...query, number: Number(query.number) });
  if (!parsed.success) return json({ error: 'Invalid pull request reference' }, 400);
  try {
    const result = await reviewContext(parsed.data);
    return result.ok ? json(result.value) : json({ error: result.reason }, result.reason === 'stale' ? 409 : result.reason === 'not_found' ? 404 : result.reason === 'signed_out' ? 401 : 503);
  } catch { return json({ error: 'This provider connection is unavailable' }, 503); }
}
