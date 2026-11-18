import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPlatform } from "#/platform/testing";

const testPlatform = createTestPlatform();
const kv = testPlatform.cache;
const appAuth = vi.fn();
const octokitAuths: unknown[] = [];

const hour = 60 * 60 * 1000;
const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();
const KEY = "github-installation-token:v1:987";

function storedEntry(overrides: Record<string, unknown> = {}) {
	return {
		installationId: 987,
		token: "kv-token",
		expiresAt: inFuture(hour),
		cachedAt: Date.now(),
		...overrides,
	};
}

async function load() {
	vi.resetModules();
	vi.doMock("#/platform", () => ({ platform: testPlatform.platform }));
	vi.doMock("octokit", () => {
		const Octokit = Object.assign(
			vi.fn(function Octokit(options: { auth: unknown }) {
				octokitAuths.push(options.auth);
				return { hook: { before: vi.fn(), after: vi.fn(), error: vi.fn() } };
			}),
			{ defaults: () => Octokit },
		);
		return {
			Octokit,
			App: vi.fn(function App() {
				return {
					octokit: {
						auth: appAuth,
						hook: { before: vi.fn(), after: vi.fn(), error: vi.fn() },
					},
				};
			}),
		};
	});
	vi.doMock("./github-app.server", () => ({
		getGitHubAccessTokenByUserId: vi.fn(),
		getGitHubAppId: () => "12345",
		getGitHubAppPrivateKey: () => "private-key",
	}));
	vi.doMock("./github-emulator.server", () => ({
		getGitHubEmulatorAppPrivateKey: () => Promise.resolve(null),
		getGitHubOctokitBaseOptions: () => ({}),
	}));
	vi.doMock("./github-request-policy", () => ({
		configureGitHubRequestPolicies: vi.fn(),
	}));
	return import("./github.server");
}

beforeEach(() => {
	octokitAuths.length = 0;
	testPlatform.reset();
	appAuth.mockReset().mockImplementation(async () => ({
		token: `minted-${appAuth.mock.calls.length}`,
		expiresAt: inFuture(hour),
	}));
});

describe("installation token cache", () => {
	it("stores a minted token in the cache with a TTL shorter than its life", async () => {
		const { getGitHubInstallationClient } = await load();
		await getGitHubInstallationClient(987);

		expect(octokitAuths).toEqual(["minted-1"]);
		const [key, , options] = kv.put.mock.calls[0];
		expect(key).toBe(KEY);
		expect(options?.ttlSeconds).toBeGreaterThan(3200);
		expect(options?.ttlSeconds).toBeLessThanOrEqual(3300);
	});

	it("uses a fresh token another isolate stored in the cache", async () => {
		kv.get.mockResolvedValue(JSON.stringify(storedEntry()));
		const { getGitHubInstallationClient } = await load();
		await getGitHubInstallationClient(987);
		expect(octokitAuths).toEqual(["kv-token"]);
		expect(appAuth).not.toHaveBeenCalled();
	});

	it("ignores cache entries that are stale, for another installation, or malformed", async () => {
		const unusable = [
			storedEntry({ expiresAt: inFuture(2 * 60 * 1000) }),
			storedEntry({ installationId: 1 }),
			storedEntry({ token: 5 }),
			"garbage",
		].map((stored) => JSON.stringify(stored));
		unusable.push("{not json");
		for (const stored of unusable) {
			kv.get.mockResolvedValue(stored);
			appAuth.mockClear();
			const { getGitHubInstallationClient } = await load();
			await getGitHubInstallationClient(987);
			expect(appAuth, stored).toHaveBeenCalledTimes(1);
		}
	});

	it("treats cache read and write failures as cache misses", async () => {
		kv.get.mockRejectedValue(new Error("cache unavailable"));
		kv.put.mockRejectedValue(new Error("cache unavailable"));
		const { getGitHubInstallationClient } = await load();
		await expect(getGitHubInstallationClient(987)).resolves.toBeDefined();
		expect(octokitAuths).toEqual(["minted-1"]);
	});

	it("shares one mint between concurrent callers", async () => {
		const { getGitHubInstallationClient } = await load();
		await Promise.all([
			getGitHubInstallationClient(987),
			getGitHubInstallationClient(987),
			getGitHubInstallationClient(987),
		]);
		expect(appAuth).toHaveBeenCalledTimes(1);
	});
});

describe("invalidateGitHubInstallationToken", () => {
	it("deletes the cache entry, forces a new mint and tolerates the cache being down", async () => {
		const { getGitHubInstallationClient, invalidateGitHubInstallationToken } =
			await load();
		await getGitHubInstallationClient(987);
		await invalidateGitHubInstallationToken(987);
		await getGitHubInstallationClient(987);
		expect(kv.delete).toHaveBeenCalledWith(KEY);
		expect(appAuth).toHaveBeenCalledTimes(2);

		kv.delete.mockRejectedValue(new Error("cache unavailable"));
		await expect(
			invalidateGitHubInstallationToken(987),
		).resolves.toBeUndefined();
	});

	it("does not cache a token that was minted before the invalidation", async () => {
		let release: () => void = () => undefined;
		appAuth.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () =>
						resolve({ token: "stale-mint", expiresAt: inFuture(hour) });
				}),
		);
		const { getGitHubInstallationClient, invalidateGitHubInstallationToken } =
			await load();

		const inflight = getGitHubInstallationClient(987);
		await vi.waitFor(() => expect(appAuth).toHaveBeenCalled());
		await invalidateGitHubInstallationToken(987);
		release();
		await inflight;

		expect(kv.put).not.toHaveBeenCalled();
		await getGitHubInstallationClient(987);
		expect(appAuth).toHaveBeenCalledTimes(2);
	});
});
