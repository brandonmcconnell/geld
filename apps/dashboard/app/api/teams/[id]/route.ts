import {auditedRoute} from '@/lib/request-audit';
import {destructionPreview,prepareTeamDestruction,finishTeamDestruction} from '@/lib/team-destruction';
import { connection } from 'next/server';
import { z } from 'zod';
import { registeredEnterpriseHost } from '@/lib/enterprise';
import { repositoryPath, resourceSchema } from '@geld/domain';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { transaction } from '@/lib/transactions';
import { appendAudit } from '@/lib/audit';
import { teamMembership, listTeams } from '@/lib/workspaces';
import { accessAdapter, providerAdmin, repoRowSchema, refFor, queueGrant, processGrant, providerApprovers } from '@/lib/team-access';
import { json, sameOrigin } from '@/lib/http';
import { claimAccessJobs,finishAccessJob } from '@/lib/access-jobs';
import { addTeamRepository, approveTeamRepository } from '@/lib/team-repositories';
import { resourceDigest } from '@/lib/resource-digest';
const inputSchema = z.discriminatedUnion('action',[
  z.object({action:z.literal('settings'),managed:z.boolean(),sync:z.boolean(),approval:z.boolean(),visibility:z.enum(['names','request','count','none']),confirmation:z.string().optional(),outside:z.array(z.string()).default([])}),
  z.object({action:z.literal('add'),ref:resourceSchema}),z.object({action:z.literal('remove_repository'),repoId:z.string()}),
  z.object({action:z.literal('invite'),email:z.email()}),z.object({action:z.literal('remove_member'),userId:z.string()}),
  z.object({action:z.literal('request_access'),repoId:z.string()}),z.object({action:z.literal('decide'),requestId:z.string(),approve:z.boolean()}),
  z.object({action:z.literal('withdraw'),grantId:z.string()}),z.object({action:z.literal('run_jobs')}),
  z.object({action:z.literal('accept_invite')}),z.object({action:z.literal('destroy'),confirmation:z.string(),personal:z.enum(['remove','skip']),preview:z.string()}),
]);
const memberSchema=z.object({id:z.string(),name:z.string(),role:z.enum(['admin','member'])});
async function preview(teamId:string) {
  const db=database();if(!db)throw new Error('Database required');
  const repos=z.array(repoRowSchema).parse((await db.query('SELECT * FROM team_repos WHERE team_id=$1 AND removed_at IS NULL AND approved',[teamId])).rows);
  const links=z.array(z.object({user_id:z.string(),provider:z.enum(['github','gitlab','bitbucket']),host:z.string(),login:z.string()})).parse((await db.query('SELECT l.* FROM provider_user_links l JOIN team_members m ON m.user_id=l.user_id WHERE m.team_id=$1',[teamId])).rows);
  const missing:{userId:string;repoId:string;login:string;outside:boolean}[]=[];const unavailable:string[]=[];
  for(const repo of repos) {const adapter=await accessAdapter(repo.provider,teamId,repo.owner,undefined,repo.host); if(!await providerAdmin(repo)){unavailable.push(repo.id);continue;}for(const link of links.filter(l=>l.provider===repo.provider&&l.host===repo.host)){const u=await adapter.user(refFor(repo),link.login);if(!u.ok){unavailable.push(`${repo.id}:${link.user_id}`);continue;}if(u.value.permission==='none')missing.push({userId:link.user_id,repoId:repo.id,login:link.login,outside:!u.value.organisationMember});}}
  const confirmation=resourceDigest({teamId,missing,unavailable});return{missing,unavailable,confirmation,repositoryCount:repos.length};
}
export async function GET(request:Request,{params}:{readonly params:Promise<{id:string}>}):Promise<Response>{
  await connection();const actor=await currentActor();if(!actor)return json({error:'Sign in to see this team'},401);const{id}=await params;const db=database();if(!db)return json({error:'Team storage is not configured'},503);
  try{
    if(!await teamMembership(actor.id,id))return json({error:'This team is not available'},404);
    const team=(await listTeams(actor.id)).find(t=>t.id===id);if(!team)return json({error:'Team not found'},404);
    if(new URL(request.url).searchParams.get('preview')==='sync'){if(team.role!=='admin')return json({error:'Only team admins can preview sync'},403);return json(await preview(id));}
    if(new URL(request.url).searchParams.get('preview')==='destroy'){if(team.role!=='admin')return json({error:'Team admin permission is required'},403);return json(await destructionPreview(id,actor.id));}
    await db.query("UPDATE access_requests SET state='expired' WHERE team_id=$1 AND state='pending' AND expires_at<=now()",[id]);
    const repos=z.array(repoRowSchema).parse((await db.query('SELECT * FROM team_repos WHERE team_id=$1 AND removed_at IS NULL ORDER BY owner,name',[id])).rows);
    const visible=[];const providerAdmins:string[]=[];let hiddenCount=0;
    for(const repo of repos){const r=await(await accessAdapter(repo.provider,id,repo.owner,undefined,repo.host)).repository(refFor(repo));if(r.ok&&r.value.permission==='admin')providerAdmins.push(repo.id);if(r.ok&&r.value.permission!=='none')visible.push({...repo,accessible:true,url:repositoryPath(refFor(repo)),permission:r.value.permission});else{hiddenCount++;if(team.visibility==='names'||team.visibility==='request')visible.push({id:repo.id,owner:repo.owner,name:repo.name,provider:repo.provider,accessible:false,canRequest:team.managed_access&&team.visibility==='request',url:`https://${repo.host}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`});}}
    const members=z.array(memberSchema).parse((await db.query('SELECT u.id,u.name,m.role FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY u.name',[id])).rows);
    const requests=team.role==='admin'?(await db.query('SELECT id,repo_id,requester_id,kind,state,expires_at FROM access_requests WHERE team_id=$1 ORDER BY created_at DESC LIMIT 100',[id])).rows:(await db.query("SELECT id,repo_id,requester_id,kind,state,expires_at FROM access_requests WHERE team_id=$1 AND(requester_id=$2 OR(kind='repository_access' AND repo_id=ANY($3::text[]))) ORDER BY created_at DESC LIMIT 100",[id,actor.id,providerAdmins])).rows;
    const grants=team.role==='admin'?(await db.query('SELECT id,user_id,repo_id,mechanism,permission,previous_permission,source,state,created_at FROM grants WHERE team_id=$1 ORDER BY created_at DESC LIMIT 100',[id])).rows:[];
    return json({team,repositories:visible,hiddenCount:team.visibility==='count'?hiddenCount:null,members,requests:z.array(z.object({id:z.string(),repo_id:z.string().nullable(),requester_id:z.string(),kind:z.string(),state:z.string(),expires_at:z.date()})).parse(requests).map(row=>({...row,canDecide:row.kind==='add_repository'?team.role==='admin':!!row.repo_id&&providerAdmins.includes(row.repo_id)})),grants,jobs:team.role==='admin'?(await db.query('SELECT id,kind,state,attempts FROM outbox_jobs WHERE team_id=$1 ORDER BY created_at DESC LIMIT 50',[id])).rows:[]});
  }catch{return json({error:'This team could not be loaded'},503);}
}
async function handlePOST(request:Request,{params}:{readonly params:Promise<{id:string}>}):Promise<Response>{
  await connection();if(!sameOrigin(request))return json({error:'Invalid request origin'},403);const actor=await currentActor();if(!actor)return json({error:'Sign in first'},401);const{id}=await params;const db=database();if(!db)return json({error:'Team storage is not configured'},503);
  const parsed=inputSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return json({error:'Invalid team action'},400);const input=parsed.data;
  try{
    if(input.action==='accept_invite'){
      const accepted=await transaction(db,async sql=>{await sql.query('SELECT team_id FROM subscriptions WHERE team_id=$1 FOR UPDATE',[id]);const tier=z.object({tier:z.enum(['free','starter','team','business','enterprise'])}).parse((await sql.query('SELECT tier FROM subscriptions WHERE team_id=$1',[id])).rows[0]);if(tier.tier==='free')return false;const invite=await sql.query("UPDATE team_invites SET state='accepted' WHERE team_id=$1 AND invited_user_id=$2 AND state='pending' AND expires_at>now() RETURNING id",[id,actor.id]);if(!invite.rows.length)return false;await sql.query("INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING",[id,actor.id]);await sql.query('UPDATE subscriptions SET seats=(SELECT count(*) FROM team_members WHERE team_id=$1) WHERE team_id=$1',[id]);await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES($1,$2,'sync_seats',$2,$3)",[crypto.randomUUID(),id,`seats:${id}:${crypto.randomUUID()}`]);await appendAudit(sql,{teamId:id,actorId:actor.id,action:'member.join',resourceType:'team',resourceId:id,outcome:'success'});const team=z.object({sync_enabled:z.boolean()}).parse((await sql.query('SELECT sync_enabled FROM teams WHERE id=$1',[id])).rows[0]);if(team.sync_enabled)for(const repo of z.array(repoRowSchema).parse((await sql.query('SELECT * FROM team_repos WHERE team_id=$1 AND approved AND removed_at IS NULL',[id])).rows))await queueGrant(sql,repo,actor.id,actor.id,'sync');return true;});return accepted?json({saved:true}):json({error:'This invitation expired or the team needs a paid plan'},409);
    }
    if(!await teamMembership(actor.id,id))return json({error:'Team not found'},404);
    const team=(await listTeams(actor.id)).find(t=>t.id===id);if(!team)return json({error:'Team not found'},404);
    const admin=team.role==='admin';
    if(!['run_jobs','destroy'].includes(input.action)&&(await db.query('SELECT id FROM teams WHERE id=$1 AND deleting_at IS NOT NULL',[id])).rows.length)return json({error:'Team deletion is in progress. Existing provider cleanup must finish first.'},409);
    if(['settings','invite','remove_member','remove_repository','destroy'].includes(input.action)&&!admin)return json({error:'Only team admins can change team membership or settings'},403);
    const audit=async(action:string,resourceId:string,outcome:'success'|'pending'='success')=>transaction(db,sql=>appendAudit(sql,{teamId:id,actorId:actor.id,action,resourceType:'team',resourceId,outcome}));
    if(input.action==='add'){
      if(input.ref.host!==({github:'github.com',gitlab:'gitlab.com',bitbucket:'bitbucket.org'})[input.ref.provider]&&!(input.ref.provider==='github'&&await registeredEnterpriseHost(input.ref.host,actor.id)))return json({error:'Register this Enterprise host first'},400);
      const r=await(await accessAdapter(input.ref.provider,id,input.ref.owner,undefined,input.ref.host)).repository(input.ref);if(!r.ok||r.value.permission==='none')return json({error:'Your own provider account must have repository access'},403);
      const result=await transaction(db,sql=>addTeamRepository(sql,{teamId:id,actorId:actor.id,ref:input.ref,externalId:r.value.id,private:r.value.private,permission:r.value.permission}));
      if(!result.ok)return json({error:result.reason==='limit'?'This team has reached its repository limit':result.reason==='free'?'Free supports public repositories and your own repositories':'Team membership or provider access changed'},result.reason==='forbidden'?403:402);
      return json({saved:true,pending:!result.repository.approved});
    }
    if(input.action==='settings'){
      let changes:Awaited<ReturnType<typeof preview>>['missing']=[];
      if(!input.managed){const active=await db.query("SELECT id FROM grants WHERE team_id=$1 AND state<>'revoked' AND provider_grant_id IS NOT NULL LIMIT 1",[id]);if(active.rows.length)return json({error:'Revoke every Geld grant before disabling managed access'},409);}
      if(input.sync&&!input.managed)return json({error:'Sync requires Geld-managed access'},400);
      if(input.sync&&!team.sync_enabled){const p=await preview(id);if(p.unavailable.length)return json({error:'Confirm repository App permissions on the provider before enabling sync'},403);if(input.confirmation!==p.confirmation)return json({error:'Review the current sync preview before confirming'},409);changes=p.missing;}
      await transaction(db,async sql=>{for(const change of changes){if(change.outside&&!input.outside.includes(`${change.repoId}:${change.userId}`))continue;const repo=repoRowSchema.parse((await sql.query('SELECT * FROM team_repos WHERE id=$1',[change.repoId])).rows[0]);await queueGrant(sql,repo,change.userId,actor.id,change.outside?'audit':'sync');}await sql.query('UPDATE teams SET managed_access=$2,sync_enabled=$3,add_approval=$4,visibility=$5 WHERE id=$1',[id,input.managed,input.sync,input.approval,input.visibility]);await appendAudit(sql,{teamId:id,actorId:actor.id,action:'team.settings',resourceType:'team',resourceId:id,outcome:'success',before:{managed:team.managed_access,sync:team.sync_enabled,visibility:team.visibility},after:{managed:input.managed,sync:input.sync,visibility:input.visibility,approval:input.approval}});});return json({saved:true});
    }
    if(input.action==='invite'){
      if(team.tier==='free')return json({error:'Upgrade before adding a second member'},402);const u=z.object({id:z.string()}).safeParse((await db.query('SELECT id FROM users WHERE lower(email)=lower($1)',[input.email])).rows[0]);if(!u.success)return json({error:'Ask this person to create a Geld account first'},404);
      await transaction(db,async sql=>{await sql.query("INSERT INTO team_invites(id,team_id,invited_user_id,invited_by) VALUES($1,$2,$3,$4) ON CONFLICT(team_id,invited_user_id) DO UPDATE SET state='pending',expires_at=now()+interval '14 days'",[crypto.randomUUID(),id,u.data.id,actor.id]);await sql.query("INSERT INTO notifications(id,user_id,team_id,kind,resource_id) VALUES($1,$2,$3,'team_invite',$3)",[crypto.randomUUID(),u.data.id,id]);await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES($1,$2,'email_invite',$3,$4)",[crypto.randomUUID(),id,u.data.id,`invite:${id}:${u.data.id}:${crypto.randomUUID()}`]);await appendAudit(sql,{teamId:id,actorId:actor.id,action:'member.invite',resourceType:'user',resourceId:u.data.id,outcome:'pending'});});return json({saved:true});
    }
    if(input.action==='remove_member'){
      if(input.userId===actor.id)return json({error:'Another admin must remove your membership'},409);
      await transaction(db,async sql=>{await sql.query('DELETE FROM team_members WHERE team_id=$1 AND user_id=$2',[id,input.userId]);const grants=z.array(z.object({id:z.string()})).parse((await sql.query("UPDATE grants SET state='revoking' WHERE team_id=$1 AND user_id=$2 AND state IN('active','pending') RETURNING id",[id,input.userId])).rows);for(const g of grants)await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES($1,$2,'revoke',$3,$4) ON CONFLICT DO NOTHING",[crypto.randomUUID(),id,g.id,`revoke:${g.id}`]);await sql.query('UPDATE subscriptions SET seats=GREATEST(1,(SELECT count(*) FROM team_members WHERE team_id=$1)) WHERE team_id=$1',[id]);await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES($1,$2,'sync_seats',$2,$3)",[crypto.randomUUID(),id,`seats:${id}:${crypto.randomUUID()}`]);await appendAudit(sql,{teamId:id,actorId:actor.id,action:'member.remove',resourceType:'user',resourceId:input.userId,outcome:'pending'});});return json({saved:true,pending:true});
    }
    if(input.action==='remove_repository'){await db.query('UPDATE team_repos SET removed_at=now() WHERE id=$1 AND team_id=$2',[input.repoId,id]);await audit('repository.remove',input.repoId);return json({saved:true});}
    if(input.action==='request_access'){
      const repo=repoRowSchema.parse((await db.query('SELECT * FROM team_repos WHERE id=$1 AND team_id=$2 AND approved AND removed_at IS NULL',[input.repoId,id])).rows[0]);
      if(!team.managed_access)return json({error:'Request repository access on the provider',url:`https://${repo.host}/${repo.owner}/${repo.name}`},409);
      if(!['team','business','enterprise'].includes(team.tier))return json({error:'Self-serve access needs Team or above'},402);
      const approvers=await providerApprovers(repo);const requestId=crypto.randomUUID();await transaction(db,async sql=>{await sql.query("INSERT INTO access_requests(id,team_id,repo_id,requester_id,kind) VALUES($1,$2,$3,$4,'repository_access') ON CONFLICT DO NOTHING",[requestId,id,repo.id,actor.id]);await sql.query("INSERT INTO notifications(id,user_id,team_id,kind,resource_id) SELECT gen_random_uuid()::text,user_id,$1,'access_request',$2 FROM team_members WHERE team_id=$1 AND(role='admin' OR user_id=ANY($3::text[]))",[id,requestId,approvers]);await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES($1,$2,'email_access',$3,$4) ON CONFLICT DO NOTHING",[crypto.randomUUID(),id,requestId,`access-email:${requestId}`]);await appendAudit(sql,{teamId:id,actorId:actor.id,action:'access.request',resourceType:'repository',resourceId:repo.id,outcome:'pending'});});return json({saved:true,pending:true});
    }
    if(input.action==='decide'){
      const req=z.object({repo_id:z.string(),requester_id:z.string(),kind:z.enum(['repository_access','add_repository'])}).safeParse((await db.query("SELECT * FROM access_requests WHERE id=$1 AND team_id=$2 AND state='pending' AND expires_at>now()",[input.requestId,id])).rows[0]);if(!req.success)return json({error:'This request is no longer pending'},409);
      const repo=repoRowSchema.parse((await db.query('SELECT * FROM team_repos WHERE id=$1',[req.data.repo_id])).rows[0]);
      if(req.data.kind==='add_repository'?!admin:!await providerAdmin(repo))return json({error:'Approval needs the matching provider permission'},403);
      await transaction(db,async sql=>{await sql.query('SELECT id FROM teams WHERE id=$1 FOR UPDATE',[id]);const updated=await sql.query("UPDATE access_requests SET state=$2,approver_id=$3 WHERE id=$1 AND state='pending' AND expires_at>now() RETURNING id",[input.requestId,input.approve?'approved':'denied',actor.id]);if(!updated.rows.length)return;if(input.approve){if(req.data.kind==='add_repository')await approveTeamRepository(sql,id,repo.id,actor.id);else await queueGrant(sql,repo,req.data.requester_id,actor.id,'request_access');}await appendAudit(sql,{teamId:id,actorId:actor.id,action:input.approve?'request.approve':'request.deny',resourceType:'request',resourceId:input.requestId,outcome:'success'});});return json({saved:true});
    }
    if(input.action==='withdraw'){
      const g=z.object({repo_id:z.string()}).safeParse((await db.query("SELECT repo_id FROM grants WHERE id=$1 AND team_id=$2 AND state IN('active','pending')",[input.grantId,id])).rows[0]);if(!g.success)return json({error:'Grant not found'},404);const repo=repoRowSchema.parse((await db.query('SELECT * FROM team_repos WHERE id=$1',[g.data.repo_id])).rows[0]);if(!await providerAdmin(repo))return json({error:'Provider access management permission is required'},403);await db.query("UPDATE grants SET state='revoking' WHERE id=$1",[input.grantId]);await db.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES($1,$2,'revoke',$3,$4) ON CONFLICT DO NOTHING",[crypto.randomUUID(),id,input.grantId,`revoke:${input.grantId}`]);await audit('access.withdraw',input.grantId,'pending');return json({saved:true,pending:true});
    }
    if(input.action==='run_jobs'){
      const jobs=await claimAccessJobs(db,id);let completed=0;
      for(const job of jobs){let ok=false;try{ok=job.kind==='destroy_team'?await finishTeamDestruction(id,job.payload):await processGrant(job.resource_id,actor.id);}catch{}const owned=await finishAccessJob(db,job,ok);if(ok&&(owned||job.kind==='destroy_team'))completed++;}return json({saved:true,completed,pending:jobs.length-completed});
    }
    if(input.action==='destroy'){
      if((await db.query('SELECT id FROM teams WHERE id=$1 AND deleting_at IS NOT NULL',[id])).rows.length)return json({error:'Deletion is already queued. Retry provider cleanup to continue.'},409);
      if(input.confirmation!==team.name)return json({error:'Type the team name to confirm'},400);
      const prepared=await prepareTeamDestruction({teamId:id,actorId:actor.id,confirmation:input.preview,personal:input.personal});
      if(!prepared.ok)return json({error:prepared.reason==='busy'?'An access update is finishing. Refresh the deletion preview shortly.':'Provider access changed or could not be verified. Refresh the deletion preview.'},409);
      return json({saved:true,deleting:true,skipped:prepared.skipped});
    }
    return json({error:'Unsupported team action'},400);
  }catch{return json({error:'This team action could not be completed. Check its current state before retrying.'},503);}
}

export const POST=auditedRoute(handlePOST,'teams.team.post');
