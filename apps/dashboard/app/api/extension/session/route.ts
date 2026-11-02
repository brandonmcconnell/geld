import { auditedRoute } from '@/lib/request-audit';
import { connection } from 'next/server';
import { currentActor } from '@/lib/session';
import { listTeams } from '@/lib/workspaces';
import { json } from '@/lib/http';
async function readGET(request: Request): Promise<Response> {
  await connection();
  const actor = await currentActor();
  const response = json({
    user: actor ? { id: actor.id, name: actor.name, image: actor.image ?? null } : null,
    teams: actor ? (await listTeams(actor.id)).map((t) => ({ id: t.id, name: t.name })) : [],
  });
  const origin = request.headers.get('origin');
  if (
    origin === 'https://www.geld.sh' ||
    (process.env.NODE_ENV === 'development' && origin === 'http://localhost:3000')
  ) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Vary', 'Origin');
  }
  return response;
}

export const GET = auditedRoute(readGET, 'extension.session.get');
