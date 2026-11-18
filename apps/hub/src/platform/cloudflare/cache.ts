import { env } from "cloudflare:workers";
import type { Cache } from "../types";

// KV refuses a TTL under a minute.
const MIN_TTL_SECONDS = 60;

export function cache(): Cache {
	const kv = env.CACHE_KV;
	return {
		get: (key) => kv.get(key),
		put: (key, value, options) =>
			kv.put(
				key,
				value,
				options?.ttlSeconds === undefined
					? undefined
					: { expirationTtl: Math.max(MIN_TTL_SECONDS, options.ttlSeconds) },
			),
		delete: (key) => kv.delete(key),
	};
}
