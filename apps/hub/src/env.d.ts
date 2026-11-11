// Bindings named in void.config.ts and the values declared in env.ts. Only
// src/platform/cloudflare/ and the Worker entry read them.

declare namespace Cloudflare {
	interface Env {
		/** Postgres through Hyperdrive. Absent under `vite dev`, which uses DATABASE_URL. */
		HYPERDRIVE?: Hyperdrive;
		DATABASE_URL?: string;
		CACHE_KV: KVNamespace;
		LIVE_ROOM: DurableObjectNamespace<
			import("./platform/cloudflare/live-room").LiveRoomObject
		>;
		RATE_LIMITER: DurableObjectNamespace<
			import("./platform/cloudflare/rate-limiter").RateLimiterObject
		>;
		CF_VERSION_METADATA?: WorkerVersionMetadata;
		FILES_S3_BUCKET_URL?: string;
		FILES_S3_REGION?: string;
		FILES_S3_ACCESS_KEY_ID?: string;
		FILES_S3_SECRET_ACCESS_KEY?: string;
		/** Public base URL the files bucket is served from. */
		FILES_PUBLIC_BASE_URL?: string;
		GITHUB_OAUTH_CLIENT_ID?: string;
		GITHUB_OAUTH_CLIENT_SECRET?: string;
		GITHUB_APP_CLIENT_ID?: string;
		GITHUB_APP_CLIENT_SECRET?: string;
		GITHUB_APP_ID?: string;
		GITHUB_APP_PRIVATE_KEY?: string;
		GITHUB_APP_SLUG?: string;
		GITHUB_WEBHOOK_SECRET?: string;
		GITHUB_CLIENT_ID?: string;
		GITHUB_CLIENT_SECRET?: string;
		BETTER_AUTH_SECRET: string;
		BETTER_AUTH_URL: string;
		/** Local demo mode only: base URL of `apps/hub-emulator` (e.g. http://localhost:4200). */
		GITHUB_EMULATOR_URL?: string;
	}
}
