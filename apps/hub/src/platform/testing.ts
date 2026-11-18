import { vi } from "vitest";
import type { AppConfig, Cache, Platform } from "./types";

function notUsed(name: string): never {
	throw new Error(`platform.${name}() is not used in this test`);
}

/**
 * A platform for unit tests: an in-memory cache whose calls are spies, a
 * config object tests may change in place, and background work kept so a
 * test can wait for it.
 */
export function createTestPlatform(overrides: Partial<AppConfig> = {}) {
	const store = new Map<string, string>();
	const background: Promise<unknown>[] = [];
	const config: AppConfig = {
		databaseUrl: null,
		BETTER_AUTH_SECRET: "test-secret",
		BETTER_AUTH_URL: "https://geld.test",
		files: null,
		version: null,
		...overrides,
	};
	const cache = {
		get: vi.fn<Cache["get"]>(async (key) => store.get(key) ?? null),
		put: vi.fn<Cache["put"]>(async (key, value) => {
			store.set(key, value);
		}),
		delete: vi.fn<Cache["delete"]>(async (key) => {
			store.delete(key);
		}),
	};
	const runAfterResponse = vi.fn<Platform["runAfterResponse"]>((work) => {
		background.push(work);
	});
	const platform: Platform = {
		config: () => config,
		cache: () => cache,
		queue: () => notUsed("queue"),
		liveRooms: () => notUsed("liveRooms"),
		rateLimiter: () => notUsed("rateLimiter"),
		runAfterResponse,
	};

	return {
		platform,
		config,
		cache,
		store,
		runAfterResponse,
		settled: () => Promise.all(background),
		/** Empties the cache and puts every spy back on its in-memory behaviour. */
		reset() {
			store.clear();
			background.length = 0;
			cache.get.mockReset();
			cache.put.mockReset();
			cache.delete.mockReset();
			runAfterResponse.mockReset();
		},
	};
}
