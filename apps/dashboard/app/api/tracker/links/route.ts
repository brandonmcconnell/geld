import { connection } from 'next/server';
import { pullRefSchema } from '@geld/domain';
import { recognizeTickets } from '@geld/core';
import { currentActor } from '@/lib/session';
import { providerClient } from '@/lib/providers';
import { reviewSettings } from '@/lib/review-settings';
import { teamMembership } from '@/lib/workspaces';
import { trackerConnection,trackerStatus } from '@/lib/tracker-status';
import { json } from '@/lib/http';
export async function GET(request:Request):Promise<Response>{await connection();const url=new URL(request.url);const query=Object.fromEntries(url.searchParams);const ref=pullRefSchema.safeParse({...query,number:Number(query.number)});if(!ref.success)return json({error:'Invalid pull request'},400);const team=url.searchParams.get('team');const actor=await currentActor();if(team&&(!actor||!await teamMembership(actor.id,team)))return json({error:'Team membership is required'},403);const client=await providerClient(ref.data.provider,ref.data.host,ref.data.owner);const pull=await client.pull(ref.data);if(!pull.ok)return json({links:[]},403);const settings=await reviewSettings(ref.data);const tracker=team?await trackerConnection(team):null;const config=tracker?.config??settings.issueTracker;const refs=recognizeTickets(`${pull.value.title}\n${pull.value.body}\n${pull.value.headBranch??''}`,ref.data,config);return json({links:await Promise.all(refs.map(async r=>({...r,status:actor?await trackerStatus(r,tracker):null})))});}
