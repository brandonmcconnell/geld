import {connection} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/session';
import {database} from '@/lib/db';
import {json,sameOrigin} from '@/lib/http';
import {auditedRoute} from '@/lib/request-audit';
export async function GET():Promise<Response>{await connection();const actor=await currentActor();if(!actor)return json({connections:[]},401);const db=database();return json({connections:db?(await db.query('SELECT a.id,a.host,a.slug FROM app_user_tokens t JOIN repository_apps a ON a.id=t.app_id WHERE t.user_id=$1 ORDER BY a.host,a.slug',[actor.id])).rows:[]});}
async function remove(request:Request):Promise<Response>{await connection();if(!sameOrigin(request))return json({error:'Invalid request origin'},403);const actor=await currentActor();if(!actor)return json({error:'Sign in first'},401);const input=z.object({id:z.string().uuid()}).safeParse(await request.json().catch(()=>null));if(!input.success)return json({error:'Invalid connection'},400);const db=database();if(!db)return json({error:'Account storage is unavailable'},503);await db.query('DELETE FROM app_user_tokens WHERE user_id=$1 AND app_id=$2',[actor.id,input.data.id]);return json({removed:true});}
export const DELETE=auditedRoute(remove,'account.repository_disconnect');
