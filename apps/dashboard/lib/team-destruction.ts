import 'server-only';
import {billingGateway} from './billing-gateway';
import {operationSql,withTeamOperation} from './team-operation';
import {z} from 'zod';
import {database} from './db';
import {repoRowSchema,accessAdapter,refFor,processGrantUnlocked} from './team-access';
import {resourceDigest} from './resource-digest';
import {backgroundUserTokenSource} from './background-tokens';
import {contentStore} from './content-store';
const grant=z.object({id:z.string(),repo_id:z.string(),provider_login:z.string().nullable(),provider_grant_id:z.string(),state:z.string(),mechanism:z.string()});
export async function destructionPreview(teamId:string,actorId:string,background=false){
 const pool=database();const db=pool?operationSql(pool):null;if(!db)throw new Error('Team storage is unavailable');const grants=z.array(grant).parse((await db.query("SELECT id,repo_id,provider_login,provider_grant_id,state,mechanism FROM grants WHERE team_id=$1 AND state<>'revoked' AND provider_grant_id IS NOT NULL ORDER BY id",[teamId])).rows);const repos=z.array(repoRowSchema).parse((await db.query('SELECT * FROM team_repos WHERE team_id=$1',[teamId])).rows);
 const personal:{grantId:string;repository:string;login:string;ownership:'person'|'unknown'}[]=[];const unavailable:string[]=[];
 for(const repo of repos.filter(repo=>grants.some(grant=>grant.repo_id===repo.id&&grant.mechanism==='collaborator'))){try{const source=background?await backgroundUserTokenSource(actorId,repo.provider,repo.owner,repo.host):undefined;const r=await(await accessAdapter(repo.provider,teamId,repo.owner,source,repo.host)).repository(refFor(repo));if(!r.ok||r.value.permission!=='admin'){unavailable.push(repo.id);continue;}if(r.value.ownerKind!=='organisation')for(const g of grants.filter(g=>g.repo_id===repo.id&&g.mechanism==='collaborator'))personal.push({grantId:g.id,repository:`${repo.host}/${repo.owner}/${repo.name}`,login:g.provider_login??'Deleted account',ownership:r.value.ownerKind==='person'?'person':'unknown'});}catch{unavailable.push(repo.id);}}
 const groups=z.array(z.object({id:z.string(),external_id:z.string(),provider:z.enum(['github','gitlab','bitbucket']),slug:z.string(),host:z.string()})).parse((await db.query("SELECT pt.id,pt.external_id,pt.provider,o.slug,o.host FROM provider_teams pt JOIN provider_orgs o ON o.id=pt.org_id WHERE pt.team_id=$1 AND pt.state<>'deleted' ORDER BY pt.id",[teamId])).rows);
 const deleting=(await db.query('SELECT id FROM teams WHERE id=$1 AND deleting_at IS NOT NULL',[teamId])).rows.length>0;
 return{deleting,grants,groups,personal,unavailable,confirmation:resourceDigest({teamId,grants,groups,personal,unavailable})};
}
export const destroyPayload=z.object({actorId:z.string(),skip:z.array(z.string())});
async function finishUnlocked(teamId:string,payload:unknown):Promise<boolean>{
 const input=destroyPayload.parse(payload);const pool=database();const db=pool?operationSql(pool):null;if(!db)return false;const allowed=await db.query("SELECT t.id FROM teams t JOIN team_members m ON m.team_id=t.id WHERE t.id=$1 AND t.deleting_at IS NOT NULL AND m.user_id=$2 AND m.role='admin'",[teamId,input.actorId]);let actorId=input.actorId;if(!allowed.rows.length){const next=z.object({user_id:z.string()}).safeParse((await db.query("SELECT m.user_id FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.team_id=$1 AND t.deleting_at IS NOT NULL AND m.role='admin' ORDER BY m.created_at LIMIT 1",[teamId])).rows[0]);if(!next.success)return false;actorId=next.data.user_id;}
 const rows=z.array(z.object({id:z.string()})).parse((await db.query("SELECT id FROM grants WHERE team_id=$1 AND state<>'revoked' AND provider_grant_id IS NOT NULL AND NOT(id=ANY($2::text[]))",[teamId,input.skip])).rows);
 let progress=0;for(const row of rows.slice(0,10)){await db.query("UPDATE grants SET state='revoking' WHERE id=$1",[row.id]);try{if(await processGrantUnlocked(row.id,actorId,true))progress++;}catch{/* Keep the ledger and retry. */}}
 const remaining=await db.query("SELECT id FROM grants WHERE team_id=$1 AND state<>'revoked' AND provider_grant_id IS NOT NULL AND NOT(id=ANY($2::text[])) LIMIT 1",[teamId,input.skip]);if(remaining.rows.length){if(progress>0)await db.query("UPDATE outbox_jobs SET attempts=GREATEST(0,attempts-1) WHERE team_id=$1 AND kind='destroy_team'",[teamId]);return false;}
 const groups=z.array(z.object({id:z.string(),external_id:z.string(),provider:z.enum(['github','gitlab','bitbucket']),slug:z.string(),host:z.string()})).parse((await db.query("SELECT pt.id,pt.external_id,pt.provider,o.slug,o.host FROM provider_teams pt JOIN provider_orgs o ON o.id=pt.org_id WHERE pt.team_id=$1 AND pt.state<>'deleted'",[teamId])).rows);
 for(const group of groups){const source=await backgroundUserTokenSource(actorId,group.provider,group.slug,group.host);const result=await(await accessAdapter(group.provider,teamId,group.slug,source,group.host)).deleteGroup(group.slug,group.external_id);if(!result.ok&&result.reason!=='not_found')return false;await db.query("UPDATE provider_teams SET state='deleted' WHERE id=$1",[group.id]);}
 const subscription=z.object({stripe_subscription_id:z.string().nullable()}).safeParse((await db.query('SELECT stripe_subscription_id FROM subscriptions WHERE team_id=$1',[teamId])).rows[0]);if(subscription.success&&subscription.data.stripe_subscription_id){const gateway=billingGateway();if(!gateway)return false;await gateway.cancelSubscription(subscription.data.stripe_subscription_id,`destroy:${teamId}`);}
 await contentStore().deleteTeam(teamId);await db.query('DELETE FROM "ssoProvider" WHERE "providerId" IN(SELECT provider_id FROM team_sso_providers WHERE team_id=$1)',[teamId]);await db.query('DELETE FROM teams WHERE id=$1',[teamId]);return true;
}

export async function finishTeamDestruction(teamId:string,payload:unknown):Promise<boolean>{const pool=database();const db=pool?operationSql(pool):null;if(!db)return false;if(!(await db.query('SELECT id FROM teams WHERE id=$1',[teamId])).rows.length)return true;const result=await withTeamOperation(teamId,()=>finishUnlocked(teamId,payload));return result.ok&&result.value;}
