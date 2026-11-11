import type { Database } from "#/db";
import { checkDatabaseHealth, sweepGitHubChanges } from "./github-change.server";
import { describeError } from "./route-safety.server";

type TaskResult<T> =
	| { status: "ok"; value: T }
	| { status: "failed"; error: string };

async function runTask<T>(task: () => Promise<T>): Promise<TaskResult<T>> {
	try {
		return { status: "ok", value: await task() };
	} catch (error) {
		return { status: "failed", error: describeError(error).message };
	}
}

// One JSON line per run, so the log charts sweeps and alerts on `alert`.
// A failing task is reported in the line and never stops the other one.
export async function runScheduledMaintenance(
	db: Database,
	scheduledTime = Date.now(),
	tasks = { sweep: sweepGitHubChanges, health: checkDatabaseHealth },
) {
	const sweep = await runTask(() => tasks.sweep(db, { now: scheduledTime }));
	const health = await runTask(() => tasks.health(db));

	const summary: Record<string, unknown> = {
		task: "scheduled-maintenance",
		scheduledTime,
		...(sweep.status === "ok"
			? { sweep: sweep.value }
			: { sweepError: sweep.error }),
		...(health.status === "ok"
			? {
					databaseSizeBytes: health.value.sizeBytes,
					changeRows: health.value.changeRows,
				}
			: { healthError: health.error }),
	};

	console.log(JSON.stringify(summary));
	return summary;
}
