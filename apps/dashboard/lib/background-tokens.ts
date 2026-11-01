import 'server-only';
import { z } from 'zod';
import type { TokenSource } from '@geld/github';
import type { Provider } from '@geld/domain';
import { database } from './db';
import { getAuth } from './auth';
import { storedAppUserSource } from './repository-apps';
/** Server-only account selection. No request or headers are passed to Better Auth. */
export async function backgroundUserTokenSource(userId:string,provider:Provider,owner?:string):Promise<TokenSource>{
  if(provider==='github'){const app=await storedAppUserSource(userId,owner);if(app)return app;}
  const db=database();const auth=getAuth();if(!db||!auth)return{get:async()=>({status:'unavailable',message:'Background provider access is not configured'})};
  const row=z.object({id:z.string()}).safeParse((await db.query('SELECT id FROM identities WHERE "userId"=$1 AND "providerId"=ANY($2) ORDER BY CASE "providerId" WHEN \'github-repository\' THEN 0 WHEN \'github-oauth\' THEN 1 ELSE 2 END LIMIT 1',[userId,provider==='github'?['github-repository','github-oauth','github']:[provider]])).rows[0]);
  return{async get(options={}){if(!row.success)return{status:'signed-out',reason:'Reconnect provider access'};try{if(options.force)await auth.api.refreshToken({body:{accountId:row.data.id,userId}});const token=await auth.api.getAccessToken({body:{accountId:row.data.id,userId}});return token.accessToken?{status:'ok',token:token.accessToken,refreshed:options.force===true}:{status:'signed-out',reason:'Reconnect provider access'};}catch{return{status:'unavailable',message:'Reconnect provider access'};}}};
}
