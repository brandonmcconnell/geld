import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { FetchLike } from '@geld/github';
import { database } from './db';
import type { SqlExecutor } from './transactions';
interface Operation {readonly teamId:string;readonly controller:AbortController;readonly check:()=>Promise<void>}
const operations=new AsyncLocalStorage<readonly Operation[]>();
export async function assertTeamOperations():Promise<void>{for(const operation of operations.getStore()??[])await operation.check();}
export function operationSql(sql:SqlExecutor):SqlExecutor{return{async query(text,values){await assertTeamOperations();return sql.query(text,values);}};}
export function operationFetch(base:FetchLike=fetch):FetchLike{return async(url,init)=>{await assertTeamOperations();const signals=(operations.getStore()??[]).map(operation=>operation.controller.signal);if(init?.signal)signals.push(init.signal);return base(url,{...init,...(signals.length?{signal:AbortSignal.any(signals)}:{})});};}
export async function withTeamOperation<T>(teamId:string,work:()=>Promise<T>):Promise<{readonly ok:true;readonly value:T}|{readonly ok:false}>{
  const db=database();if(!db)return{ok:false};
  const holder=crypto.randomUUID();
  const lease=await db.query("INSERT INTO team_operation_leases(team_id,holder,expires_at) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(team_id) DO UPDATE SET holder=EXCLUDED.holder,expires_at=EXCLUDED.expires_at WHERE team_operation_leases.expires_at<now() RETURNING holder",[teamId,holder]);
  if(!lease.rows.length)return{ok:false};
  const controller=new AbortController();
  const lost=()=>{controller.abort();throw new Error('The team operation lease changed');};
  const check=async()=>{
    if(controller.signal.aborted)lost();
    try {if(!(await db.query('SELECT holder FROM team_operation_leases WHERE team_id=$1 AND holder=$2 AND expires_at>now()',[teamId,holder])).rows.length)lost();}
    catch(error){controller.abort();throw error;}
  };
  let renewing:Promise<void>|null=null;
  const timer=setInterval(()=>{
    if(renewing)return;
    renewing=db.query("UPDATE team_operation_leases SET expires_at=now()+interval '10 minutes' WHERE team_id=$1 AND holder=$2 AND expires_at>now() RETURNING holder",[teamId,holder]).then(result=>{if(!result.rows.length)controller.abort();}).catch(()=>{controller.abort();}).finally(()=>{renewing=null;});
  },30000);timer.unref();
  try {
    const value=await operations.run([...(operations.getStore()??[]),{teamId,controller,check}],async()=>{await assertTeamOperations();return work();});
    if(controller.signal.aborted)return{ok:false};
    if((await db.query('SELECT id FROM teams WHERE id=$1',[teamId])).rows.length)await check();
    return{ok:true,value};
  }catch(error){if(controller.signal.aborted)return{ok:false};throw error;}
  finally {clearInterval(timer);await renewing;await db.query('DELETE FROM team_operation_leases WHERE team_id=$1 AND holder=$2',[teamId,holder]).catch(()=>undefined);}
}
