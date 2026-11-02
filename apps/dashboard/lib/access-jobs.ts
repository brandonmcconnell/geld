import { z } from 'zod';
import type { SqlExecutor } from './transactions';
const claimedSchema=z.object({id:z.string(),resource_id:z.string(),lock_token:z.string(),kind:z.string(),payload:z.unknown()});
export type ClaimedAccessJob=z.infer<typeof claimedSchema>;
export async function claimAccessJobs(sql:SqlExecutor,teamId:string):Promise<readonly ClaimedAccessJob[]> {
  await sql.query("UPDATE outbox_jobs SET state='failed',locked_at=NULL,lock_token=NULL WHERE team_id=$1 AND kind IN('grant','revoke','destroy_team') AND state='running' AND (locked_at<now()-interval '15 minutes' OR (locked_at IS NULL AND created_at<now()-interval '15 minutes'))",[teamId]);
  return z.array(claimedSchema).parse((await sql.query("UPDATE outbox_jobs SET state='running',locked_at=now(),lock_token=gen_random_uuid()::text,attempts=attempts+1 WHERE id IN(SELECT id FROM outbox_jobs WHERE team_id=$1 AND kind IN('grant','revoke','destroy_team') AND state IN('pending','failed') AND run_after<=now() ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING id,resource_id,lock_token,kind,payload",[teamId])).rows);
}
export async function finishAccessJob(sql:SqlExecutor,job:ClaimedAccessJob,success:boolean):Promise<boolean> {
  const updated=await sql.query("UPDATE outbox_jobs SET state=$3,locked_at=NULL,lock_token=NULL,run_after=now()+interval '1 minute' WHERE id=$1 AND lock_token=$2 AND state='running' RETURNING id",[job.id,job.lock_token,success?'completed':'failed']);
  return updated.rows.length>0;
}
