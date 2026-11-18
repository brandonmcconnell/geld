import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import { platform } from "#/platform";
import * as schema from "./schema";

/** Any Postgres driver Drizzle speaks to: node-postgres here, PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

type Scope = { db: Database | null };

const requestScope = new AsyncLocalStorage<Scope>();
const processScope: Scope = { db: null };

// A Worker may not carry a socket from one request into the next, so each
// request opens its own small pool; Hyperdrive keeps the real one. The runtime
// closes those sockets when the request ends.
const POOL_SIZE = 5;

function connect(): Database {
	const connectionString = platform.config().databaseUrl;
	if (!connectionString) {
		throw new Error(
			"No database is configured. Set DATABASE_URL, or bind HYPERDRIVE on Cloudflare.",
		);
	}
	const pool = new pg.Pool({ connectionString, max: POOL_SIZE });
	// An idle client's error has no caller to reach; without a listener it
	// would be thrown as an uncaught exception.
	pool.on("error", (error) => {
		console.warn("[db] idle connection failed", error.message);
	});
	return drizzle(pool, { schema });
}

/** Runs `handle` with a database of its own. The Worker entry wraps each request in it. */
export function withRequestDatabase<Result>(
	handle: () => Promise<Result>,
): Promise<Result> {
	return requestScope.run({ db: null }, handle);
}

/** The request's database, or the process's where nothing scoped one (a Node server, a script). */
export function getDb(): Database {
	const scope = requestScope.getStore() ?? processScope;
	scope.db ??= connect();
	return scope.db;
}
