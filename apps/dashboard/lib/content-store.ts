import 'server-only';
import { Pool } from 'pg';
import { z } from 'zod';
import type { ReviewPlan } from '@geld/review/plan';
import { reviewPlanSchema } from '@geld/review/plan';
import { database } from './db';
import { configured } from './env';
import { decryptCredential,encryptCredential } from './crypto';
export interface GeneratedContentStore { put(input:{readonly teamId:string;readonly repoId:string;readonly number:number;readonly headSha:string;readonly plan:ReviewPlan}):Promise<void>;get(teamId:string,repoId:string,number:number,headSha:string):Promise<ReviewPlan|null>;deleteTeam(teamId:string):Promise<void> }
let customer:Pool|null=null;
export function contentStore():GeneratedContentStore {
  const customerUrl=configured(process.env.CUSTOMER_CONTENT_DATABASE_URL);if(customerUrl&&!customer)customer=new Pool({connectionString:customerUrl,max:3,ssl:process.env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:true}});
  const db=customerUrl?customer:database();
  if(!db)throw new Error('Generated content storage is not configured');
  const table=customerUrl?'geld_generated_content':'generated_content';
  return{async put(i){await db.query(`INSERT INTO ${table}(id,team_id,repo_id,pull_number,head_sha,encrypted_content) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(team_id,repo_id,pull_number,head_sha) DO UPDATE SET encrypted_content=EXCLUDED.encrypted_content,expires_at=now()+interval '30 days'`,[crypto.randomUUID(),i.teamId,i.repoId,i.number,i.headSha,await encryptCredential(JSON.stringify(i.plan))]);},async get(teamId,repoId,number,headSha){const r=z.object({encrypted_content:z.string()}).safeParse((await db.query(`SELECT encrypted_content FROM ${table} WHERE team_id=$1 AND repo_id=$2 AND pull_number=$3 AND head_sha=$4 AND expires_at>now()`,[teamId,repoId,number,headSha])).rows[0]);if(!r.success)return null;const text=await decryptCredential(r.data.encrypted_content);if(!text)return null;try{const parsed=reviewPlanSchema.safeParse(JSON.parse(text));return parsed.success?parsed.data:null;}catch{return null;}},async deleteTeam(teamId){await db.query(`DELETE FROM ${table} WHERE team_id=$1`,[teamId]);}};
}
