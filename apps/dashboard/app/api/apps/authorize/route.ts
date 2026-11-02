import { connection } from 'next/server';
import { z } from 'zod';
import { createApiTransport } from '@geld/github';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { transaction } from '@/lib/transactions';
import { appendAudit } from '@/lib/audit';
import { resourceDigest } from '@/lib/resource-digest';
import { linkVerifiedInstallation } from '@/lib/app-migrations';
import { registrySchema,appTokenSource } from '@/lib/repository-apps';
import { encryptCredential,decryptCredential } from '@/lib/crypto';
import { dashboardOrigin } from '@/lib/env';
import { json } from '@/lib/http';
export async function GET(request:Request):Promise<Response>{await connection();const actor=await currentActor();const db=database();if(!actor||!db)return json({error:'Sign in to finish repository setup'},401);const url=new URL(request.url);const state=url.searchParams.get('state');const code=url.searchParams.get('code');if(!state||!code)return json({error:'Invalid authorization callback'},400);
  const flow=z.object({id:z.string(),team_id:z.string(),app_id:z.string(),settings:z.object({installationId:z.string()})}).safeParse((await db.query("UPDATE app_flows SET completed_at=now() WHERE state_digest=$1 AND actor_id=$2 AND kind='authorize' AND completed_at IS NULL AND expires_at>now() RETURNING *",[resourceDigest(state),actor.id])).rows[0]);if(!flow.success)return json({error:'This authorization expired'},409);
  const app=registrySchema.parse((await db.query('SELECT * FROM repository_apps WHERE id=$1',[flow.data.app_id])).rows[0]);const secret=await decryptCredential(app.encrypted_secret);if(!secret)return json({error:'App authorization is not configured'},503);
  const oauth=createApiTransport({baseUrl:'https://github.com/login/oauth/',source:{get:async()=>({status:'signed-out',reason:'App authorization'})},anonymousWrites:true});const exchanged=await oauth.request('access_token',{method:'POST',body:{client_id:app.client_id,client_secret:secret,code,redirect_uri:`${dashboardOrigin()}/api/apps/authorize`}});if(!exchanged.ok)return json({error:'GitHub did not confirm authorization'},409);
  const token=z.object({access_token:z.string(),refresh_token:z.string().optional(),expires_in:z.number().optional()}).safeParse(exchanged.value);if(!token.success)return json({error:'GitHub did not return repository access'},409);
  const userApi=createApiTransport({baseUrl:'https://api.github.com/',source:{get:async()=>({status:'ok',token:token.data.access_token,refreshed:false})}});const appApi=createApiTransport({baseUrl:'https://api.github.com/',source:await appTokenSource(app)});
  const installation=await appApi.request(`app/installations/${encodeURIComponent(flow.data.settings.installationId)}`);const viewer=await userApi.request('user');
  const installed=installation.ok?z.object({id:z.number(),app_id:z.number(),account:z.object({id:z.number(),login:z.string(),type:z.string()}),permissions:z.record(z.string(),z.string()),suspended_at:z.string().nullable()}).safeParse(installation.value):null;
  const profile=viewer.ok?z.object({id:z.number(),login:z.string()}).safeParse(viewer.value):null;
  if(!installed?.success||!profile?.success||String(installed.data.app_id)!==app.app_id||installed.data.suspended_at)return json({error:'The installation could not be verified. Existing access was kept.'},409);
  const account=installed.data.account;let admin=account.type==='User'&&profile.data.id===account.id;
  if(account.type==='Organization') {
    const available=await userApi.request(`user/installations/${installed.data.id}/repositories?per_page=100`);
    const repositories=available.ok?z.object({repositories:z.array(z.object({permissions:z.object({admin:z.boolean()}).optional()}))}).safeParse(available.value):null;
    admin=!!repositories?.success&&repositories.data.repositories.some(repo=>repo.permissions?.admin===true);
  }
  if(!admin)return json({error:'The installing account must administer this provider organisation or personal account'},403);
  if(Object.entries(app.permissions).some(([key,value])=>installed.data.permissions[key]!==value))return json({error:'Confirm the requested App permissions on GitHub first'},403);
  const team=flow.data.team_id;try{await transaction(db,async sql=>{const id=crypto.randomUUID();const linked=await linkVerifiedInstallation(sql,{id,externalId:String(installed.data.id),appId:app.app_id,fingerprint:app.fingerprint,registryId:app.id,owner:account.login,permissions:installed.data.permissions});if(!linked)throw new Error('Installation migration is in progress');const row={id:linked};await sql.query('INSERT INTO team_app_installations(team_id,installation_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[team,row.id]);await sql.query('INSERT INTO app_user_tokens(user_id,app_id,encrypted_access,encrypted_refresh,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,app_id) DO UPDATE SET encrypted_access=EXCLUDED.encrypted_access,encrypted_refresh=EXCLUDED.encrypted_refresh,expires_at=EXCLUDED.expires_at',[actor.id,app.id,await encryptCredential(token.data.access_token),token.data.refresh_token?await encryptCredential(token.data.refresh_token):null,token.data.expires_in?new Date(Date.now()+token.data.expires_in*1000):null]);await appendAudit(sql,{teamId:team,actorId:actor.id,action:'app.verify',resourceType:'installation',resourceId:row.id,outcome:'success',after:{fingerprint:app.fingerprint,account:account.login}});});
  }catch{return json({error:'The installation changed or is being migrated. Reload setup before reconnecting.'},409);}
  return Response.redirect(new URL(`/teams/${team}?installation=verified`,dashboardOrigin()));
}
