import { z } from 'zod';
import type { ManagedAccessAdapter } from '@geld/providers';
import type { SqlExecutor } from './transactions';
import { encryptCredential } from './crypto';
import { appendAudit } from './audit';
export const bitbucketConnectionSchema=z.object({path:z.enum(['legacy_groups','atlassian_groups','direct_users']),organisationId:z.string().max(100).optional(),directoryId:z.string().max(100).optional(),adminKey:z.string().min(10).max(10000).optional()});
export async function changeBitbucketConnection(input:{readonly teamId:string;readonly actorId:string;readonly settings:z.infer<typeof bitbucketConnectionSchema>},dependencies:{readonly sql:SqlExecutor;readonly run:<T>(work:(sql:SqlExecutor)=>Promise<T>)=>Promise<T>;readonly adapter:(owner:string)=>Promise<Pick<ManagedAccessAdapter,'deleteGroup'>>}):Promise<{readonly ok:true}|{readonly ok:false;readonly reason:'forbidden'|'active'|'cleanup'}> {
  const db=dependencies.sql;
  if(!(await db.query("SELECT user_id FROM team_members WHERE team_id=$1 AND user_id=$2 AND role='admin'",[input.teamId,input.actorId])).rows.length)return {ok:false,reason:'forbidden'};
  const old=z.object({settings:bitbucketConnectionSchema.omit({adminKey:true}),encrypted_credential:z.string().nullable()}).safeParse((await db.query("SELECT settings,encrypted_credential FROM provider_connections WHERE team_id=$1 AND provider='bitbucket' AND host='bitbucket.org'",[input.teamId])).rows[0]);
  const settings={path:input.settings.path,organisationId:input.settings.organisationId,directoryId:input.settings.directoryId};
  const changed=!old.success||old.data.settings.path!==settings.path||old.data.settings.organisationId!==settings.organisationId||old.data.settings.directoryId!==settings.directoryId;
  if(changed) {
    const active=await db.query("SELECT id FROM grants WHERE team_id=$1 AND provider='bitbucket' AND provider_group_id IS NOT NULL AND state<>'revoked' LIMIT 1",[input.teamId]);
    if(active.rows.length)return {ok:false,reason:'active'};
    const groups=z.array(z.object({id:z.string(),external_id:z.string(),slug:z.string()})).parse((await db.query("SELECT pt.id,pt.external_id,o.slug FROM provider_teams pt JOIN provider_orgs o ON o.id=pt.org_id WHERE pt.team_id=$1 AND pt.provider='bitbucket' AND o.host='bitbucket.org' AND pt.state<>'deleted' ORDER BY pt.id",[input.teamId])).rows);
    for(const group of groups) {
      const removed=await(await dependencies.adapter(group.slug)).deleteGroup(group.slug,group.external_id);
      if(!removed.ok&&removed.reason!=='not_found')return {ok:false,reason:'cleanup'};
      await db.query("UPDATE provider_teams SET state='deleted' WHERE id=$1",[group.id]);
    }
  }
  const encrypted=settings.path==='atlassian_groups'?(input.settings.adminKey?await encryptCredential(input.settings.adminKey):!changed&&old.success?old.data.encrypted_credential:null):null;
  await dependencies.run(async sql=>{
    await sql.query("INSERT INTO provider_connections(team_id,provider,host,settings,encrypted_credential) VALUES($1,'bitbucket','bitbucket.org',$2,$3) ON CONFLICT(team_id,provider,host) DO UPDATE SET settings=EXCLUDED.settings,encrypted_credential=EXCLUDED.encrypted_credential",[input.teamId,JSON.stringify(settings),encrypted]);
    await appendAudit(sql,{teamId:input.teamId,actorId:input.actorId,action:'provider.connection',resourceType:'connection',resourceId:'bitbucket',outcome:'success',after:{path:settings.path,credential:!!encrypted}});
  });
  return {ok:true};
}
