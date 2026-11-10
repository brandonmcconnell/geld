import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

export class DatabaseNotEmptyError extends Error {}

export async function applyMigrations(client, directory, { requireEmpty = false } = {}) {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('geld:migrations',0))");
    if (requireEmpty) {
      const existing = await client.query(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')",
      );
      if (existing.rows.length) throw new DatabaseNotEmptyError('Initialization requires an empty database');
    }
    await client.query('CREATE TABLE IF NOT EXISTS geld_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    const files = (await readdir(directory)).filter((name) => /^\d+_[a-z_]+\.sql$/.test(name)).sort();
    let applied = 0;
    for (const name of files) {
      if ((await client.query('SELECT name FROM geld_migrations WHERE name=$1', [name])).rows.length) continue;
      await client.query(await readFile(new URL(name, directory), 'utf8'));
      await client.query('INSERT INTO geld_migrations(name) VALUES($1)', [name]);
      applied++;
    }
    await client.query('COMMIT');
    return { applied, skipped: files.length - applied };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Database connection is not configured');
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  try {
    const client = await pool.connect();
    try {
      const result = await applyMigrations(client, new URL('./migrations/', import.meta.url), {
        requireEmpty: process.argv.includes('--require-empty'),
      });
      process.stdout.write(`Geld schema is current. Applied ${result.applied} migrations, skipped ${result.skipped}.\n`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main().catch((error) => {
    process.stderr.write(error instanceof DatabaseNotEmptyError
      ? 'Initialization refused: the database contains existing objects. No migrations were applied.\n'
      : 'Database migration failed. No incomplete schema changes were committed.\n');
    process.exitCode = 1;
  });
}
