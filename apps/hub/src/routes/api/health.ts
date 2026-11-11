import { createFileRoute } from "@tanstack/react-router";
import { PRIVATE_ROUTE_HEADERS } from "#/lib/seo";

/**
 * GET /api/health: unauthenticated liveness for the deploy gate and uptime
 * checks. 200 when the database and cache answer, 503 with per-check details otherwise.
 */
export const Route = createFileRoute("/api/health")({
	headers: () => PRIVATE_ROUTE_HEADERS,
	server: {
		handlers: {
			GET: async () => {
				const [{ platform }, { getDb }, health] = await Promise.all([
					import("#/platform"),
					import("#/db"),
					import("#/lib/health.server"),
				]);
				const report = await health.checkHealth({
					db: getDb(),
					cache: platform.cache(),
					version: platform.config().version,
				});
				return health.healthResponse(report);
			},
		},
	},
});
