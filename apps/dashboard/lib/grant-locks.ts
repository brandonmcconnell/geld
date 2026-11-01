import { z } from 'zod';
import { lockDatabase } from './db';
export async function withGrantLocks<T>(keys: readonly string[], work: () => Promise<T>): Promise<{ readonly acquired: true; readonly value: T } | { readonly acquired: false }> {
  const pool=lockDatabase();
  if(!pool)return {acquired:false};
  const client=await pool.connect();
  const held:string[]=[];
  try {
    for(const key of keys) {
      const lock=z.object({locked:z.boolean()}).parse((await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0]);
      if(!lock.locked)return {acquired:false};
      held.push(key);
    }
    return {acquired:true,value:await work()};
  } finally {
    try {for(const key of held.reverse())await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}
    finally {client.release();}
  }
}
