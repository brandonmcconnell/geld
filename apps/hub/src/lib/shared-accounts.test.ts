import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { makeSignature, symmetricEncrypt } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "#/db";
import * as schema from "#/db/schema";
import { createTestPlatform } from "#/platform/testing";

const SECRET = "a-shared-secret-of-at-least-32-characters";
const testPlatform = createTestPlatform({
	BETTER_AUTH_SECRET: SECRET,
	BETTER_AUTH_URL: "https://hub.geld.sh",
	GITHUB_OAUTH_CLIENT_ID: "client",
	GITHUB_OAUTH_CLIENT_SECRET: "secret",
});
const database: { current: Database | null } = { current: null };

vi.mock("#/platform", () => ({ platform: testPlatform.platform }));
vi.mock("../db", () => ({
	getDb: () => {
		if (!database.current) {
			throw new Error("no test database");
		}
		return database.current;
	},
}));

const HUB_MIGRATIONS = new URL("../../db/migrations/", import.meta.url);
const DASHBOARD_MIGRATIONS = new URL(
	"../../../dashboard/db/migrations/",
	import.meta.url,
);
const SHARED_TABLES = [
	"users",
	"sessions",
	"identities",
	"verifications",
	"rateLimit",
];

async function applyAll(client: PGlite, folder: URL) {
	const files = readdirSync(folder)
		.filter((name) => name.endsWith(".sql"))
		.sort();
	for (const file of files) {
		await client.exec(
			readFileSync(new URL(file, folder), "utf8").replaceAll(
				"--> statement-breakpoint",
				"",
			),
		);
	}
}

async function describeSharedTables(client: PGlite) {
	const columns = await client.query(
		`SELECT table_name, column_name, data_type, is_nullable, column_default
		 FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = ANY($1)
		 ORDER BY table_name, column_name`,
		[SHARED_TABLES],
	);
	const indexes = await client.query(
		`SELECT tablename, indexname, indexdef FROM pg_indexes
		 WHERE schemaname = 'public' AND tablename = ANY($1)
		 ORDER BY tablename, indexname`,
		[SHARED_TABLES],
	);
	const foreignKeys = await client.query(
		`SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
		 FROM pg_constraint
		 WHERE contype = 'f' AND conrelid::regclass::text = ANY($1)
		 ORDER BY 1, 2`,
		[SHARED_TABLES],
	);
	return {
		columns: columns.rows,
		indexes: indexes.rows,
		foreignKeys: foreignKeys.rows,
	};
}

let alone: PGlite;
let shared: PGlite;

beforeAll(async () => {
	alone = new PGlite();
	await applyAll(alone, HUB_MIGRATIONS);
	shared = new PGlite();
	await applyAll(shared, DASHBOARD_MIGRATIONS);
	await applyAll(shared, HUB_MIGRATIONS);
});

describe("the account tables the hub shares with the dashboard", () => {
	it("are declared by the hub exactly as the dashboard's migrations make them", async () => {
		expect(await describeSharedTables(alone)).toEqual(
			await describeSharedTables(shared),
		);
	});

	it("leave the dashboard's rows alone when the hub migrates after it", async () => {
		const client = new PGlite();
		await applyAll(client, DASHBOARD_MIGRATIONS);
		await client.exec(
			`INSERT INTO users (id, name, email) VALUES ('u1', 'Ada', 'ada@example.com')`,
		);
		await applyAll(client, HUB_MIGRATIONS);
		const rows = await client.query("SELECT id FROM users");
		expect(rows.rows).toEqual([{ id: "u1" }]);
	});
});

describe("a session the dashboard made", () => {
	it("is the hub's session too", async () => {
		database.current = drizzle(shared, { schema });
		await shared.exec(
			`INSERT INTO users (id, name, email, "emailVerified") VALUES ('u1', 'Ada', 'ada@example.com', true);
			 INSERT INTO sessions (id, token, "expiresAt", "userId") VALUES ('s1', 'tok-1', now() + interval '1 day', 'u1')`,
		);
		const signed = encodeURIComponent(
			`tok-1.${await makeSignature("tok-1", SECRET)}`,
		);
		const { getAuth } = await import("./auth.server");

		const session = await getAuth().api.getSession({
			headers: new Headers({
				cookie: `__Secure-geld.session_token=${signed}`,
			}),
		});

		expect(session?.user).toMatchObject({ id: "u1", email: "ada@example.com" });
	});

	it("is shared across geld.sh hosts and kept to one host elsewhere", async () => {
		const { sharedAccountOptions } = await import("./auth.server");
		expect(
			sharedAccountOptions("https://hub.geld.sh").advanced.crossSubDomainCookies,
		).toEqual({ enabled: true, domain: ".geld.sh" });
		expect(
			sharedAccountOptions("http://localhost:3200").advanced
				.crossSubDomainCookies,
		).toEqual({ enabled: false });
	});
});

describe("provider tokens", () => {
	it("open whether the dashboard's sign-in or the hub sealed them", async () => {
		const { openToken, sealToken } = await import("./account-tokens.server");
		const fromBetterAuth = await symmetricEncrypt({
			key: SECRET,
			data: "gho_dashboard",
		});
		expect(await openToken(fromBetterAuth)).toBe("gho_dashboard");

		const sealed = await sealToken("ghu_hub");
		expect(sealed).not.toContain("ghu_hub");
		expect(await openToken(sealed)).toBe("ghu_hub");
	});

	it("pass through when stored before encryption, and read as missing when unreadable", async () => {
		const { openToken } = await import("./account-tokens.server");
		expect(await openToken("gho_plain_token")).toBe("gho_plain_token");
		expect(await openToken(null)).toBeNull();
		expect(await openToken("abcdef0123")).toBeNull();
	});

	it("are sealed in the row the hub writes for a GitHub App authorization", async () => {
		const client = new PGlite();
		await applyAll(client, HUB_MIGRATIONS);
		database.current = drizzle(client, { schema });
		await client.exec(
			`INSERT INTO users (id, name, email) VALUES ('u1', 'Ada', 'ada@example.com')`,
		);
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({ access_token: "ghu_secret", refresh_token: "ghr_secret" }),
		);
		testPlatform.config.GITHUB_APP_CLIENT_ID = "app";
		testPlatform.config.GITHUB_APP_CLIENT_SECRET = "app-secret";
		const { exchangeGitHubAppUserCode, getGitHubAppUserAccessTokenByUserId } =
			await import("./github-app.server");

		await exchangeGitHubAppUserCode({ code: "c", userId: "u1" });
		fetchMock.mockRestore();

		const stored = await client.query<{
			providerId: string;
			accessToken: string;
			refreshToken: string;
		}>(`SELECT "providerId", "accessToken", "refreshToken" FROM identities`);
		expect(stored.rows[0]?.providerId).toBe("github-repository");
		expect(stored.rows[0]?.accessToken).not.toContain("ghu_secret");
		expect(stored.rows[0]?.refreshToken).not.toContain("ghr_secret");
		expect(await getGitHubAppUserAccessTokenByUserId("u1")).toBe("ghu_secret");
	});
});
