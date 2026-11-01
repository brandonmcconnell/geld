import {auditedRoute} from '@/lib/request-audit';
import {connection} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/session';
import {database} from '@/lib/db';
import {encryptCredential} from '@/lib/crypto';
import {transaction} from '@/lib/transactions';
import {configured} from '@/lib/env';
import {json,sameOrigin} from '@/lib/http';
async function handlePOST(request:Request):Promise<Response>{
  await connection();if(!sameOrigin(request))return json({error:'Invalid request origin'},403);
  const actor=await currentActor();if(!actor)return json({error:'Sign in to pair your companion'},401);
  const input=z.object({id:z.string().uuid()}).safeParse(await request.json().catch(()=>null));if(!input.success)return json({error:'Choose a Claude connection'},400);
  const raw=configured(process.env.RELAY_PUBLIC_BROKER_URL);const broker=z.url().safeParse(raw);if(!broker.success||new URL(broker.data).protocol!=='https:'||new URL(broker.data).username||new URL(broker.data).password)return json({error:'Your deployment operator needs to configure a public HTTPS companion relay first'},503);
  const db=database();if(!db)return json({error:'Companion storage is unavailable'},503);
  const channel=crypto.randomUUID();const secret=crypto.randomUUID()+crypto.randomUUID();
  const paired=await transaction(db,async sql=>{
    const row=z.object({relay_channel:z.string().nullable(),settings:z.object({mode:z.string().optional()})}).safeParse((await sql.query("SELECT relay_channel,settings FROM ai_providers WHERE id=$1 AND user_id=$2 AND provider='claude' FOR UPDATE",[input.data.id,actor.id])).rows[0]);
    if(!row.success||row.data.settings.mode!=='login')return false;
    if(row.data.relay_channel)await sql.query('UPDATE relay_channels SET enabled=false WHERE id=$1 AND user_id=$2',[row.data.relay_channel,actor.id]);
    await sql.query("INSERT INTO relay_channels(id,kind,host,encrypted_secret,user_id) VALUES($1,'claude','claude.local.geld.invalid',$2,$3)",[channel,await encryptCredential(secret),actor.id]);
    await sql.query('UPDATE ai_providers SET relay_channel=$1 WHERE id=$2 AND user_id=$3',[channel,input.data.id,actor.id]);return true;
  });
  return paired?new Response(JSON.stringify({version:1,brokerUrl:broker.data,channel,secret,kind:'claude'}),{headers:{'content-type':'application/json','content-disposition':'attachment; filename="geld-companion.json"','cache-control':'no-store','x-content-type-options':'nosniff'}}):json({error:'Claude login connection not found'},404);
}

export const POST=auditedRoute(handlePOST,'companion.connect.post');
