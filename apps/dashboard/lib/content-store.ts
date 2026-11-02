import 'server-only';
import { Pool } from 'pg';
import { z } from 'zod';
import type { ReviewPlan } from '@geld/review/plan';
import { reviewPlanSchema } from '@geld/review/plan';
import { database } from './db';
import { configured } from './env';
import { transaction, type SqlExecutor } from './transactions';
import { decryptCredential, encryptCredential } from './crypto';
export interface GeneratedContentStore {
  put(input: { readonly teamId: string; readonly repoId: string; readonly number: number; readonly headSha: string; readonly plan: ReviewPlan; readonly reservationId?: string }): Promise<void>;
  get(teamId: string, repoId: string, number: number, headSha: string): Promise<ReviewPlan | null>;
  hasPublication(reservationId: string): Promise<boolean>;
  deleteTeam(teamId: string): Promise<void>;
}
let customer: Pool | null = null;
export function contentStore(): GeneratedContentStore {
  const customerUrl = configured(process.env.CUSTOMER_CONTENT_DATABASE_URL);
  if (customerUrl && !customer) customer = new Pool({ connectionString: customerUrl, max: 3, connectionTimeoutMillis: 10000, ssl: process.env.DATABASE_SSL==='disable' ? false : { rejectUnauthorized: true } });
  const db = customerUrl ? customer : database();
  if (!db) throw new Error('Generated content storage is not configured');
  return createGeneratedContentStore({sql:db,run:work=>transaction(db,work),customer:!!customerUrl});
}
export function createGeneratedContentStore(dependencies: { readonly sql: SqlExecutor; readonly run: <T>(work: (sql: SqlExecutor) => Promise<T>) => Promise<T>; readonly customer?: boolean }): GeneratedContentStore {
  const db=dependencies.sql;
  const table = dependencies.customer ? 'geld_generated_content' : 'generated_content';
  const receipts = dependencies.customer ? 'geld_generated_content_receipts' : 'generated_content_receipts';
  return {
    async put(input) {
      const encrypted = await encryptCredential(JSON.stringify(input.plan));
      await dependencies.run(async sql => {
        await sql.query("SET LOCAL statement_timeout='30s'");
        await sql.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
        await sql.query(`INSERT INTO ${table}(id,team_id,repo_id,pull_number,head_sha,encrypted_content) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(team_id,repo_id,pull_number,head_sha) DO UPDATE SET encrypted_content=EXCLUDED.encrypted_content,expires_at=now()+interval '30 days'`,[crypto.randomUUID(),input.teamId,input.repoId,input.number,input.headSha,encrypted]);
        if (input.reservationId) await sql.query(`INSERT INTO ${receipts}(reservation_id,team_id,repo_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[input.reservationId,input.teamId,input.repoId]);
      });
    },
    async get(teamId,repoId,number,headSha) {
      const row = z.object({ encrypted_content: z.string() }).safeParse((await db.query(`SELECT encrypted_content FROM ${table} WHERE team_id=$1 AND repo_id=$2 AND pull_number=$3 AND head_sha=$4 AND expires_at>now()`,[teamId,repoId,number,headSha])).rows[0]);
      if (!row.success) return null;
      const text = await decryptCredential(row.data.encrypted_content);
      if (!text) return null;
      try { const parsed = reviewPlanSchema.safeParse(JSON.parse(text)); return parsed.success ? parsed.data : null; } catch { return null; }
    },
    async hasPublication(reservationId) { return (await db.query(`SELECT reservation_id FROM ${receipts} WHERE reservation_id=$1 AND expires_at>now()`,[reservationId])).rows.length>0; },
    async deleteTeam(teamId) { await dependencies.run(async sql => { await sql.query(`DELETE FROM ${table} WHERE team_id=$1`,[teamId]); await sql.query(`DELETE FROM ${receipts} WHERE team_id=$1`,[teamId]); }); },
  };
}
