import 'server-only';
import { createHmac,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { database } from './db';
import { transaction } from './transactions';
import { guidePolicy } from './guide-policy';
import { shouldGenerateGuide } from '@geld/domain';
export function verifyWebhook(body:string,signature:string|null,secret:string):boolean{if(!signature||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;const expected=createHmac('sha256',secret).update(body).digest();const provided=Buffer.from(signature.slice(7),'hex');return expected.length===provided.length&&timingSafeEqual(expected,provided);}
export const pullEventSchema=z.object({provider:z.enum(['github','gitlab','bitbucket']),host:z.string(),repositoryId:z.string(),number:z.number().int().positive(),headSha:z.string(),state:z.enum(['open','closed','merged']),draft:z.boolean(),event:z.enum(['created','push','force_push','review_requested','review_request_removed','reviewed','closed','other']),reviewer:z.string().optional(),installationId:z.string().optional()});
export async function consumePullEvent(deliveryId:string,event:z.infer<typeof pullEventSchema>):Promise<boolean>{const db=database();if(!db)return false;const repos=z.array(z.object({id:z.string(),team_id:z.string(),settings:z.object({defaultReviewers:z.array(z.string()).optional()})})).parse((await db.query('SELECT id,team_id,settings FROM team_repos WHERE provider=$1 AND host=$2 AND external_id=$3 AND approved AND removed_at IS NULL',[event.provider,event.host,event.repositoryId])).rows);
  return transaction(db,async sql=>{
    const delivery=await sql.query("INSERT INTO webhook_deliveries(provider,delivery_id,outcome) VALUES($1,$2,'pending') ON CONFLICT DO NOTHING RETURNING delivery_id",[event.provider,deliveryId]);if(!delivery.rows.length)return true;
    for(const repo of repos){
      if(event.provider==='github'){const installation=await sql.query("SELECT i.id FROM app_installations i JOIN team_app_installations t ON t.installation_id=i.id WHERE t.team_id=$1 AND i.external_id=$2 AND i.state='verified'",[repo.team_id,event.installationId??'']);if(!installation.rows.length)continue;}
      if(event.reviewer){const reviewer=z.object({user_id:z.string()}).safeParse((await sql.query('SELECT l.user_id FROM provider_user_links l JOIN team_members m ON m.user_id=l.user_id WHERE m.team_id=$1 AND l.provider=$2 AND l.host=$3 AND l.login=$4',[repo.team_id,event.provider,event.host,event.reviewer])).rows[0]);if(reviewer.success)await sql.query("INSERT INTO assignments(id,team_id,repo_id,pull_number,reviewer_id,provider_request_id,state) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(repo_id,pull_number,reviewer_id) DO UPDATE SET state=EXCLUDED.state",[crypto.randomUUID(),repo.team_id,repo.id,event.number,reviewer.data.user_id,event.reviewer,event.event==='review_request_removed'?'removed':event.event==='reviewed'?'completed':'requested']);}
      if(event.state!=='open')await sql.query("UPDATE assignments SET state='completed' WHERE repo_id=$1 AND pull_number=$2 AND state IN('pending','requested')",[repo.id,event.number]);
      if(event.event==='created')for(const userId of repo.settings.defaultReviewers??[])await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key,payload) VALUES($1,$2,'default_assignment',$3,$4,$5) ON CONFLICT DO NOTHING",[crypto.randomUUID(),repo.team_id,repo.id,`default:${repo.id}:${event.number}:${userId}`,JSON.stringify({repoId:repo.id,number:event.number,userId})]);
      if(event.event==='created'||event.event==='push'||event.event==='force_push'){
        const policy=await guidePolicy(repo.id,event.number);if(shouldGenerateGuide(policy,event.event,event.state,event.draft))await sql.query("INSERT INTO outbox_jobs(id,team_id,kind,resource_id,idempotency_key,payload) VALUES($1,$2,'automatic_guide',$3,$4,$5) ON CONFLICT DO NOTHING",[crypto.randomUUID(),repo.team_id,repo.id,`guide:${repo.id}:${event.number}:${event.headSha}`,JSON.stringify({repoId:repo.id,number:event.number,headSha:event.headSha,event:event.event})]);
      }
    }
    await sql.query("UPDATE webhook_deliveries SET outcome='processed' WHERE provider=$1 AND delivery_id=$2",[event.provider,deliveryId]);return true;
  });
}
