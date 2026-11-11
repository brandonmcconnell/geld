/**
 * The platform the app runs on. Import it from here and nowhere else: the
 * files under `./cloudflare/` are the only ones that may touch a Cloudflare
 * API, and a build for another host points this at its own set.
 */
import { runAfterResponse } from "./cloudflare/background";
import { cache } from "./cloudflare/cache";
import { config } from "./cloudflare/config";
import { liveRooms } from "./cloudflare/live-room";
import { queue } from "./cloudflare/queue";
import { rateLimiter } from "./cloudflare/rate-limiter";
import type { Platform } from "./types";

export const platform: Platform = {
	config,
	cache,
	queue,
	liveRooms,
	rateLimiter,
	runAfterResponse,
};

export type {
	AppConfig,
	Cache,
	FileStoreConfig,
	LiveRooms,
	Platform,
	Queue,
	RateLimitDecision,
	RateLimiter,
	RateLimitRule,
	RunAfterResponse,
} from "./types";
