import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
let db: PGlite;
vi.mock('./db', () => ({
  database: () => ({
    query: async (text: string, values?: unknown[]) => db.query(text, values),
  }),
}));
import { withTeamOperation } from './team-operation';
describe('provider operation serialization', () => {
  it('blocks concurrent work, releases a failed holder and recovers an expired holder without holding a connection', async () => {
    db = new PGlite();
    const directory = new URL('../db/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
      await db.exec(await readFile(new URL(name, directory), 'utf8'));
    await db.exec("INSERT INTO teams(id,name) VALUES('t','Team')");
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = withTeamOperation('t', async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return 'first';
    });
    await ready;
    expect(await withTeamOperation('t', async () => 'overlap')).toEqual({
      ok: false,
    });
    release();
    expect(await pending).toEqual({ ok: true, value: 'first' });
    await expect(
      withTeamOperation('t', async () => {
        throw new Error('Synthetic failure');
      }),
    ).rejects.toThrow('Synthetic failure');
    expect((await db.query('SELECT * FROM team_operation_leases')).rows).toHaveLength(0);
    await db.exec(
      "INSERT INTO team_operation_leases(team_id,holder,expires_at) VALUES('t','abandoned',now()-interval '1 second')",
    );
    expect(await withTeamOperation('t', async () => 'recovered')).toEqual({
      ok: true,
      value: 'recovered',
    });
    await db.close();
  });
});
