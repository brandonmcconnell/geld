import type { Database } from "#/db";
import type { Cache } from "#/platform";
import { databaseSizeBytes } from "./github-change.server";

export type DependencyCheck<T = Record<never, never>> =
	| ({ status: "ok"; latencyMs: number } & T)
	| { status: "failed"; latencyMs: number; error: string };

export type MaintenanceRun =
	| {
			status: "recent" | "stale";
			lastRunAt: string;
			ageSeconds: number;
			result: MaintenanceResult;
	  }
	| { status: "never_recorded" }
	| { status: "unreadable" };

export type WorkerVersion =
	| { status: "known"; id: string; tag: string; uploadedAt: string }
	| { status: "unknown" };

export type HealthReport = {
	status: "ok" | "degraded";
	checkedAt: string;
	version: WorkerVersion;
	checks: {
		database: DependencyCheck<{ sizeBytes?: number }>;
		cache: DependencyCheck;
	};
	maintenance: MaintenanceRun;
};

type MaintenanceResult = "ok" | "errors";
type MaintenanceHeartbeat = { ranAt: number; result: MaintenanceResult };

const MAINTENANCE_HEARTBEAT_KEY = "health:maintenance-heartbeat";
const MAINTENANCE_HEARTBEAT_TTL_SECONDS = 24 * 60 * 60;
/** Two missed 5-minute cron runs plus scheduling slack. */
const MAINTENANCE_STALE_AFTER_MS = 12 * 60 * 1000;
const CHECK_TIMEOUT_MS = 5_000;

export async function recordMaintenanceRun(
	cache: Pick<Cache, "put">,
	summary: Record<string, unknown>,
	ranAt = Date.now(),
) {
	const heartbeat: MaintenanceHeartbeat = {
		ranAt,
		result:
			"sweepError" in summary || "healthError" in summary ? "errors" : "ok",
	};
	try {
		await cache.put(MAINTENANCE_HEARTBEAT_KEY, JSON.stringify(heartbeat), {
			ttlSeconds: MAINTENANCE_HEARTBEAT_TTL_SECONDS,
		});
	} catch (error) {
		console.warn("[health] maintenance heartbeat write failed", error);
	}
}

export async function checkHealth(deps: {
	db: Database;
	cache: Pick<Cache, "get">;
	version?: { id: string; tag: string; uploadedAt: string } | null;
	now?: number;
}): Promise<HealthReport> {
	const now = deps.now ?? Date.now();
	const [database, cacheRead] = await Promise.all([
		timedCheck(async () => {
			const sizeBytes = await databaseSizeBytes(deps.db);
			return sizeBytes === null ? {} : { sizeBytes };
		}),
		timedCheck(async () => ({
			heartbeat: parseHeartbeat(
				await deps.cache.get(MAINTENANCE_HEARTBEAT_KEY),
			),
		})),
	]);

	const checks = { database, cache: withoutValue(cacheRead) };
	return {
		status: overallStatus(checks),
		checkedAt: new Date(now).toISOString(),
		version: deps.version
			? { status: "known", ...deps.version }
			: { status: "unknown" },
		checks,
		maintenance: maintenanceRun(cacheRead, now),
	};
}

export function healthResponse(report: HealthReport) {
	return Response.json(report, {
		status: report.status === "ok" ? 200 : 503,
		headers: { "Cache-Control": "no-store" },
	});
}

function overallStatus(checks: HealthReport["checks"]): HealthReport["status"] {
	return Object.values(checks).every((check) => check.status === "ok")
		? "ok"
		: "degraded";
}

function parseHeartbeat(stored: string | null): MaintenanceHeartbeat | null {
	if (stored === null) return null;
	const value: unknown = JSON.parse(stored);
	if (
		typeof value !== "object" ||
		value === null ||
		!("ranAt" in value) ||
		typeof value.ranAt !== "number" ||
		!("result" in value)
	) {
		return null;
	}
	return { ranAt: value.ranAt, result: value.result === "ok" ? "ok" : "errors" };
}

function maintenanceRun(
	cacheRead: DependencyCheck<{ heartbeat: MaintenanceHeartbeat | null }>,
	now: number,
): MaintenanceRun {
	if (cacheRead.status === "failed") return { status: "unreadable" };
	if (!cacheRead.heartbeat) return { status: "never_recorded" };
	const { ranAt, result } = cacheRead.heartbeat;
	const ageMs = Math.max(0, now - ranAt);
	return {
		status: ageMs > MAINTENANCE_STALE_AFTER_MS ? "stale" : "recent",
		lastRunAt: new Date(ranAt).toISOString(),
		ageSeconds: Math.round(ageMs / 1000),
		result,
	};
}

function withoutValue(
	check: DependencyCheck<{ heartbeat: unknown }>,
): DependencyCheck {
	if (check.status === "failed") return check;
	return { status: "ok", latencyMs: check.latencyMs };
}

async function timedCheck<T extends object>(
	probe: () => Promise<T>,
): Promise<DependencyCheck<T>> {
	const startedAt = Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)),
			CHECK_TIMEOUT_MS,
		);
	});
	try {
		const value = await Promise.race([probe(), timeout]);
		return { status: "ok", latencyMs: Date.now() - startedAt, ...value };
	} catch (error) {
		return {
			status: "failed",
			latencyMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}
