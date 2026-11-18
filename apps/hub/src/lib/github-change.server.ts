import { and, count, gt, lt, max, sql } from "drizzle-orm";
import type { Database } from "#/db";
import { githubChange } from "#/db/schema";
import type { GitHubRepoEntity } from "./github-change-entities";
import { formatEntityKey, parseEntityKey } from "./github-change-entities";

// Storage rules that keep this table small: one row
// per entity, deleted by the cron sweeper once unchanged for 15 minutes; writes
// run after the response and are dropped on failure; read failures degrade to
// "nothing changed", never to an error.

export const GITHUB_CHANGE_RETENTION_MS = 15 * 60 * 1000;
// Rows after a cursor older than this may already be swept.
const GITHUB_CHANGE_CURSOR_MAX_AGE_MS = GITHUB_CHANGE_RETENTION_MS - 60 * 1000;
const GITHUB_CHANGE_READ_LIMIT = 2000;

const GITHUB_CHANGE_SWEEP_BATCH_SIZE = 5000;
const GITHUB_CHANGE_SWEEP_MAX_BATCHES = 20;
const GITHUB_CHANGE_MAX_EXPECTED_ROWS = 50_000;

const INSERT_ROWS_PER_STATEMENT = 500;
// Any constant: it only has to be the same for every writer of this table.
const VERSION_LOCK_KEY = 7_318_402;

export type GitHubChangeRow = {
	repo: string;
	entityKey: string;
	isPrivate: boolean;
	changedAt: number;
};

export function toGitHubChangeRows(
	entities: GitHubRepoEntity[],
	repository: { fullName: string; isPrivate: boolean },
	changedAt: number,
): GitHubChangeRow[] {
	const seen = new Set<string>();
	const rows: GitHubChangeRow[] = [];
	for (const entity of entities) {
		const entityKey = formatEntityKey(entity);
		if (seen.has(entityKey)) continue;
		seen.add(entityKey);
		rows.push({
			repo: entity.repo,
			entityKey,
			isPrivate: repository.isPrivate,
			changedAt,
		});
	}
	return rows;
}

async function currentVersion(db: Database) {
	const [row] = await db
		.select({ version: max(githubChange.version) })
		.from(githubChange);
	return row?.version ?? 0;
}

export async function recordGitHubChanges(
	db: Database,
	rows: GitHubChangeRow[],
): Promise<void> {
	if (rows.length === 0) return;
	// One statement may not touch a row twice, so repeats of an entity are
	// folded into its latest change first.
	const latest = new Map<string, GitHubChangeRow>();
	for (const row of rows) {
		const key = `${row.repo}\n${row.entityKey}`;
		const earlier = latest.get(key);
		latest.set(key, {
			...row,
			changedAt: Math.max(row.changedAt, earlier?.changedAt ?? 0),
		});
	}
	const merged = [...latest.values()];
	await db.transaction(async (tx) => {
		// Writers take turns, so a version read here is above every version a
		// finished read has seen: a reader's cursor never skips a later commit
		// that carries a lower number, which a sequence would allow.
		await tx.execute(sql`SELECT pg_advisory_xact_lock(${VERSION_LOCK_KEY})`);
		let version = await currentVersion(tx);
		for (
			let start = 0;
			start < merged.length;
			start += INSERT_ROWS_PER_STATEMENT
		) {
			const chunk = merged.slice(start, start + INSERT_ROWS_PER_STATEMENT);
			await tx
				.insert(githubChange)
				.values(
					chunk.map((row) => {
						version += 1;
						return { ...row, version };
					}),
				)
				.onConflictDoUpdate({
					target: [githubChange.repo, githubChange.entityKey],
					set: {
						isPrivate: sql`excluded.is_private`,
						version: sql`excluded.version`,
						changedAt: sql`GREATEST(${githubChange.changedAt}, excluded.changed_at)`,
					},
				});
		}
	});
}

export type GitHubChangeCursor = {
	version: number;
	at: number;
};

export function encodeChangeCursor(cursor: GitHubChangeCursor) {
	return `${cursor.version.toString(36)}.${cursor.at.toString(36)}`;
}

export function decodeChangeCursor(
	value: string | null | undefined,
): GitHubChangeCursor | null {
	if (!value) return null;
	const match = /^([0-9a-z]{1,12})\.([0-9a-z]{1,12})$/.exec(value);
	if (!match) return null;
	const version = Number.parseInt(match[1], 36);
	const at = Number.parseInt(match[2], 36);
	return Number.isSafeInteger(version) && Number.isSafeInteger(at)
		? { version, at }
		: null;
}

export type GitHubChangeAccess = {
	canRead: (repo: string, isPrivate: boolean) => boolean;
	watched: Set<string> | "all";
};

type CursorState =
	| { kind: "start" }
	| { kind: "stale" }
	| { kind: "live"; since: GitHubChangeCursor };

function classifyCursor(
	since: GitHubChangeCursor | null,
	now: number,
): CursorState {
	if (!since) return { kind: "start" };
	if (now - since.at > GITHUB_CHANGE_CURSOR_MAX_AGE_MS) {
		return { kind: "stale" };
	}
	return { kind: "live", since };
}

