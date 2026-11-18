import { describe, expect, it } from "vitest";
import { checkHealth, healthResponse } from "./health.server";
import { createTestDatabase } from "./testing/postgres";

describe("health check", () => {
	it("answers 503 with the failing dependency's details while the rest stay ok", async () => {
		const { db } = await createTestDatabase();
		const cache = {
			get: async (): Promise<string | null> => {
				throw new Error("cache read failed: 503 Service Unavailable");
			},
		};

		const response = healthResponse(await checkHealth({ db, cache }));

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			status: "degraded",
			version: { status: "unknown" },
			checks: {
				database: { status: "ok" },
				cache: {
					status: "failed",
					error: "cache read failed: 503 Service Unavailable",
				},
			},
			maintenance: { status: "unreadable" },
		});
	});
});
