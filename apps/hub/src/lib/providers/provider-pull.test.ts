import { parseUnifiedDiff } from "@geld/core/diff-parse";
import { createMatcher } from "@geld/core/matcher";
import { DEFAULT_SETTINGS } from "@geld/core/settings";
import type { ProviderClient, ProviderThread, PullDetail } from "@geld/domain";
import { describe, expect, it, vi } from "vitest";
import { createTestPlatform } from "#/platform/testing";
import {
	MAX_DIFF_CHARS,
	providerPullView,
	repositoryParts,
} from "./provider-pull";

vi.mock("#/platform", () => ({ platform: createTestPlatform().platform }));
vi.mock("../geld/settings.server", () => ({
	readGeldSettings: async () => ({ settings: DEFAULT_SETTINGS }),
}));
vi.mock("./connections.server", () => ({ providerClientFor: async () => null }));

const input = {
	provider: "gitlab" as const,
	repository: "lumen/platform/gateway",
	number: 42,
};

const detail: PullDetail = {
	ref: {
		provider: "gitlab",
		host: "gitlab.com",
		owner: "lumen/platform",
		repo: "gateway",
		number: 42,
	},
	id: "1",
	title: "Retry idempotent requests",
	author: "nova",
	authorAvatar: null,
	state: "open",
	draft: false,
	updatedAt: "2026-11-01T00:00:00Z",
	url: "https://gitlab.com/lumen/platform/gateway/-/merge_requests/42",
	headSha: "a",
	baseSha: "b",
	additions: 0,
	deletions: 0,
	labels: ["backend"],
	reviewers: [],
	headBranch: "retry",
	body: "Retries.",
	capabilities: ["read"],
};

const DIFF = [
	"diff --git a/src/retry.ts b/src/retry.ts",
	"--- a/src/retry.ts",
	"+++ b/src/retry.ts",
	"@@ -1,2 +1,3 @@",
	" const a = 1;",
	"-const b = 2;",
	"+const b = 3;",
	"+const c = 4;",
	"diff --git a/src/retry.test.ts b/src/retry.test.ts",
	"new file mode 100644",
	"--- /dev/null",
	"+++ b/src/retry.test.ts",
	"@@ -0,0 +1,2 @@",
	"+test('a', () => {});",
	"+test('b', () => {});",
	"",
].join("\n");

const threads: ProviderThread[] = [
	{
		id: "t1",
		path: "src/retry.ts",
		line: 3,
		resolved: false,
		outdated: false,
		comments: [
			{ id: "c1", author: "sam", body: "Why  three?\n\nSeems high.", path: null, line: null, url: "https://gitlab.com/x#note_1" },
			{ id: "c2", author: "nova", body: "Fair.", path: null, line: null, url: "" },
		],
	},
	{ id: "t2", path: null, line: null, resolved: true, outdated: false, comments: [] },
];

const matcher = createMatcher(DEFAULT_SETTINGS, input.repository);

describe("repositoryParts", () => {
	it("keeps a nested group as the owner", () => {
		expect(repositoryParts("lumen/platform/gateway")).toEqual({
			owner: "lumen/platform",
			repo: "gateway",
		});
		expect(repositoryParts("gateway")).toBeNull();
		expect(repositoryParts("lumen/")).toBeNull();
	});
});

describe("providerPullView", () => {
	it("splits the files into what to review and what Geld sets aside", () => {
		const view = providerPullView(input, detail, parseUnifiedDiff(DIFF), threads, matcher);
		expect(view.diff).toBe("read");
		expect(view.files).toEqual([
			{ path: "src/retry.ts", additions: 2, deletions: 1, status: "modified", category: null },
			{ path: "src/retry.test.ts", additions: 2, deletions: 0, status: "added", category: "Tests" },
		]);
		expect(view.toReview).toEqual({ files: 1, additions: 2, deletions: 1 });
		expect(view.setAside).toEqual([{ category: "Tests", files: 1, lines: 2 }]);
	});

	it("shows a thread by its first comment and drops one with none", () => {
		const view = providerPullView(input, detail, [], threads, matcher);
		expect(view.threads).toEqual([
			{
				id: "t1",
				path: "src/retry.ts",
				line: 3,
				resolved: false,
				outdated: false,
				author: "sam",
				excerpt: "Why three? Seems high.",
				replies: 1,
				url: "https://gitlab.com/x#note_1",
			},
		]);
	});

	it("says why there are no files, and that threads were not listed", () => {
		const view = providerPullView(input, detail, "too-large", null, matcher);
		expect(view.diff).toBe("too-large");
		expect(view.files).toEqual([]);
		expect(view.threads).toBeNull();
	});
});

function client(overrides: Partial<ProviderClient>): ProviderClient {
	const unsupported = async () => ({ ok: false as const, reason: "unsupported" as const });
	return {
		provider: "gitlab",
		repositories: unsupported,
		pulls: unsupported,
		pull: async () => ({ ok: true, value: detail }),
		diff: async () => ({ ok: true, value: DIFF }),
		comments: unsupported,
		comment: unsupported,
		lineComment: unsupported,
		review: unsupported,
		threads: async () => ({ ok: true, value: threads }),
		reply: unsupported,
		resolve: unsupported,
		requestReviewers: unsupported,
		...overrides,
	};
}

describe("readProviderPull", () => {
	it("asks the provider for the nested repository and builds the page", async () => {
		const { readProviderPull } = await import("./provider-pull.server");
		const pull = vi.fn(async () => ({ ok: true as const, value: detail }));
		const result = await readProviderPull("u1", input, async () => client({ pull }));
		expect(pull).toHaveBeenCalledWith({
			provider: "gitlab",
			host: "gitlab.com",
			owner: "lumen/platform",
			repo: "gateway",
			number: 42,
		});
		expect(result.ok && result.pull.files.length).toBe(2);
	});

	it("says which way it failed", async () => {
		const { readProviderPull } = await import("./provider-pull.server");
		expect(await readProviderPull("u1", input, async () => null)).toEqual({
			ok: false,
			reason: "not-connected",
		});
		expect(
			await readProviderPull("u1", input, async () =>
				client({ pull: async () => ({ ok: false, reason: "signed_out" }) }),
			),
		).toEqual({ ok: false, reason: "reconnect" });
		expect(
			await readProviderPull("u1", input, async () =>
				client({ pull: async () => ({ ok: false, reason: "not_found" }) }),
			),
		).toEqual({ ok: false, reason: "not-found" });
		expect(
			await readProviderPull("u1", { ...input, repository: "gateway" }, async () => client({})),
		).toEqual({ ok: false, reason: "not-found" });
	});

	it("still shows the pull request when the diff is too large or the threads fail", async () => {
		const { readProviderPull } = await import("./provider-pull.server");
		const result = await readProviderPull("u1", input, async () =>
			client({
				diff: async () => ({ ok: true, value: "x".repeat(MAX_DIFF_CHARS + 1) }),
				threads: async () => ({ ok: false, reason: "unavailable" }),
			}),
		);
		expect(result).toMatchObject({
			ok: true,
			pull: { diff: "too-large", files: [], threads: null },
		});
	});
});
