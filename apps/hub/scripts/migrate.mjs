// Applies the SQL in db/migrations to the Postgres named by DATABASE_URL (the
// shell's, else apps/hub/.env). Plain Drizzle, so it runs the same wherever
// the app does: locally, in CI, and as a release step before a deploy.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const appDir = new URL("../", import.meta.url);

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = new URL(".env", appDir);
  return existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")).DATABASE_URL : undefined;
}

const connectionString = databaseUrl();
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to apps/hub/.env or the shell.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  if (process.argv.includes("--reset")) {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE");
  }
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("db/migrations", appDir)) });
  console.log("Migrations are up to date.");
} catch (error) {
  const reason = error instanceof AggregateError ? error.errors.map(String).join("; ") : String(error?.cause ?? error);
  console.error(`Could not migrate the database: ${reason}`);
  console.error("Is Postgres running? `docker compose -f apps/hub/compose.yaml up -d` starts one.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
