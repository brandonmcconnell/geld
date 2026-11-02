import 'server-only';
import {z} from 'zod';
import {relayFetch} from '@geld/relay';
import type {RelayEndpoint} from '@geld/relay';
import {database} from './db';
import {decryptCredential} from './crypto';
import {configured} from './env';
export async function companionEndpoint(channel:string,userId:string):Promise<RelayEndpoint|null>{
 const db=database();const url=configured(process.env.RELAY_BROKER_URL);if(!db||!url)return null;
 const row=z.object({encrypted_secret:z.string()}).safeParse((await db.query("SELECT encrypted_secret FROM relay_channels WHERE id=$1 AND user_id=$2 AND kind='claude' AND enabled=true",[channel,userId])).rows[0]);
 const secret=row.success?await decryptCredential(row.data.encrypted_secret):null;
 return secret?{url,channel,secret,allowHttp:process.env.RELAY_ALLOW_HTTP==='true'}:null;
}
export function companionFetch(endpoint:RelayEndpoint){return relayFetch(endpoint,'claude.local.geld.invalid','claude');}
