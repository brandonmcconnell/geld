import {auditedRoute} from '@/lib/request-audit';
import { connection } from 'next/server';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { teamMembership } from '@/lib/workspaces';
import { transaction } from '@/lib/transactions';
import { accessAdapter } from '@/lib/team-access';
import { withGrantLocks } from '@/lib/grant-locks';
import { bitbucketConnectionSchema,changeBitbucketConnection } from '@/lib/provider-connections';
import { json,sameOrigin } from '@/lib/http';
async function handlePOST(request:Request,{params}:{readonly params:Promise<{id:string}>}):Promise<Response> {
  await connection();
  if(!sameOrigin(request))return json({error:'Invalid request origin'},403);
  const actor=await currentActor();const{id}=await params;
  if(!actor||!await teamMembership(actor.id,id,true))return json({error:'Team admin permission is required'},403);
  const db=database();if(!db)return json({error:'Connection storage is not configured'},503);
  const parsed=bitbucketConnectionSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return json({error:'Invalid Bitbucket connection'},400);
  const input=parsed.data;
  if(input.path==='atlassian_groups'&&(!input.organisationId||!input.directoryId||!input.adminKey))return json({error:'Atlassian groups need the organisation, directory and a customer admin API key'},400);
  try {
    const result=await withGrantLocks([`grant-team:${id}`],()=>changeBitbucketConnection({teamId:id,actorId:actor.id,settings:input},{sql:db,run:work=>transaction(db,work),adapter:owner=>accessAdapter('bitbucket',id,owner)}));
    if(!result.acquired)return json({error:'An access operation is in progress. Retry this connection change shortly.'},409);
    if(result.value.ok)return json({saved:true});
    const reason=result.value.reason;
    return json({error:reason==='forbidden'?'Team admin permission is required':reason==='active'?'Revoke managed Bitbucket group grants before changing adapters':'Old Bitbucket groups could not be removed. The old adapter was kept for retry.'},reason==='forbidden'?403:409);
  } catch {return json({error:'The connection change could not be confirmed. Check its current state before retrying.'},503);}
}

export const POST=auditedRoute(handlePOST,'teams.team.provider-connection.post');
