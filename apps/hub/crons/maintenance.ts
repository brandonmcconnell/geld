import { getDb, withRequestDatabase } from "#/db";
import { recordMaintenanceRun } from "#/lib/health.server";
import { logRouteError } from "#/lib/route-safety.server";
import { runScheduledMaintenance } from "#/lib/scheduled-maintenance.server";
import { platform } from "#/platform";

// Change-feed sweeper and database check. Void derives the Worker's cron
// trigger from this export.
export const cron = "*/5 * * * *";

export default async function maintenance(
	controller: ScheduledController,
): Promise<void> {
	try {
		await withRequestDatabase(async () => {
			const summary = await runScheduledMaintenance(
				getDb(),
				controller.scheduledTime,
			);
			await recordMaintenanceRun(platform.cache(), summary);
		});
	} catch (error) {
		logRouteError("worker", "scheduled maintenance failed", error);
	}
}
