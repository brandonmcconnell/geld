import { connection } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { configured } from '@/lib/env';
import { drainOutbox } from '@/lib/outbox';
import { json } from '@/lib/http';
export const maxDuration=300;
export async function GET(request:Request):Promise<Response>{await connection();const secret=configured(process.env.CRON_SECRET);const provided=request.headers.get('authorization');const expected=`Bearer ${secret}`;if(!secret||!provided||Buffer.byteLength(provided)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))return json({error:'Job authorization is required'},401);try{return json(await drainOutbox());}catch{return json({error:'Jobs are temporarily unavailable'},503);}}
