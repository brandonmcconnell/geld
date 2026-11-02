import { connection } from 'next/server';
import { getAuth } from '@/lib/auth';
async function handle(request: Request): Promise<Response> {
  await connection();
  if (/\/(get-access-token|refresh-token)$/.test(new URL(request.url).pathname)) return Response.json({ error: 'Not found' }, { status: 404 });
  const auth = getAuth();
  if (!auth) return Response.json({ error: 'Authentication is not configured in this environment' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    return await auth.handler(request);
  } catch {
    return Response.json({ error: 'Authentication is temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export { handle as GET, handle as POST };