export type GitHubChangesResult =
	| { cursor: string; entities: string[]; expired: false }
	| { cursor: string; entities: []; expired: true };

export async function readGitHubChanges(
	db: Database,
	options: {
		since: GitHubChangeCursor | null;
		access: GitHubChangeAccess;
		now?: number;
		limit?: number;
	},
): Promise<GitHubChangesResult> {
	const now = options.now ?? Date.now();
	const limit = options.limit ?? GITHUB_CHANGE_READ_LIMIT;
	const { access } = options;
	const cursorState = classifyCursor(options.since, now);

	if (cursorState.kind !== "live") {
		const cursor = encodeChangeCursor({
			version: await currentVersion(db),
			at: now,
		});
		return cursorState.kind === "stale"
			? { cursor, entities: [], expired: true }
			: { cursor, entities: [], expired: false };
	}
	const { since } = cursorState;

	const results = await db
		.select({
			version: githubChange.version,
			repo: githubChange.repo,
			entityKey: githubChange.entityKey,
			isPrivate: githubChange.isPrivate,
		})
		.from(githubChange)
		.where(gt(githubChange.version, since.version))
		.orderBy(githubChange.version)
		.limit(limit + 1);

	if (results.length > limit) {
		return {
			cursor: encodeChangeCursor({
				version: await currentVersion(db),
				at: now,
			}),
			entities: [],
			expired: true,
		};
	}

	if (results.length === 0) {
		// A cursor ahead of the table predates a reset, so changes since then
		// would be invisible to it.
		const version = await currentVersion(db);
		if (since.version > version) {
			return {
				cursor: encodeChangeCursor({ version, at: now }),
				entities: [],
				expired: true,
			};
		}
	}

	let lastVersion = since.version;
	const entities = new Set<string>();
	for (const row of results) {
		lastVersion = Math.max(lastVersion, row.version);
		if (!access.canRead(row.repo, row.isPrivate)) continue;
		const parsed = parseEntityKey(row.entityKey);
		if (!parsed) continue;
		if (access.watched !== "all" && !access.watched.has(row.repo)) {
			continue;
		}
		entities.add(row.entityKey);
	}

	return {
		cursor: encodeChangeCursor({ version: lastVersion, at: now }),
		entities: [...entities],
		expired: false,
	};
}

export async function sweepGitHubChanges(
	db: Database,
	options: {
		now?: number;
		batchSize?: number;
		maxBatches?: number;
	} = {},
): Promise<{ deleted: number; batches: number; complete: boolean }> {
	const now = options.now ?? Date.now();
	const batchSize = Math.min(
		options.batchSize ?? GITHUB_CHANGE_SWEEP_BATCH_SIZE,
		GITHUB_CHANGE_SWEEP_BATCH_SIZE,
	);
	const maxBatches = options.maxBatches ?? GITHUB_CHANGE_SWEEP_MAX_BATCHES;
	const cutoff = now - GITHUB_CHANGE_RETENTION_MS;

	let deleted = 0;
	let batches = 0;
	while (batches < maxBatches) {
		const stale = db
			.select({ repo: githubChange.repo, entityKey: githubChange.entityKey })
			.from(githubChange)
			.where(
				and(
					lt(githubChange.changedAt, cutoff),
					// The newest row stays, so the cursor never goes backwards.
					lt(githubChange.version, sql`(SELECT MAX(version) FROM github_change)`),
				),
			)
			.orderBy(githubChange.version)
			.limit(batchSize);
		const removed = await db
			.delete(githubChange)
			.where(
				sql`(${githubChange.repo}, ${githubChange.entityKey}) IN ${stale}`,
			)
			.returning({ version: githubChange.version });
		batches += 1;
		deleted += removed.length;
		if (removed.length < batchSize) {
			return { deleted, batches, complete: true };
		}
	}
	return { deleted, batches, complete: false };
}

export type DatabaseHealthReport = {
	sizeBytes: number | null;
	changeRows: number | null;
	alert: "change_table_growth" | null;
};

// A large change table means the sweeper is stuck.
export async function checkDatabaseHealth(
	db: Database,
	options: {
		maxExpectedChangeRows?: number;
		log?: (line: string) => void;
	} = {},
): Promise<DatabaseHealthReport> {
	const log = options.log ?? ((line: string) => console.warn(line));
	const [counted] = await db.select({ rows: count() }).from(githubChange);
	const changeRows = counted?.rows ?? null;
	const sizeBytes = await databaseSizeBytes(db);
	const alert =
		changeRows !== null &&
		changeRows > (options.maxExpectedChangeRows ?? GITHUB_CHANGE_MAX_EXPECTED_ROWS)
			? "change_table_growth"
			: null;

	if (alert) {
		log(JSON.stringify({ level: "warn", alert, sizeBytes, changeRows }));
	}
	return { sizeBytes, changeRows, alert };
}

export async function databaseSizeBytes(db: Database): Promise<number | null> {
	const [row] = await db
		.select({
			bytes: sql<string>`pg_database_size(current_database())`.mapWith(Number),
		})
		.from(sql`(SELECT 1) AS one`);
	return row && Number.isFinite(row.bytes) ? row.bytes : null;
}
