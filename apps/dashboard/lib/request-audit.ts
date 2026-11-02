import 'server-only';
import {z} from 'zod';
import {currentActor} from './session';
import {database} from './db';
import {transaction} from './transactions';
import {appendAudit} from './audit';
/** A structural receipt complements the richer resource-specific records. No request body or URL is logged. */
export function auditedRoute<T extends unknown[]>(handler:(request:Request,...rest:T)=>Promise<Response>,action:string):(request:Request,...rest:T)=>Promise<Response>{
 return async(request,...rest)=>{
  const actor=await currentActor();const db=database();const team=/^\/api\/teams\/([^/]+)/.exec(new URL(request.url).pathname)?.[1]??null;
  const scopes=actor&&db?z.array(z.object({team_id:z.string()})).parse((await db.query('SELECT m.team_id FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.user_id=$1 AND(t.personal_owner_id=$1 OR m.team_id=$2)',[actor.id,team])).rows):[];
  let response:Response;
  try{response=await handler(request,...rest);}catch{response=Response.json({error:'This request could not be completed. Check its current state before retrying.'},{status:503,headers:{'cache-control':'no-store'}});}
  if(actor&&db){for(const scope of scopes){try{await transaction(db,async sql=>{const exists=await sql.query('SELECT id FROM teams WHERE id=$1',[scope.team_id]);if(!exists.rows.length)return;await appendAudit(sql,{teamId:scope.team_id,actorId:actor.id,action:`request.${action}`,resourceType:'endpoint',resourceId:action,outcome:response.ok?'success':response.status===401||response.status===403?'denied':'failure',after:{method:request.method,status:response.status}});});}catch{console.error('Geld structural request audit is unavailable');}}}
  return response;
 };
}
