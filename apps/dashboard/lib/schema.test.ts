import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { getSchema } from 'better-auth/db';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getAuth } from './auth';

describe('database contracts', () => {
  it('applies cleanly and includes every installed Better Auth field', async () => {
    const db = new PGlite();
    for (const name of ['0001_auth.sql','0002_dashboard.sql']) await db.exec(await readFile(fileURLToPath(new URL(`../db/migrations/${name}`, import.meta.url)), 'utf8'));
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/geld_schema_test');
    vi.stubEnv('BETTER_AUTH_SECRET', crypto.randomUUID());
    const auth = getAuth();
    if (!auth) throw new Error('Auth configuration did not initialize');
    const schema = getSchema(auth.options);
    for (const [table, definition] of Object.entries(schema)) {
      const result = await db.query<{ column_name: string }>('SELECT column_name FROM information_schema.columns WHERE table_name = $1', [table]);
      const columns = result.rows.map((column) => column.column_name);
      expect(columns, table).toContain('id');
      for (const field of Object.keys(definition.fields)) expect(columns, `${table}.${field}`).toContain(field);
    }
    await db.exec("INSERT INTO users(id,name,email) VALUES ('u','Reviewer','reviewer@example.test'); INSERT INTO teams(id,name) VALUES ('t','Team')");
    await expect(db.exec("UPDATE teams SET sync_enabled = true WHERE id = 't'")).rejects.toThrow();
    await db.close();
    vi.unstubAllEnvs();
  });
});
