import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { getDb } from "#/db";
import { type TeamList, type TeamView, teamFromRow } from "./teams";

function record(row: unknown): Record<string, unknown> {
	return typeof row === "object" && row !== null ? { ...row } : {};
}

function rowsOf(result: unknown): unknown[] {
	const rows = record(result).rows;
	return Array.isArray(rows) ? rows : [];
}

/**
 * The reader's teams. Teams are the dashboard's tables, which the hub reads
 * and never writes or creates, so a database of the hub's own has none.
 */
export async function listTeams(userId: string): Promise<TeamList> {
	const db = getDb();
	const present = await db.execute(sql`
		SELECT to_regclass('public.teams') IS NOT NULL
			AND to_regclass('public.team_members') IS NOT NULL
			AND to_regclass('public.team_repos') IS NOT NULL
			AND to_regclass('public.subscriptions') IS NOT NULL AS present
	`);
	if (record(rowsOf(present)[0]).present !== true) {
		return { available: false, teams: [] };
	}
	const result = await db.execute(sql`
		SELECT t.id, t.name, m.role,
			t.personal_owner_id IS NOT NULL AS personal,
			s.tier, s.seats,
			(SELECT count(*)::int FROM team_members x WHERE x.team_id = t.id) AS members,
			(SELECT count(*)::int FROM team_repos r
				WHERE r.team_id = t.id AND r.removed_at IS NULL AND r.approved) AS repositories
		FROM teams t
		JOIN team_members m ON m.team_id = t.id
		LEFT JOIN subscriptions s ON s.team_id = t.id
		WHERE m.user_id = ${userId} AND t.deleting_at IS NULL
		ORDER BY t.personal_owner_id IS NULL, t.created_at
	`);
	const teams: TeamView[] = [];
	for (const row of rowsOf(result)) {
		const team = teamFromRow(record(row));
		if (team) teams.push(team);
	}
	return { available: true, teams };
}
