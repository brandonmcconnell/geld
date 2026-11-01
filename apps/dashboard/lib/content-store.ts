import 'server-only';
import { assertTeamOperations } from './team-operation';
import { Pool } from 'pg';
import { z } from 'zod';
import type { ReviewPlan } from '@geld/review/plan';
import { reviewPlanSchema } from '@geld/review/plan';
import { database } from './db';
import { configured } from './env';
import { transaction, type SqlExecutor } from './transactions';
import { decryptCredential, encryptCredential } from './crypto';
export interface GeneratedContentStore {
  put(input: {
    readonly teamId: string;
    readonly repoId: string;
    readonly number: number;
    readonly headSha: string;
    readonly plan: ReviewPlan;
    readonly reservationId?: string;
  }): Promise<void>;
  get(teamId: string, repoId: string, number: number, headSha: string): Promise<ReviewPlan | null>;
  hasPublication(reservationId: string): Promise<boolean>;
  deleteTeam(teamId: string): Promise<void>;
  purgeExpired(): Promise<void>;
}
let customer: Pool | null = null;
export function contentStore(): GeneratedContentStore {
  const customerUrl = configured(process.env.CUSTOMER_CONTENT_DATABASE_URL);
  if (customerUrl && !customer)
    customer = new Pool({
      connectionString: customerUrl,
      max: 3,
      connectionTimeoutMillis: 10000,
      ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
    });
  const primary = database();
  const db = customerUrl ? customer : primary;
  if (!db || !primary) throw new Error('Generated content storage is not configured');
  return createGeneratedContentStore({
    sql: db,
    run: (work) => transaction(db, work),
    customer: !!customerUrl,
    primary: { sql: primary, run: (work) => transaction(primary, work) },
  });
}
interface StoreDatabase {
  readonly sql: SqlExecutor;
  readonly run: <T>(work: (sql: SqlExecutor) => Promise<T>) => Promise<T>;
}
export function createGeneratedContentStore(
  dependencies: StoreDatabase & { readonly customer?: boolean; readonly primary?: StoreDatabase },
): GeneratedContentStore {
  if (dependencies.customer && !dependencies.primary) throw new Error('Primary content authority is required');
  const primary = dependencies.primary ?? dependencies;
  const db = dependencies.sql;
  const table = dependencies.customer ? 'geld_generated_content' : 'generated_content';
  const receipts = dependencies.customer ? 'geld_generated_content_receipts' : 'generated_content_receipts';
  return {
    async put(input) {
      await assertTeamOperations();
      const encrypted = await encryptCredential(JSON.stringify(input.plan));
      const publish = async (sql: SqlExecutor) => {
        await sql.query("SET LOCAL statement_timeout='30s'");
        await sql.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
        if (dependencies.customer) {
          await sql.query('INSERT INTO geld_content_teams(team_id) VALUES($1) ON CONFLICT DO NOTHING', [input.teamId]);
          if (
            !(
              await sql.query('SELECT team_id FROM geld_content_teams WHERE team_id=$1 AND NOT erased FOR UPDATE', [
                input.teamId,
              ])
            ).rows.length
          )
            throw new Error('Generated content is no longer accepted for this team');
        }
        await sql.query(
          `INSERT INTO ${table}(id,team_id,repo_id,pull_number,head_sha,encrypted_content) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(team_id,repo_id,pull_number,head_sha) DO UPDATE SET encrypted_content=EXCLUDED.encrypted_content,expires_at=now()+interval '30 days'`,
          [crypto.randomUUID(), input.teamId, input.repoId, input.number, input.headSha, encrypted],
        );
        if (input.reservationId)
          await sql.query(
            `INSERT INTO ${receipts}(reservation_id,team_id,repo_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
            [input.reservationId, input.teamId, input.repoId],
          );
      };
      await primary.run(async (sql) => {
        await sql.query("SET LOCAL statement_timeout='30s'");
        const team = await sql.query('SELECT id FROM teams WHERE id=$1 AND content_erasing_at IS NULL FOR UPDATE', [
          input.teamId,
        ]);
        if (!team.rows.length) throw new Error('Generated content is no longer accepted for this team');
        if (dependencies.customer) await dependencies.run(publish);
        else await publish(sql);
      });
    },
    async get(teamId, repoId, number, headSha) {
      if (
        !(await primary.sql.query('SELECT id FROM teams WHERE id=$1 AND content_erasing_at IS NULL', [teamId])).rows
          .length
      )
        return null;
      const row = z
        .object({ encrypted_content: z.string() })
        .safeParse(
          (
            await db.query(
              `SELECT encrypted_content FROM ${table} WHERE team_id=$1 AND repo_id=$2 AND pull_number=$3 AND head_sha=$4 AND expires_at>now()`,
              [teamId, repoId, number, headSha],
            )
          ).rows[0],
        );
      if (!row.success) return null;
      const text = await decryptCredential(row.data.encrypted_content);
      if (!text) return null;
      try {
        const parsed = reviewPlanSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async hasPublication(reservationId) {
      return (
        (
          await db.query(`SELECT reservation_id FROM ${receipts} WHERE reservation_id=$1 AND expires_at>now()`, [
            reservationId,
          ])
        ).rows.length > 0
      );
    },
    async purgeExpired() {
      await dependencies.run(async (sql) => {
        await sql.query(`DELETE FROM ${table} WHERE expires_at<=now()`);
        await sql.query(`DELETE FROM ${receipts} WHERE expires_at<=now()`);
      });
    },
    async deleteTeam(teamId) {
      await assertTeamOperations();
      await primary.sql.query('UPDATE teams SET content_erasing_at=now() WHERE id=$1', [teamId]);
      await dependencies.run(async (sql) => {
        if (dependencies.customer)
          await sql.query(
            'INSERT INTO geld_content_teams(team_id,erased) VALUES($1,true) ON CONFLICT(team_id) DO UPDATE SET erased=true',
            [teamId],
          );
        await sql.query(`DELETE FROM ${table} WHERE team_id=$1`, [teamId]);
        await sql.query(`DELETE FROM ${receipts} WHERE team_id=$1`, [teamId]);
      });
    },
  };
}
