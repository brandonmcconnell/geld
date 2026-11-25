import { z } from 'zod';
import { lockDatabase } from './db';
import { transaction } from './transactions';

type GrantLockResult<T> = { readonly acquired: true; readonly value: T } | { readonly acquired: false };

export async function withGrantLocks<T>(keys: readonly string[], work: () => Promise<T>): Promise<GrantLockResult<T>> {
  const pool = lockDatabase();
  if (!pool) return { acquired: false };
  return transaction<GrantLockResult<T>>(pool, async (sql) => {
    for (const key of keys) {
      const { rows } = await sql.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [key]);
      if (!z.object({ locked: z.boolean() }).parse(rows[0]).locked) return { acquired: false };
    }
    return { acquired: true, value: await work() };
  });
}
