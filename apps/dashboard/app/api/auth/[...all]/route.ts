import { connection } from 'next/server';
import { getAuth } from '@/lib/auth';
async function handle(request: Request): Promise<Response> {
  await connection();
  const path=new URL(request.url).pathname;
  if(path.includes('/sso/')&&!/^\/api\/auth\/sso\/callback(?:\/[^/]+)?$/.test(path)||path.endsWith('/sign-in/sso'))return Response.json({error:'Use Geld SSO setup or sign-in'},{status:404});
  if (/\/(get-access-token|refresh-token)$/.test(path)) return Response.json({ error: 'Not found' }, { status: 404 });
  const auth = getAuth();
  if (!auth) return Response.json({ error: 'Authentication is not configured in this environment' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    return await auth.handler(request);
  } catch {
    return Response.json({ error: 'Authentication is temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
export { handle as GET, handle as POST };
