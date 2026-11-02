import type { SqlExecutor } from './transactions';
export async function registerEnterpriseHost(sql:SqlExecutor,input:{readonly host:string;readonly teamId:string;readonly actorId:string;readonly channel:string|null;readonly encryptedSecret:string|null;readonly direct:boolean}):Promise<{readonly ok:true;readonly created:boolean}|{readonly ok:false;readonly reason:'forbidden'|'plan'|'owned'}> {
  const membership=await sql.query("SELECT m.user_id FROM team_members m WHERE m.team_id=$1 AND m.user_id=$2 AND m.role='admin' FOR SHARE",[input.teamId,input.actorId]);
  if(!membership.rows.length)return {ok:false,reason:'forbidden'};
  if(!(await sql.query("SELECT team_id FROM subscriptions WHERE team_id=$1 AND tier='enterprise' FOR SHARE",[input.teamId])).rows.length)return {ok:false,reason:'plan'};
  const inserted=await sql.query('INSERT INTO enterprise_hosts(host,team_id,relay_channel,encrypted_relay_secret,direct_allowed,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(host) DO NOTHING RETURNING host',[input.host,input.teamId,input.channel,input.encryptedSecret,input.direct,input.actorId]);
  await sql.query('SELECT host FROM enterprise_hosts WHERE host=$1 FOR UPDATE',[input.host]);
  const created=inserted.rows.length>0;
  if(!created&&!(await sql.query("SELECT t.host FROM enterprise_host_teams t JOIN team_members m ON m.team_id=t.team_id WHERE t.host=$1 AND m.user_id=$2 AND m.role='admin'",[input.host,input.actorId])).rows.length)return {ok:false,reason:'owned'};
  await sql.query('INSERT INTO enterprise_host_teams(host,team_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[input.host,input.teamId]);
  return {ok:true,created};
}
