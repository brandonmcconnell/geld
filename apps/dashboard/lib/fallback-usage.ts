import { z } from 'zod';
import type { SqlExecutor } from './transactions';
export async function fallbackSummaryUsage(sql:SqlExecutor,teamId:string,period:{readonly start:string;readonly end:string}):Promise<{readonly credits:number;readonly cents:number}> {
  return z.object({credits:z.coerce.number(),cents:z.coerce.number()}).parse((await sql.query("SELECT COALESCE(sum(credits),0) AS credits,COALESCE(sum(overage_cents),0) AS cents FROM credit_reservations WHERE team_id=$1 AND state='settled' AND fallback=true AND settled_at>=$2 AND settled_at<$3",[teamId,period.start,period.end])).rows[0]);
}
