import { connection } from 'next/server';
import { currentActor } from '@/lib/session';
import { database } from '@/lib/db';
import { json } from '@/lib/http';
export async function GET():Promise<Response>{await connection();const actor=await currentActor();if(!actor)return json({notifications:[]},401);const db=database();return json({notifications:db?(await db.query('SELECT id,team_id,kind,resource_id,created_at FROM notifications WHERE user_id=$1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 50',[actor.id])).rows:[]});}
