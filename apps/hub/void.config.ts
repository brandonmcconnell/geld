import { defineConfig } from "void/config";

// The Worker and its bindings; cron schedules live in crons/.
//
// A new instance leaves the GELD_HUB_* variables unset: `void deploy` creates
// the KV namespace and the Hyperdrive configuration (from DATABASE_URL in the
// shell) in your account and records them in void.lock.json. An instance with
// existing resources pins both on every deploy.
const PINNED_RESOURCE_VARS = [
	"GELD_HUB_HYPERDRIVE_ID",
	"GELD_HUB_KV_ID",
] as const;

function pinnedResources() {
	const missing = PINNED_RESOURCE_VARS.filter((name) => !process.env[name]);
	if (missing.length === PINNED_RESOURCE_VARS.length) {
		return {};
	}
	if (missing.length > 0) {
		throw new Error(
			`Set all of ${PINNED_RESOURCE_VARS.join(", ")} or none of them. Missing: ${missing.join(", ")}.`,
		);
	}
	return {
		hyperdrive: [
			{ binding: "HYPERDRIVE", id: process.env.GELD_HUB_HYPERDRIVE_ID },
		],
		kv_namespaces: [{ binding: "CACHE_KV", id: process.env.GELD_HUB_KV_ID }],
	};
}

// Serve the Worker on a domain in your Cloudflare account. Void manages the
// route, so set it on every deploy once you use one.
function customDomain() {
	const domain = process.env.GELD_HUB_DOMAIN;
	return domain ? { routes: [{ pattern: domain, custom_domain: true }] } : {};
}

export default defineConfig({
	// Postgres through Hyperdrive; `vite dev` connects to DATABASE_URL directly.
	database: "pg",
	inference: {
		bindings: {
			kv: "CACHE_KV",
			// Files go through the S3 API, so no bucket is bound.
			storage: false,
			ai: false,
		},
	},
	worker: {
		compatibility_date: "2025-09-02",
		compatibility_flags: [
			"nodejs_compat",
			"no_handle_cross_request_promise_resolution",
		],
	},
	cloudflare: {
		name: "geld-hub",
		main: "./src/entry-worker.ts",
		workers_dev: true,
		preview_urls: true,
		...customDomain(),
		observability: {
			logs: { enabled: true, invocation_logs: true },
			traces: { enabled: false },
		},
		// /api/health reports the serving version from this binding.
		version_metadata: { binding: "CF_VERSION_METADATA" },
		durable_objects: {
			bindings: [
				{ name: "LIVE_ROOM", class_name: "LiveRoomObject" },
				{ name: "RATE_LIMITER", class_name: "RateLimiterObject" },
			],
		},
		migrations: [
			{
				tag: "v1",
				new_sqlite_classes: ["LiveRoomObject", "RateLimiterObject"],
			},
		],
		...pinnedResources(),
	},
});
