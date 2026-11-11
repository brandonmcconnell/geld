/**
 * What the app asks of the platform it runs on. Everything outside
 * `src/platform/cloudflare/` and the Worker entry talks to these shapes only,
 * so another host is a second set of implementations, never a rewrite.
 */

/** Values read once from the environment. Secrets stay strings; nothing here is a binding. */
export type AppConfig = {
	/** Postgres connection string. On Cloudflare it is Hyperdrive's. */
	databaseUrl: string | null;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	GITHUB_OAUTH_CLIENT_ID?: string;
	GITHUB_OAUTH_CLIENT_SECRET?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	GITHUB_APP_ID?: string;
	GITHUB_APP_SLUG?: string;
	GITHUB_APP_CLIENT_ID?: string;
	GITHUB_APP_CLIENT_SECRET?: string;
	GITHUB_APP_PRIVATE_KEY?: string;
	GITHUB_WEBHOOK_SECRET?: string;
	GITLAB_CLIENT_ID?: string;
	GITLAB_CLIENT_SECRET?: string;
	BITBUCKET_CLIENT_ID?: string;
	BITBUCKET_CLIENT_SECRET?: string;
	/** Local demo mode only. */
	GITHUB_EMULATOR_URL?: string;
	files: FileStoreConfig | null;
	version: DeployedVersion | null;
};

/** An S3-compatible bucket, reached over the S3 API on every host. */
export type FileStoreConfig = {
	/** Bucket URL, path style: `https://<account>.r2.cloudflarestorage.com/<bucket>`. */
	bucketUrl: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** Where uploaded objects are served from, no trailing slash. */
	publicBaseUrl: string;
};

export type DeployedVersion = { id: string; tag: string; uploadedAt: string };

/** A small key-value cache. Values are strings; callers own their encoding. */
export type Cache = {
	get(key: string): Promise<string | null>;
	put(
		key: string,
		value: string,
		options?: { ttlSeconds?: number },
	): Promise<void>;
	delete(key: string): Promise<void>;
};

/** Work handed off the request path. Messages must be JSON-serialisable. */
export type Queue<Message> = {
	send(message: Message, options?: { delaySeconds?: number }): Promise<void>;
};

/** Live fan-out: every client connected to a room hears what is broadcast to it. */
export type LiveRooms = {
	/** Answers a WebSocket upgrade request by joining the room. */
	connect(room: string, request: Request): Promise<Response>;
	broadcast(room: string, message: string): Promise<void>;
};

export type RateLimitRule = {
	/** Calls allowed to be in flight at once. */
	maxConcurrent: number;
	/** Calls allowed to start per window. */
	perWindow?: { limit: number; windowMs: number };
	/** A lease not released by then is taken back. */
	leaseMs?: number;
};

export type RateLimitDecision =
	| { ok: true; lease: string }
	| { ok: false; retryAfterMs: number };

/**
 * One limiter per key (a provider installation). `acquire` before a call,
 * `release` after it, and `schedule` when the provider says when it will
 * take calls again.
 */
export type RateLimiter = {
	acquire(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
	release(key: string, lease: string): Promise<void>;
	/** No call for this key starts before `resumeAt` (epoch milliseconds). */
	schedule(key: string, resumeAt: number): Promise<void>;
};

/** Keeps `work` running after the response has gone out. */
export type RunAfterResponse = (work: Promise<unknown>) => void;

export type Platform = {
	config(): AppConfig;
	cache(): Cache;
	queue<Message>(name: string): Queue<Message>;
	liveRooms(): LiveRooms;
	rateLimiter(): RateLimiter;
	runAfterResponse: RunAfterResponse;
};
