import { z } from 'zod';
import type { SqlExecutor } from './transactions';
export async function bindTrackerAuthorization(sql:SqlExecutor,input:{readonly teamId:string;readonly actorId:string;readonly provider:string;readonly version:string|number;readonly encryptedAccess:string;readonly encryptedRefresh:string|null;readonly expiresAt:Date|null;readonly cloudId:string|null}):Promise<boolean> {
  const current=z.object({provider:z.string(),config_version:z.union([z.string(),z.number()])}).safeParse((await sql.query('SELECT provider,config_version FROM tracker_connections WHERE team_id=$1 FOR UPDATE',[input.teamId])).rows[0]);
  if(!current.success||current.data.provider!==input.provider||String(current.data.config_version)!==String(input.version))return false;
  if(!(await sql.query("SELECT user_id FROM team_members WHERE team_id=$1 AND user_id=$2 AND role='admin'",[input.teamId,input.actorId])).rows.length)return false;
  const saved=await sql.query('UPDATE tracker_connections SET encrypted_credential=$3,encrypted_refresh=$4,expires_at=$5,settings=settings||$6::jsonb WHERE team_id=$1 AND provider=$2 AND config_version=$7 RETURNING team_id',[input.teamId,input.provider,input.encryptedAccess,input.encryptedRefresh,input.expiresAt,JSON.stringify({oauth:true,...(input.cloudId?{cloudId:input.cloudId}:{})}),input.version]);
  return saved.rows.length>0;
}
