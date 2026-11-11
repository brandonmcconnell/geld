import { defineEnv, string, url } from "void/env";

// Every value the Worker reads. Locally they come from `.env` (copy
// env.example); in production from `void secret sync <file>`, and
// `void deploy` refuses to ship while a required one is missing.
export default defineEnv({
	// GitHub OAuth App: sign-in and broad-scope reads.
	GITHUB_OAUTH_CLIENT_ID: string(),
	GITHUB_OAUTH_CLIENT_SECRET: string(),
	// Older names for the OAuth App pair, read when the names above are unset.
	GITHUB_CLIENT_ID: string().optional(),
	GITHUB_CLIENT_SECRET: string().optional(),

	// GitHub App: installation tokens, webhooks, app-scoped repository access.
	GITHUB_APP_ID: string(),
	GITHUB_APP_SLUG: string(),
	GITHUB_APP_CLIENT_ID: string(),
	GITHUB_APP_CLIENT_SECRET: string(),
	// Demo mode fetches the emulator's key instead, so only production needs it.
	GITHUB_APP_PRIVATE_KEY: string().optional(),
	GITHUB_WEBHOOK_SECRET: string(),

	BETTER_AUTH_SECRET: string(),
	BETTER_AUTH_URL: url(),

	// Postgres. Local development and migrations read it; a deployed Worker
	// connects through its HYPERDRIVE binding instead.
	DATABASE_URL: string().optional(),

	// An S3-compatible bucket for comment media; uploads stay off without all
	// four. FILES_S3_REGION defaults to "auto", which is what R2 expects.
	FILES_S3_BUCKET_URL: url().optional(),
	FILES_S3_REGION: string().optional(),
	FILES_S3_ACCESS_KEY_ID: string().optional(),
	FILES_S3_SECRET_ACCESS_KEY: string().optional(),
	FILES_PUBLIC_BASE_URL: url().optional(),
	// Optional providers a person can connect to their Geld account. Each
	// needs both values, and the dashboard's when the two share a database.
	GITLAB_CLIENT_ID: string().optional(),
	GITLAB_CLIENT_SECRET: string().optional(),
	BITBUCKET_CLIENT_ID: string().optional(),
	BITBUCKET_CLIENT_SECRET: string().optional(),
	TOKEN_ENCRYPTION_KEY: string().optional(),
	AI_ALLOWED_HOSTS: string().optional(),
	// Demo mode only: base URL of apps/hub-emulator.
	GITHUB_EMULATOR_URL: url().optional(),
});
