import 'server-only';
import { z } from 'zod';
import { transaction } from './transactions';
import { finishCredits } from './credits';
import { database } from './db';
import { billingGateway } from './billing-gateway';
import { sendEmail } from './email';
import { dashboardOrigin } from './env';
import { processGrant,repoRowSchema,refFor } from './team-access';
import { automaticGuide } from './automatic-guide';
import { backgroundUserTokenSource } from './background-tokens';
import { createProviderClient } from '@geld/providers';
const jobSchema=z.object({id:z.string(),team_id:z.string().nullable(),kind:z.string(),resource_id:z.string(),idempotency_key:z.string(),attempts:z.number(),created_at:z.date(),payload:z.unknown()});
async function handle(job:z.infer<typeof jobSchema>):Promise<boolean>{const db=database();if(!db)return false;
  if(job.kind==='automatic_guide')return automaticGuide(job.payload,`${job.idempotency_key}:${job.attempts}`);
  if(job.kind==='grant'||job.kind==='revoke'){const actor=z.object({actor_id:z.string()}).safeParse((await db.query('SELECT actor_id FROM grants WHERE id=$1',[job.resource_id])).rows[0]);return actor.success?processGrant(job.resource_id,actor.data.actor_id,true):false;}
  if(job.kind==='sync_seats'||job.kind==='bill_overage'){
    const gateway=billingGateway();if(!gateway||!job.team_id)return false;const s=z.object({stripe_customer_id:z.string(),stripe_subscription_id:z.string(),stripe_item_id:z.string(),seats:z.number()}).safeParse((await db.query('SELECT * FROM subscriptions WHERE team_id=$1',[job.team_id])).rows[0]);if(!s.success)return false;
    if(job.kind==='sync_seats'){await gateway.updateSeats(s.data.stripe_item_id,s.data.seats,job.idempotency_key);return true;}
    // Stripe retains idempotency keys for at least 24 hours. Older uncertain charges need reconciliation, never a blind retry.
    if(Date.now()-job.created_at.getTime()>23*60*60*1000){await db.query('UPDATE outbox_jobs SET attempts=8 WHERE id=$1',[job.id]);return false;}
    const credit=z.object({overage_cents:z.number(),state:z.string()}).safeParse((await db.query('SELECT overage_cents,state FROM credit_reservations WHERE id=$1',[job.resource_id])).rows[0]);if(!credit.success||credit.data.state!=='settled')return true;await gateway.overage(s.data.stripe_customer_id,s.data.stripe_subscription_id,credit.data.overage_cents,job.resource_id);return true;
  }
  if(job.kind==='default_assignment'){
    const input=z.object({repoId:z.string(),number:z.number(),userId:z.string()}).parse(job.payload);const repo=repoRowSchema.safeParse((await db.query('SELECT * FROM team_repos WHERE id=$1 AND approved AND removed_at IS NULL',[input.repoId])).rows[0]);if(!repo.success)return true;
    const actor=z.object({user_id:z.string()}).safeParse((await db.query("SELECT user_id FROM team_members WHERE team_id=$1 AND role='admin' ORDER BY created_at LIMIT 1",[repo.data.team_id])).rows[0]);if(!actor.success)return false;
    const reviewer=z.object({login:z.string()}).safeParse((await db.query('SELECT l.login FROM provider_user_links l JOIN team_members m ON m.user_id=l.user_id WHERE m.team_id=$1 AND l.user_id=$2 AND l.provider=$3 AND l.host=$4',[repo.data.team_id,input.userId,repo.data.provider,repo.data.host])).rows[0]);if(!reviewer.success)return false;
    const client=createProviderClient({provider:repo.data.provider,source:await backgroundUserTokenSource(actor.data.user_id,repo.data.provider,repo.data.owner),host:repo.data.host});const ref={...refFor(repo.data),number:input.number};const pull=await client.pull(ref);if(!pull.ok)return false;if(pull.value.state!=='open')return true;
    if(!pull.value.reviewers.includes(reviewer.data.login)){const requested=await client.requestReviewers(ref,[reviewer.data.login]);if(!requested.ok)return false;}
    await db.query("INSERT INTO assignments(id,team_id,repo_id,pull_number,reviewer_id,provider_request_id,state) VALUES($1,$2,$3,$4,$5,$6,'requested') ON CONFLICT(repo_id,pull_number,reviewer_id) DO UPDATE SET state='requested'",[crypto.randomUUID(),repo.data.team_id,repo.data.id,input.number,input.userId,reviewer.data.login]);return true;
  }
  if(job.kind==='email_invite'){
    const user=z.object({email:z.string()}).safeParse((await db.query("SELECT u.email FROM users u JOIN team_invites i ON i.invited_user_id=u.id WHERE i.team_id=$1 AND u.id=$2 AND i.state='pending' AND i.expires_at>now()",[job.team_id,job.resource_id])).rows[0]);if(!user.success)return true;await sendEmail(user.data.email,'You have a Geld team invitation',`Review and accept your invitation: ${dashboardOrigin()}/inbox`,job.idempotency_key);return true;
  }
  if(job.kind==='fallback_email'||job.kind==='email_access'){
    const users=z.array(z.object({email:z.string()})).parse((await db.query("SELECT u.email FROM users u JOIN team_members m ON m.user_id=u.id WHERE m.team_id=$1 AND m.role='admin'",[job.team_id])).rows);for(const user of users)await sendEmail(user.email,job.kind==='fallback_email'?'Geld safety net was used':'A repository access request is waiting',job.kind==='fallback_email'?`The first safety-net overage has been recorded. Review usage and the cap: ${dashboardOrigin()}/settings/billing`:`Review this request and confirm your provider permissions: ${dashboardOrigin()}/teams/${job.team_id}`,`${job.idempotency_key}:${user.email}`);return true;
  }
  return false;
}
export async function drainOutbox(limit=2):Promise<{completed:number;failed:number}>{const db=database();if(!db)throw new Error('Job storage is unavailable');await db.query("UPDATE outbox_jobs SET state='failed',locked_at=NULL WHERE state='running' AND locked_at<now()-interval '15 minutes'");const jobs=z.array(jobSchema).parse((await db.query("UPDATE outbox_jobs SET state='running',locked_at=now(),attempts=attempts+1 WHERE id IN(SELECT id FROM outbox_jobs WHERE state IN('pending','failed') AND attempts<8 AND run_after<=now() ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *",[limit])).rows);const expired=z.array(z.object({id:z.string()})).parse((await db.query("SELECT id FROM credit_reservations WHERE state='reserved' AND created_at<now()-interval '15 minutes' LIMIT 50")).rows);for(const credit of expired)await transaction(db,sql=>finishCredits(sql,credit.id,false));let completed=0;let failed=0;for(const job of jobs){let success=false;try{success=await handle(job);}catch{}await db.query("UPDATE outbox_jobs SET state=$2,locked_at=NULL,run_after=now()+make_interval(secs=>LEAST(1800,30*power(2,attempts))::integer) WHERE id=$1",[job.id,success?'completed':'failed']);if(success)completed++;else failed++;}await db.query("UPDATE access_requests SET state='expired' WHERE state='pending' AND expires_at<=now()");await db.query("UPDATE team_invites SET state='expired' WHERE state='pending' AND expires_at<=now()");await db.query('DELETE FROM generated_content WHERE expires_at<=now()');await db.query("DELETE FROM app_flows WHERE expires_at<now()-interval '1 day'");await db.query("DELETE FROM webhook_deliveries WHERE created_at<now()-interval '90 days'");await db.query("DELETE FROM mutation_keys WHERE created_at<now()-interval '30 days'");await db.query("DELETE FROM audit_events WHERE created_at<now()-interval '365 days'");return{completed,failed};}
