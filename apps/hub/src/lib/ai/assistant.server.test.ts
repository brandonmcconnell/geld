import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "#/db";
import { aiProvider, user } from "#/db/schema";
import { createTestDatabase } from "#/lib/testing/postgres";
import { createTestPlatform } from "#/platform/testing";
import type { AssistantContext } from "./assistant";

const testPlatform = createTestPlatform({
	TOKEN_ENCRYPTION_KEY: "a-token-encryption-key-of-32-chars-or-more",
});
const database: { current: Database | null } = { current: null };

vi.mock("#/platform", () => ({ platform: testPlatform.platform }));
vi.mock("#/db", async (original) => ({
	...(await original<typeof import("#/db")>()),
	getDb: () => {
		if (!database.current) throw new Error("no test database");
		return database.current;
	},
}));

const context: AssistantContext = {
	repository: "acme/app",
	number: 7,
	title: "Add retries",
	body: "Retries the upload.",
	files: [
		{ path: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "+a" },
	],
	partial: false,
};

const allowed = async () => ({ allowed: true as const });

async function addProvider(
	overrides: Partial<{
		provider: "gateway" | "claude";
		baseUrl: string;
		models: string[];
		enabled: boolean;
	}> = {},
) {
	const { saveAiProvider } = await import("./providers.server");
	const result = await saveAiProvider("u1", {
		provider: "gateway",
		label: "Team gateway",
		baseUrl: "https://ai-gateway.vercel.sh",
		key: "sk-secret-value",
		enabled: true,
		models: ["a/model"],
		...overrides,
	});
	expect(result.ok).toBe(true);
}

beforeAll(async () => {
	database.current = (await createTestDatabase()).db;
	await database.current
		.insert(user)
		.values([{ id: "u1", name: "Ada", email: "ada@example.com" }]);
});

beforeEach(async () => {
	await database.current?.delete(aiProvider);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("askPullAssistant", () => {
	it("asks for a provider before reading anything", async () => {
		const { askPullAssistant } = await import("./assistant.server");
		const policy = vi.fn(allowed);
		const loadContext = vi.fn(async () => context);
		const answer = await askPullAssistant({
			userId: "u1",
			question: "Why?",
			policy,
			loadContext,
		});
		expect(answer).toMatchObject({ ok: false, setup: true });
		expect(policy).not.toHaveBeenCalled();
		expect(loadContext).not.toHaveBeenCalled();
	});

	it("passes over a provider that is off or lists no model", async () => {
		await addProvider({ enabled: false });
		const { askPullAssistant } = await import("./assistant.server");
		const answer = await askPullAssistant({
			userId: "u1",
			question: "Why?",
			policy: allowed,
			loadContext: async () => context,
		});
		expect(answer).toMatchObject({ ok: false, setup: true });
	});

	it("sends nothing when the repository turns AI off", async () => {
		await addProvider();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { askPullAssistant } = await import("./assistant.server");
		const loadContext = vi.fn(async () => context);
		const answer = await askPullAssistant({
			userId: "u1",
			question: "Why?",
			policy: async () => ({ allowed: false, reason: "disabled" }),
			loadContext,
		});
		expect(answer.ok).toBe(false);
		expect(loadContext).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("sends the pull request to the saved address with the opened key", async () => {
		await addProvider();
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
			Response.json({
				model: "a/model",
				choices: [{ message: { content: "It adds retries." } }],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { askPullAssistant } = await import("./assistant.server");
		const answer = await askPullAssistant({
			userId: "u1",
			question: " What changed? ",
			policy: allowed,
			loadContext: async () => context,
		});
		expect(answer).toEqual({
			ok: true,
			text: "It adds retries.",
			model: "a/model",
			provider: "Team gateway",
		});
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
		expect(init?.redirect).toBe("error");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer sk-secret-value",
		);
		expect(String(init?.body)).toContain("acme/app#7: Add retries");
		expect(String(init?.body)).toContain("What changed?");
	});

	it("speaks the messages API to a Claude provider", async () => {
		await addProvider({
			provider: "claude",
			baseUrl: "https://api.anthropic.com",
			models: ["claude-sonnet-5-5"],
		});
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
			Response.json({
				model: "claude-sonnet-5-5",
				content: [{ type: "text", text: "It adds retries." }],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { askPullAssistant } = await import("./assistant.server");
		const answer = await askPullAssistant({
			userId: "u1",
			question: "What changed?",
			policy: allowed,
			loadContext: async () => context,
		});
		expect(answer).toMatchObject({ ok: true, text: "It adds retries." });
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe("https://api.anthropic.com/v1/messages");
		expect(new Headers(init?.headers).get("x-api-key")).toBe("sk-secret-value");
	});

	it("says so without the provider's words when the call fails", async () => {
		await addProvider();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("secret upstream detail", { status: 500 })),
		);
		const { askPullAssistant } = await import("./assistant.server");
		const answer = await askPullAssistant({
			userId: "u1",
			question: "Why?",
			policy: allowed,
			loadContext: async () => context,
		});
		expect(answer).toEqual({
			ok: false,
			error: "Team gateway did not answer. Try again.",
		});
	});
});
