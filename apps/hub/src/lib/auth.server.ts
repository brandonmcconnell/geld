import "@tanstack/react-start/server-only";
import {
	type BetterAuthOptions,
	type BetterAuthPlugin,
	betterAuth,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getDb } from "../db";
import {
	account,
	rateLimit,
	session,
	user,
	verification,
} from "../db/schema";
import {
	GITHUB_OAUTH_PROVIDER_ID,
	getGitHubOAuthConfig,
} from "./github-app.server";
import { platform } from "#/platform";
import { getGitHubEmulatorUrl } from "./github-emulator.server";

const GITHUB_OAUTH_SCOPES = ["read:user", "repo", "read:org", "user:email"];

type GitHubProfile = {
	id: number;
	login: string;
	name: string | null;
	email: string | null;
	avatar_url: string;
};

type GitHubEmail = { email: string; primary: boolean; verified: boolean };

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? { ...value }
		: null;
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function parseGitHubProfile(value: unknown): GitHubProfile | null {
	const record = asRecord(value);
	if (
		!record ||
		typeof record.id !== "number" ||
		typeof record.login !== "string"
	) {
		return null;
	}
	return {
		id: record.id,
		login: record.login,
		name: nullableString(record.name),
		email: nullableString(record.email),
		avatar_url: nullableString(record.avatar_url) ?? "",
	};
}

function parseGitHubEmails(value: unknown): GitHubEmail[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item: unknown) => {
		const record = asRecord(item);
		if (!record || typeof record.email !== "string") {
			return [];
		}
		return [
			{
				email: record.email,
				primary: record.primary === true,
				verified: record.verified === true,
			},
		];
	});
}

/**
 * Sign-in is the dashboard's `github-oauth` grant: one authorization gives the
 * Geld session and the token the hub reads GitHub with. It is a generic OAuth
 * provider so demo mode can point the same flow at the emulator.
 */
function githubOAuthProvider(
	origins: { web: string; api: string },
	credentials: { clientId: string; clientSecret: string },
): BetterAuthPlugin {
	const githubFetch = async (
		path: string,
		accessToken: string,
	): Promise<unknown> => {
		const response = await fetch(`${origins.api}${path}`, {
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${accessToken}`,
				"User-Agent": "geld-hub",
			},
		});
		return response.ok ? response.json() : null;
	};

	return genericOAuth({
		config: [
			{
				providerId: GITHUB_OAUTH_PROVIDER_ID,
				clientId: credentials.clientId,
				clientSecret: credentials.clientSecret,
				authorizationUrl: `${origins.web}/login/oauth/authorize`,
				tokenUrl: `${origins.web}/login/oauth/access_token`,
				authentication: "post",
				scopes: GITHUB_OAUTH_SCOPES,
				async getUserInfo(tokens) {
					const accessToken = tokens.accessToken;
					if (!accessToken) {
						return null;
					}
					const profile = parseGitHubProfile(
						await githubFetch("/user", accessToken),
					);
					if (!profile) {
						return null;
					}
					// An account is matched to a Geld user by email, so only an
					// address GitHub has verified may stand for one.
					const verified = parseGitHubEmails(
						await githubFetch("/user/emails", accessToken),
					).filter((entry) => entry.verified);
					const email = (verified.find((entry) => entry.primary) ?? verified[0])
						?.email;
					if (!email) {
						return null;
					}
					return {
						id: String(profile.id),
						name: profile.name || profile.login,
						email,
						image: profile.avatar_url,
						emailVerified: true,
					};
				},
			},
		],
	});
}

const GELD_COOKIE_DOMAIN = ".geld.sh";
const GELD_ORIGINS = ["https://app.geld.sh", "https://www.geld.sh"];

/**
 * The options every Geld app that shares the account tables must agree on:
 * table names, the cookie and how tokens are stored. They mirror
 * `apps/dashboard/lib/auth.ts`, and a session made by either app is read by
 * the other only while they match and both use the same `BETTER_AUTH_SECRET`.
 */
export function sharedAccountOptions(baseURL: string) {
	const shareCookie = new URL(baseURL).hostname.endsWith(GELD_COOKIE_DOMAIN);
	return {
		appName: "Geld",
		trustedOrigins: shareCookie ? [baseURL, ...GELD_ORIGINS] : [baseURL],
		user: { modelName: "users" },
		session: { modelName: "sessions", cookieCache: { enabled: false } },
		account: {
			modelName: "identities",
			encryptOAuthTokens: true,
			accountLinking: {
				enabled: true,
				allowDifferentEmails: false,
				trustedProviders: [],
			},
		},
		verification: { modelName: "verifications" },
		advanced: {
			cookiePrefix: "geld",
			ipAddress: { disableIpTracking: true },
			crossSubDomainCookies: shareCookie
				? { enabled: true, domain: GELD_COOKIE_DOMAIN }
				: { enabled: false },
		},
		rateLimit: { enabled: true, storage: "database" },
	} satisfies Partial<BetterAuthOptions>;
}

export function getAuth() {
	const github = getGitHubOAuthConfig();
	const emulatorUrl = getGitHubEmulatorUrl();
	const config = platform.config();

	return betterAuth({
		...sharedAccountOptions(config.BETTER_AUTH_URL),
		baseURL: config.BETTER_AUTH_URL,
		secret: config.BETTER_AUTH_SECRET,
		database: drizzleAdapter(getDb(), {
			provider: "pg",
			schema: {
				users: user,
				sessions: session,
				identities: account,
				verifications: verification,
				rateLimit,
			},
		}),
		databaseHooks: {
			session: {
				create: {
					before: async (created) => ({
						data: { ...created, ipAddress: null, userAgent: null },
					}),
				},
			},
		},
		plugins: [
			githubOAuthProvider(
				emulatorUrl
					? { web: emulatorUrl, api: emulatorUrl }
					: { web: "https://github.com", api: "https://api.github.com" },
				github,
			),
			tanstackStartCookies(),
		],
	});
}
