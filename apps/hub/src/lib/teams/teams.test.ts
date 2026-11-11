import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "#/db";
import * as schema from "#/db/schema";
import { createTestDatabase } from "#/lib/testing/postgres";
import { createTestPlatform } from "#/platform/testing";
import { teamFromRow, teamSummary } from "./teams";

vi.mock("#/platform", () => ({ platform: createTestPlatform().platform }));

const database: { current: Database | null } = { current: null };

vi.mock("#/db", async (original) => ({
	...(await original<typeof import("#/db")>()),
	getDb: () => {
		if (!database.current) throw new Error("no test database");
		return database.current;
	},
}));

const DASHBOARD_MIGRATIONS = new URL(
	"../../../../dashboard/db/migrations/",
	import.meta.url,
);

describe("teamFromRow", () => {
	it("reads a row and falls back where a value is new to it", () => {
		expect(
			teamFromRow({
				id: "t1",
				name: "Lumen",
				role: "admin",
				personal: false,
				tier: "galactic",
				seats: 5,
				members: "3",
				repositories: 2,
			}),
		).toEqual({
			id: "t1",
			name: "Lumen",
			role: "admin",
			personal: false,
			tier: "free",
			seats: 5,
			members: 3,
			repositories: 2,
		});
	});

	it("drops a row whose role it does not know", () => {
		expect(teamFromRow({ id: "t1", name: "Lumen", role: "owner" })).toBeNull();
	});
});

describe("teamSummary", () => {
	it("says the plan, the seats and the repositories", () => {
		const team = {
			id: "t1",
			name: "Lumen",
			role: "member" as const,
			personal: false,
			tier: "team" as const,
			seats: 5,
			members: 1,
			repositories: 1,
		};
		expect(teamSummary(team)).toBe("Team · 1 member of 5 seats · 1 repository");
		expect(teamSummary({ ...team, personal: true, tier: "free" })).toBe(
			"Free · Only you · 1 repository",
		);
	});
});

describe("listTeams", () => {
	it("says there are none where the database holds no team tables", async () => {
		database.current = (await createTestDatabase()).db;
		const { listTeams } = await import("./teams.server");
		expect(await listTeams("u1")).toEqual({ available: false, teams: [] });
	});

	describe("beside the dashboard", () => {
		beforeAll(async () => {
			const client = new PGlite();
			for (const file of readdirSync(DASHBOARD_MIGRATIONS)
				.filter((name) => name.endsWith(".sql"))
				.sort()) {
				await client.exec(
					readFileSync(new URL(file, DASHBOARD_MIGRATIONS), "utf8"),
				);
			}
			await client.exec(`
				INSERT INTO users(id, name, email) VALUES
					('u1', 'Ada', 'ada@example.com'), ('u2', 'Bo', 'bo@example.com');
				INSERT INTO teams(id, name, personal_owner_id, created_at) VALUES
					('p1', 'Ada workspace', 'u1', '2026-01-02'),
					('t1', 'Lumen', NULL, '2026-01-01'),
					('t2', 'Going away', NULL, '2026-01-03'),
					('t3', 'Not mine', NULL, '2026-01-04');
				UPDATE teams SET deleting_at = now() WHERE id = 't2';
				INSERT INTO team_members(team_id, user_id, role) VALUES
					('p1', 'u1', 'admin'), ('t1', 'u1', 'member'), ('t1', 'u2', 'admin'),
					('t2', 'u1', 'admin'), ('t3', 'u2', 'admin');
				INSERT INTO subscriptions(team_id, tier, seats) VALUES
					('p1', 'free', 1), ('t1', 'team', 5);
				INSERT INTO team_repos(id, team_id, provider, host, external_id, owner, name, removed_at, approved) VALUES
					('r1', 't1', 'github', 'github.com', '1', 'lumen', 'a', NULL, true),
					('r2', 't1', 'github', 'github.com', '2', 'lumen', 'b', now(), true),
					('r3', 't1', 'github', 'github.com', '3', 'lumen', 'c', NULL, false);
			`);
			database.current = drizzle(client, { schema });
		});

		it("lists the reader's teams, their own workspace first", async () => {
			const { listTeams } = await import("./teams.server");
			const list = await listTeams("u1");
			expect(list.available).toBe(true);
			expect(list.teams).toEqual([
				{
					id: "p1",
					name: "Ada workspace",
					role: "admin",
					personal: true,
					tier: "free",
					seats: 1,
					members: 1,
					repositories: 0,
				},
				{
					id: "t1",
					name: "Lumen",
					role: "member",
					personal: false,
					tier: "team",
					seats: 5,
					members: 2,
					repositories: 1,
				},
			]);
		});
	});
});
