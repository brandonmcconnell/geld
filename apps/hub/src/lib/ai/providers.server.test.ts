import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "#/db";
import { aiProvider, user } from "#/db/schema";
import { createTestDatabase } from "#/lib/testing/postgres";
import { createTestPlatform } from "#/platform/testing";

const KEY = "a-token-encryption-key-of-32-chars-or-more";
const testPlatform = createTestPlatform({ TOKEN_ENCRYPTION_KEY: KEY });
const database: { current: Database | null } = { current: null };

vi.mock("#/platform", () => ({ platform: testPlatform.platform }));
vi.mock("#/db", async (original) => ({
	...(await original<typeof import("#/db")>()),
	getDb: () => {
		if (!database.current) throw new Error("no test database");
		return database.current;
	},
}));

const input = {
	provider: "gateway" as const,
	label: "Team gateway",
	baseUrl: "https://ai-gateway.vercel.sh",
	key: "sk-secret-value",
	enabled: true,
	models: ["a/model"],
};

beforeAll(async () => {
	database.current = (await createTestDatabase()).db;
	await database.current.insert(user).values([
		{ id: "u1", name: "Ada", email: "ada@example.com" },
		{ id: "u2", name: "Bo", email: "bo@example.com" },
	]);
});

beforeEach(async () => {
	testPlatform.config.TOKEN_ENCRYPTION_KEY = KEY;
	await database.current?.delete(aiProvider);
});

function sealedByTheDashboard(value: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv(
		"aes-256-gcm",
		createHash("sha256").update(KEY).digest(),
		iv,
	);
	const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	return `v1.${iv.toString("base64url")}.${Buffer.concat([body, cipher.getAuthTag()]).toString("base64url")}`;
}

describe("provider keys", () => {
	it("open whichever app sealed them", async () => {
		const { openCredential, sealCredential } = await import(
			"./credentials.server"
		);
		expect(await openCredential(sealedByTheDashboard("sk-dash"))).toBe(
			"sk-dash",
		);
		const sealed = await sealCredential("sk-hub");
		expect(sealed).not.toContain("sk-hub");
		expect(await openCredential(sealed)).toBe("sk-hub");
		expect(await openCredential("v1.bad.bad")).toBeNull();
		expect(await openCredential("plain")).toBeNull();
	});
});

describe("saving a provider", () => {
	it("stores the key sealed and never lists it", async () => {
		const { listAiProviders, saveAiProvider } = await import(
			"./providers.server"
		);
		const { openCredential } = await import("./credentials.server");

		const saved = await saveAiProvider("u1", input);
		expect(saved.ok).toBe(true);

		const [row] = (await database.current?.select().from(aiProvider)) ?? [];
		expect(row?.encryptedKey).not.toContain("sk-secret-value");
		expect(await openCredential(row?.encryptedKey ?? "")).toBe(
			"sk-secret-value",
		);

		const list = await listAiProviders("u1");
		expect(list.canSave).toBe(true);
		expect(list.providers).toEqual([
			{
				id: row?.id,
				provider: "gateway",
				label: "Team gateway",
				baseUrl: "https://ai-gateway.vercel.sh",
				enabled: true,
				hasKey: true,
				models: ["a/model"],
				editable: true,
			},
		]);
		expect(JSON.stringify(list)).not.toContain("sk-secret-value");
		expect((await listAiProviders("u2")).providers).toEqual([]);
	});

	it("keeps the saved key and the dashboard's settings when an edit sends neither", async () => {
		const { saveAiProvider } = await import("./providers.server");
		const { openCredential } = await import("./credentials.server");
		const saved = await saveAiProvider("u1", input);
		if (!saved.ok) throw new Error(saved.error);
		await database.current
			?.update(aiProvider)
			.set({ settings: { mode: "api", models: ["a/model"], billed: false } });

		const { key: _key, ...edit } = input;
		const result = await saveAiProvider("u1", {
			...edit,
			id: saved.id,
			label: "Renamed",
			models: ["b/model"],
		});
		expect(result.ok).toBe(true);

		const [row] = (await database.current?.select().from(aiProvider)) ?? [];
		expect(row?.label).toBe("Renamed");
		expect(row?.settings).toEqual({
			mode: "api",
			models: ["b/model"],
			billed: false,
		});
		expect(await openCredential(row?.encryptedKey ?? "")).toBe(
			"sk-secret-value",
		);
	});

	it("refuses another person's provider, a bad address and a server with no key", async () => {
		const { saveAiProvider } = await import("./providers.server");
		const saved = await saveAiProvider("u1", input);
		if (!saved.ok) throw new Error(saved.error);

		expect((await saveAiProvider("u2", { ...input, id: saved.id })).ok).toBe(
			false,
		);
		expect(
			(await saveAiProvider("u1", { ...input, baseUrl: "https://evil.example" }))
				.ok,
		).toBe(false);

		testPlatform.config.TOKEN_ENCRYPTION_KEY = undefined;
		expect((await saveAiProvider("u1", input)).ok).toBe(false);
	});
});

describe("removing a provider", () => {
	it("removes the reader's own and leaves others and the dashboard's rows", async () => {
		const { removeAiProvider, saveAiProvider } = await import(
			"./providers.server"
		);
		const saved = await saveAiProvider("u1", input);
		if (!saved.ok) throw new Error(saved.error);
		await database.current?.insert(aiProvider).values([
			{ id: "geld-row", userId: "u1", provider: "geld", label: "Geld" },
			{
				id: "login-row",
				userId: "u1",
				provider: "claude",
				label: "Claude",
				settings: { mode: "login" },
			},
		]);

		await removeAiProvider("u2", saved.id);
		await removeAiProvider("u1", "geld-row");
		await removeAiProvider("u1", "login-row");
		expect((await database.current?.select().from(aiProvider))?.length).toBe(3);

		await removeAiProvider("u1", saved.id);
		const left = (await database.current?.select().from(aiProvider)) ?? [];
		expect(left.map((row) => row.id).sort()).toEqual(["geld-row", "login-row"]);
	});
});
