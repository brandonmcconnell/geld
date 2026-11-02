import { connection } from 'next/server';
import { z } from 'zod';
import { createApiTransport } from '@geld/github';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { appOwner,appOptionsSchema,manifestFor } from '@/lib/repository-apps';
import { resourceDigest } from '@/lib/resource-digest';
import { encryptCredential } from '@/lib/crypto';
import { dashboardOrigin } from '@/lib/env';
import { json } from '@/lib/http';
export async function GET(request:Request):Promise<Response>{await connection();const actor=await currentActor();if(!actor||!appOwner(actor.id))return json({error:'Owner confirmation is required'},403);const db=database();if(!db)return json({error:'App storage is unavailable'},503);const url=new URL(request.url);const code=url.searchParams.get('code');const state=url.searchParams.get('state');if(!code||!state)return json({error:'Invalid App callback'},400);
  const flow=z.object({id:z.string(),team_id:z.string(),settings:appOptionsSchema}).safeParse((await db.query("UPDATE app_flows SET completed_at=now() WHERE state_digest=$1 AND actor_id=$2 AND kind='manifest' AND completed_at IS NULL AND expires_at>now() RETURNING *",[resourceDigest(state),actor.id])).rows[0]);if(!flow.success)return json({error:'This confirmation expired or was already used'},409);
  const api=createApiTransport({baseUrl:'https://api.github.com/',source:{get:async()=>({status:'signed-out',reason:'Manifest conversion'})},anonymousWrites:true});const result=await api.request(`app-manifests/${encodeURIComponent(code)}/conversions`,{method:'POST'});if(!result.ok)return json({error:'GitHub did not confirm this manifest'},409);
  const app=z.object({id:z.number(),slug:z.string(),client_id:z.string(),client_secret:z.string(),pem:z.string(),webhook_secret:z.string(),permissions:z.record(z.string(),z.string())}).safeParse(result.value);if(!app.success)return json({error:'The App credentials could not be verified'},409);
  const {fingerprint,manifest}=manifestFor(flow.data.settings);if(JSON.stringify(Object.entries(app.data.permissions).filter(([key])=>key!=='metadata').sort())!==JSON.stringify(Object.entries(manifest.default_permissions).filter(([key])=>key!=='metadata').sort()))return json({error:'The returned permission set does not match the requested App'},409);
  await db.query('INSERT INTO repository_apps(id,fingerprint,permissions,app_id,slug,client_id,encrypted_secret,encrypted_private_key,encrypted_webhook_secret,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[crypto.randomUUID(),fingerprint,JSON.stringify(manifest.default_permissions),String(app.data.id),app.data.slug,app.data.client_id,await encryptCredential(app.data.client_secret),await encryptCredential(app.data.pem),await encryptCredential(app.data.webhook_secret),actor.id]);
  return Response.redirect(new URL(`/teams/${flow.data.team_id}`,dashboardOrigin()));
}
