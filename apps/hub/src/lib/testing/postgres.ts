import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Database } from "#/db";
import * as schema from "#/db/schema";

const MIGRATIONS = new URL("../../../db/migrations/", import.meta.url);

let shared: Promise<{ client: PGlite; db: Database }> | null = null;

async function start() {
	const client = new PGlite();
	const files = readdirSync(MIGRATIONS)
		.filter((name) => name.endsWith(".sql"))
		.sort();
	for (const file of files) {
		await client.exec(
			readFileSync(new URL(file, MIGRATIONS), "utf8").replaceAll(
				"--> statement-breakpoint",
				"",
			),
		);
	}
	return { client, db: drizzle(client, { schema }) };
}

/**
 * A real Postgres in the test process, with the app's migrations applied.
 * One instance serves a whole test file; every call hands it back empty.
 */
export async function createTestDatabase(): Promise<{
	db: Database;
	client: PGlite;
}> {
	shared ??= start();
	const { client, db } = await shared;
	await client.exec(
		'TRUNCATE "identities", "sessions", "verifications", "rateLimit", "hub_user_forbidden_org", "hub_github_change", "users" CASCADE',
	);
	return { db, client };
}
