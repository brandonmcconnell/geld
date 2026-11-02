import 'server-only';
import { Pool } from 'pg';
import { configured } from './env';
let pool: Pool | null = null;
export function database(): Pool | null {
  const connectionString = configured(process.env.DATABASE_URL);
  if (!connectionString) return null;
  pool ??= new Pool({ connectionString, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  return pool;
}
