import { z } from 'zod';
import { planFor, type Permission, type RepositoryRef } from '@geld/domain';
import { appendAudit } from './audit';
import { queueGrant, repoRowSchema, type TeamRepository } from './team-access';
import type { SqlExecutor } from './transactions';
const teamSchema=z.object({add_approval:z.boolean(),managed_access:z.boolean(),sync_enabled:z.boolean(),role:z.enum(['admin','member'])});
const tierSchema=z.object({tier:z.enum(['free','starter','team','business','enterprise'])});
export async function queueRepositorySync(sql:SqlExecutor,repo:TeamRepository,actorId:string):Promise<void> {
  if(!repo.approved||repo.removed_at)return;
  const enabled=await sql.query('SELECT id FROM teams WHERE id=$1 AND managed_access AND sync_enabled',[repo.team_id]);
  if(!enabled.rows.length)return;
  const members=z.array(z.object({user_id:z.string()})).parse((await sql.query('SELECT user_id FROM team_members WHERE team_id=$1 ORDER BY user_id',[repo.team_id])).rows);
  for(const member of members)await queueGrant(sql,repo,member.user_id,actorId,'sync');
}
export async function addTeamRepository(sql:SqlExecutor,input:{readonly teamId:string;readonly actorId:string;readonly ref:RepositoryRef;readonly externalId:string;readonly private:boolean;readonly permission:Permission}):Promise<{readonly ok:true;readonly repository:TeamRepository}|{readonly ok:false;readonly reason:'forbidden'|'free'|'limit'}> {
  const team=teamSchema.safeParse((await sql.query('SELECT t.add_approval,t.managed_access,t.sync_enabled,m.role FROM teams t JOIN team_members m ON m.team_id=t.id WHERE t.id=$1 AND m.user_id=$2 FOR UPDATE OF t',[input.teamId,input.actorId])).rows[0]);
  if(!team.success||input.permission==='none')return {ok:false,reason:'forbidden'};
  const tier=tierSchema.parse((await sql.query('SELECT tier FROM subscriptions WHERE team_id=$1 FOR UPDATE',[input.teamId])).rows[0]).tier;
  if(tier==='free'&&input.private&&input.permission!=='admin')return {ok:false,reason:'free'};
  const previous=repoRowSchema.safeParse((await sql.query('SELECT * FROM team_repos WHERE team_id=$1 AND provider=$2 AND host=$3 AND external_id=$4 FOR UPDATE',[input.teamId,input.ref.provider,input.ref.host,input.externalId])).rows[0]);
  if(!previous.success||previous.data.removed_at) {
    const max=planFor(tier).maxRepositories;
    const count=z.object({count:z.number()}).parse((await sql.query('SELECT count(*)::integer AS count FROM team_repos WHERE team_id=$1 AND removed_at IS NULL',[input.teamId])).rows[0]).count;
    if(max!==null&&count>=max)return {ok:false,reason:'limit'};
  }
  const approved=team.data.role==='admin'||!team.data.add_approval;
  const repo=repoRowSchema.parse((await sql.query('INSERT INTO team_repos(id,team_id,provider,host,external_id,owner,name,approved,added_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(team_id,provider,host,external_id) DO UPDATE SET approved=CASE WHEN team_repos.removed_at IS NOT NULL THEN EXCLUDED.approved ELSE team_repos.approved END,removed_at=NULL,owner=EXCLUDED.owner,name=EXCLUDED.name RETURNING *',[crypto.randomUUID(),input.teamId,input.ref.provider,input.ref.host,input.externalId,input.ref.owner,input.ref.repo,approved,input.actorId])).rows[0]);
  if(!repo.approved)await sql.query("INSERT INTO access_requests(id,team_id,repo_id,requester_id,kind) VALUES($1,$2,$3,$4,'add_repository') ON CONFLICT DO NOTHING",[crypto.randomUUID(),input.teamId,repo.id,input.actorId]);
  if(repo.approved&&(!previous.success||previous.data.removed_at||!previous.data.approved))await queueRepositorySync(sql,repo,input.actorId);
  await appendAudit(sql,{teamId:input.teamId,actorId:input.actorId,action:'repository.add',resourceType:'repository',resourceId:repo.id,outcome:repo.approved?'success':'pending'});
  return {ok:true,repository:repo};
}
export async function approveTeamRepository(sql:SqlExecutor,teamId:string,repoId:string,actorId:string):Promise<void> {
  const authority=await sql.query("SELECT t.id FROM teams t JOIN team_members m ON m.team_id=t.id WHERE t.id=$1 AND m.user_id=$2 AND m.role='admin' FOR UPDATE OF t",[teamId,actorId]);
  if(!authority.rows.length)throw new Error('Team authority changed');
  const updated=repoRowSchema.parse((await sql.query('UPDATE team_repos SET approved=true WHERE id=$1 AND team_id=$2 AND removed_at IS NULL RETURNING *',[repoId,teamId])).rows[0]);
  await queueRepositorySync(sql,updated,actorId);
}
