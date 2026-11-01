import { connection } from 'next/server';
import { z } from 'zod';
import { resourceSchema } from '@geld/domain';
import { recognizeTickets } from '@geld/core';
import { currentActor } from '@/lib/session';
import { teamMembership } from '@/lib/workspaces';
import { accessAdapter } from '@/lib/team-access';
import { trackerConnection,trackerStatus } from '@/lib/tracker-status';
import { json,sameOrigin } from '@/lib/http';
export async function POST(request:Request):Promise<Response>{await connection();const origin=request.headers.get('origin');if(!sameOrigin(request)&&!(origin&&/^(?:chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[a-f0-9-]{36})$/.test(origin)))return json({error:'Extension origin is required'},403);const actor=await currentActor();if(!actor)return json({error:'Sign in to Geld'},401);const input=z.object({teamId:z.string(),repository:resourceSchema,urls:z.array(z.url().max(2000)).max(20)}).safeParse(await request.json().catch(()=>null));if(!input.success)return json({error:'Invalid tracker request'},400);const i=input.data;if(!await teamMembership(actor.id,i.teamId))return json({error:'Team membership is required'},403);const repository=await(await accessAdapter(i.repository.provider,i.teamId,i.repository.owner)).repository(i.repository);if(!repository.ok||repository.value.permission==='none')return json({error:'Provider access is required'},403);const tracker=await trackerConnection(i.teamId);const refs=recognizeTickets(i.urls.join('\n'),i.repository,tracker?.config);return json({links:await Promise.all(refs.map(async ref=>({...ref,status:await trackerStatus(ref,tracker)}))),config:tracker?.config??null});}
