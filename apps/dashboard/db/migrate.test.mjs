import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations, DatabaseNotEmptyError } from './migrate.mjs';

async function fixture(run, secondMigration = 'ALTER TABLE widgets ADD COLUMN title text') {
  const path = await mkdtemp(join(tmpdir(), 'geld-migrations-'));
  const db = new PGlite();
  try {
    await writeFile(join(path, '0001_widgets.sql'), 'CREATE TABLE widgets (id text PRIMARY KEY)');
    await writeFile(join(path, '0002_titles.sql'), secondMigration);
    await run(db, pathToFileURL(path + '/'));
  } finally {
    await db.close();
    await rm(path, { recursive: true, force: true });
  }
}

test('initializes an empty database once and skips already-applied migrations', async () => {
  await fixture(async (db, directory) => {
    assert.deepEqual(await applyMigrations(db, directory, { requireEmpty: true }), { applied: 2, skipped: 0 });
    assert.deepEqual(await applyMigrations(db, directory), { applied: 0, skipped: 2 });
    assert.equal((await db.query('SELECT name FROM geld_migrations')).rows.length, 2);
    await assert.rejects(applyMigrations(db, directory, { requireEmpty: true }), DatabaseNotEmptyError);
  });
});

test('refuses an existing database without changing its data or creating a migration ledger', async () => {
  await fixture(async (db, directory) => {
    await db.exec("CREATE TABLE existing (value text); INSERT INTO existing VALUES ('preserve')");
    await assert.rejects(applyMigrations(db, directory, { requireEmpty: true }), DatabaseNotEmptyError);
    assert.deepEqual((await db.query('SELECT value FROM existing')).rows, [{ value: 'preserve' }]);
    assert.equal((await db.query("SELECT to_regclass('public.geld_migrations') AS ledger")).rows[0].ledger, null);
  });
});

test('rolls back every schema change when any migration fails', async () => {
  await fixture(async (db, directory) => {
    await assert.rejects(applyMigrations(db, directory, { requireEmpty: true }));
    const result = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    assert.deepEqual(result.rows, []);
  }, 'ALTER TABLE missing_table ADD COLUMN title text');
});
