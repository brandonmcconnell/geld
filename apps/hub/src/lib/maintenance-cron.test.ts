import { afterEach, expect, it, vi } from "vitest";

const runScheduledMaintenance = vi.hoisted(() => vi.fn());

const testPlatform = await vi.hoisted(async () => {
	const { createTestPlatform } = await import("#/platform/testing");
	return createTestPlatform();
});

vi.mock("#/platform", () => ({ platform: testPlatform.platform }));
vi.mock("#/db", () => ({
	getDb: vi.fn(),
	withRequestDatabase: (handle: () => Promise<unknown>) => handle(),
}));
vi.mock("#/lib/scheduled-maintenance.server", () => ({
	runScheduledMaintenance,
}));

const { default: maintenance } = await import("../../crons/maintenance");

afterEach(() => {
	vi.restoreAllMocks();
});

it("logs a failed run instead of rejecting, so a broken sweep cannot fail the cron", async () => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	runScheduledMaintenance.mockRejectedValue(new Error("database unavailable"));

	await expect(
		maintenance({
			scheduledTime: 1234,
			cron: "*/5 * * * *",
			noRetry: () => undefined,
		}),
	).resolves.toBeUndefined();
	expect(runScheduledMaintenance).toHaveBeenCalledTimes(1);
	expect(testPlatform.cache.put).not.toHaveBeenCalled();
	expect(console.error).toHaveBeenCalled();
});
