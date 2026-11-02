import 'server-only';
import {z} from 'zod';
import {database} from './db';
import {accessAdapter,repoRowSchema,refFor,providerAdmin} from './team-access';
import {resourceDigest} from './resource-digest';
import type {SqlExecutor} from './transactions';
export const auditPerson=z.object({repoId:z.string(),id:z.string().min(1).max(200),login:z.string().min(1).max(200),targets:z.array(z.string()).min(1).max(500).optional()});
export async function previewCollaborators(teamId:string,people:readonly z.infer<typeof auditPerson>[]){
 const db=database();if(!db)throw new Error('Team storage is unavailable');
 const repos=z.array(repoRowSchema).parse((await db.query('SELECT * FROM team_repos WHERE team_id=$1 AND approved AND removed_at IS NULL ORDER BY id',[teamId])).rows);
 const missing:{repoId:string;provider:string;host:string;id:string;login:string}[]=[];const seen=new Set<string>();let existing=0;
 for(const person of people){const origin=repos.find(repo=>repo.id===person.repoId);if(!origin||!await providerAdmin(origin))throw new Error('Provider admin permission is required');const original=await(await accessAdapter(origin.provider,teamId,origin.owner,undefined,origin.host)).user(refFor(origin),person.login);if(!original.ok||original.value.id!==person.id||original.value.organisationMember||original.value.permission==='none')throw new Error('The outside collaborator is no longer verified');
  for(const repo of repos.filter(repo=>repo.provider===origin.provider&&repo.host===origin.host&&(!person.targets||person.targets.includes(repo.id)))){const key=`${repo.id}:${person.id}`;if(seen.has(key))continue;seen.add(key);if(!await providerAdmin(repo))throw new Error('Verify every target repository permission first');const current=await(await accessAdapter(repo.provider,teamId,repo.owner,undefined,repo.host)).user(refFor(repo),person.login);if(!current.ok||current.value.id!==person.id)throw new Error('This collaborator could not be verified');const recorded=await db.query("SELECT id FROM grants WHERE team_id=$1 AND repo_id=$2 AND provider_user_id=$3 AND state<>'revoked'",[teamId,repo.id,person.id]);if(current.value.permission==='none'&&!recorded.rows.length)missing.push({repoId:repo.id,provider:repo.provider,host:repo.host,id:person.id,login:person.login});else existing++;}
 }
 missing.sort((a,b)=>`${a.repoId}:${a.id}`.localeCompare(`${b.repoId}:${b.id}`));return{missing,existing,confirmation:resourceDigest({teamId,missing,existing})};
}
export async function queueOutsideGrant(sql:SqlExecutor,teamId:string,actorId:string,person:{readonly repoId:string;readonly provider:string;readonly id:string;readonly login:string}):Promise<void>{
 const id=crypto.randomUUID();const created=await sql.query("INSERT INTO grants(id,team_id,repo_id,user_id,provider,provider_user_id,provider_login,mechanism,permission,previous_permission,source,actor_id) VALUES($1,$2,$3,NULL,$4,$5,$6,'collaborator','read','none','audit',$7) ON CONFLICT DO NOTHING RETURNING id",[id,teamId,person.repoId,person.provider,person.id,person.login,actorId]);if(created.rows.length)await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key) VALUES($1,$2,'grant',$3,$4)",[crypto.randomUUID(),teamId,id,`grant:${id}`]);
}
