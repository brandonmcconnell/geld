import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkDatabaseHealth,
	recordGitHubChanges,
	sweepGitHubChanges,
} from "./github-change.server";
import { runScheduledMaintenance } from "./scheduled-maintenance.server";
import { createTestDatabase } from "./testing/postgres";

const NOW = 1_800_000_000_000;

afterEach(() => {
	vi.restoreAllMocks();
});

function quiet() {
	return vi.spyOn(console, "log").mockImplementation(() => undefined);
}

describe("runScheduledMaintenance", () => {
	it("sweeps expired entities, keeps fresh ones and logs one JSON line", async () => {
		const log = quiet();
		const { db } = await createTestDatabase();
		await recordGitHubChanges(db, [
			{
				repo: "a/b",
				entityKey: "repo:a/b",
				isPrivate: true,
				changedAt: NOW - 16 * 60_000,
			},
			{
				repo: "a/b",
				entityKey: "repo:a/b",
				isPrivate: true,
				changedAt: NOW - 20 * 60_000,
			},
			{
				repo: "a/b",
				entityKey: "pull:a/b#1",
				isPrivate: true,
				changedAt: NOW - 60_000,
			},
		]);

		const summary = await runScheduledMaintenance(db, NOW);

		expect(summary).toMatchObject({
			task: "scheduled-maintenance",
			scheduledTime: NOW,
			sweep: { deleted: 1, batches: 1, complete: true },
			changeRows: 1,
		});
		expect(typeof summary.databaseSizeBytes).toBe("number");
		expect(log).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual(summary);
	});

	it("reports a failing task in the log line and never lets it stop the other", async () => {
		quiet();
		const { db } = await createTestDatabase();
		const down = async () => {
			throw new Error("connection unavailable");
		};

		const sweepDown = await runScheduledMaintenance(db, NOW, {
			sweep: down,
			health: checkDatabaseHealth,
		});
		expect(sweepDown.sweepError).toContain("unavailable");
		expect(sweepDown.changeRows).toBe(0);

		const healthDown = await runScheduledMaintenance(db, NOW, {
			sweep: sweepGitHubChanges,
			health: down,
		});
		expect(healthDown.healthError).toContain("unavailable");
		expect(healthDown.sweep).toMatchObject({ complete: true });

		const bothDown = await runScheduledMaintenance(db, NOW, {
			sweep: down,
			health: down,
		});
		expect(bothDown.sweepError).toBeDefined();
		expect(bothDown.healthError).toBeDefined();
	});
});
