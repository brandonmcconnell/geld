import { githubEndpoints } from '@geld/domain';
import { enterpriseFetch } from '@/lib/enterprise';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { resourceDigest } from '@/lib/resource-digest';
import { registrySchema,appTokenSource } from '@/lib/repository-apps';
import { createApiTransport } from '@geld/github';
import { dashboardOrigin } from '@/lib/env';
import { json } from '@/lib/http';
export async function GET(request:Request):Promise<Response>{await connection();const actor=await currentActor();const db=database();if(!actor||!db)return json({error:'Sign in to finish repository setup'},401);const url=new URL(request.url);const state=url.searchParams.get('state');const installation=url.searchParams.get('installation_id');if(!state||!installation||!/^\d+$/.test(installation))return json({error:'Invalid installation callback'},400);
  const flow=z.object({id:z.string(),team_id:z.string(),app_id:z.string(),settings:z.object({selectRepositories:z.boolean().optional()})}).safeParse((await db.query("UPDATE app_flows SET completed_at=now() WHERE state_digest=$1 AND actor_id=$2 AND kind='install' AND completed_at IS NULL AND expires_at>now() RETURNING *",[resourceDigest(state),actor.id])).rows[0]);if(!flow.success)return json({error:'This installation flow expired'},409);
  const app=registrySchema.parse((await db.query('SELECT * FROM repository_apps WHERE id=$1',[flow.data.app_id])).rows[0]);const api=createApiTransport({baseUrl:githubEndpoints(app.host).api,...(app.host!=='github.com'?{fetch:await enterpriseFetch(app.host)}:{}),source:await appTokenSource(app)});const installed=await api.request(`app/installations/${encodeURIComponent(installation)}`);if(!installed.ok)return json({error:'This App installation could not be confirmed. The old installation was kept.'},409);
  const nextState=crypto.randomUUID();await db.query("INSERT INTO app_flows(id,actor_id,team_id,kind,app_id,state_digest,settings) VALUES($1,$2,$3,'authorize',$4,$5,$6)",[crypto.randomUUID(),actor.id,flow.data.team_id,app.id,resourceDigest(nextState),JSON.stringify({installationId:installation,selectRepositories:flow.data.settings.selectRepositories??false})]);
  return Response.redirect(`https://${app.host}/login/oauth/authorize?${new URLSearchParams({client_id:app.client_id,redirect_uri:`${dashboardOrigin()}/api/apps/authorize`,state:nextState})}`);
}
