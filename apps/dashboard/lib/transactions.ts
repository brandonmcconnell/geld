import 'server-only';
import type { Pool } from 'pg';
export interface SqlExecutor { query(text: string, values?: unknown[]): Promise<{ readonly rows: unknown[] }> }
export async function transaction<T>(pool: Pool, work: (sql: SqlExecutor) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work({ query: (text, values) => client.query(text, values) });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
