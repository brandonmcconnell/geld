import { env } from "cloudflare:workers";
import type { AppConfig, DeployedVersion, FileStoreConfig } from "../types";

function fileStore(): FileStoreConfig | null {
	const {
		FILES_S3_BUCKET_URL: bucketUrl,
		FILES_S3_ACCESS_KEY_ID: accessKeyId,
		FILES_S3_SECRET_ACCESS_KEY: secretAccessKey,
		FILES_PUBLIC_BASE_URL: publicBaseUrl,
	} = env;
	if (!(bucketUrl && accessKeyId && secretAccessKey && publicBaseUrl)) {
		return null;
	}
	return {
		bucketUrl: bucketUrl.replace(/\/+$/u, ""),
		region: env.FILES_S3_REGION || "auto",
		accessKeyId,
		secretAccessKey,
		publicBaseUrl: publicBaseUrl.replace(/\/+$/u, ""),
	};
}

function deployedVersion(): DeployedVersion | null {
	const metadata = env.CF_VERSION_METADATA;
	if (!metadata?.id) return null;
	return {
		id: metadata.id,
		tag: metadata.tag,
		uploadedAt: metadata.timestamp,
	};
}

export function config(): AppConfig {
	return {
		// Hyperdrive in production; a plain URL under `vite dev`.
		databaseUrl: env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? null,
		BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: env.BETTER_AUTH_URL,
		GITHUB_OAUTH_CLIENT_ID: env.GITHUB_OAUTH_CLIENT_ID,
		GITHUB_OAUTH_CLIENT_SECRET: env.GITHUB_OAUTH_CLIENT_SECRET,
		GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
		GITHUB_APP_ID: env.GITHUB_APP_ID,
		GITHUB_APP_SLUG: env.GITHUB_APP_SLUG,
		GITHUB_APP_CLIENT_ID: env.GITHUB_APP_CLIENT_ID,
		GITHUB_APP_CLIENT_SECRET: env.GITHUB_APP_CLIENT_SECRET,
		GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY,
		GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET,
		GITLAB_CLIENT_ID: env.GITLAB_CLIENT_ID,
		GITLAB_CLIENT_SECRET: env.GITLAB_CLIENT_SECRET,
		BITBUCKET_CLIENT_ID: env.BITBUCKET_CLIENT_ID,
		BITBUCKET_CLIENT_SECRET: env.BITBUCKET_CLIENT_SECRET,
		GITHUB_EMULATOR_URL: env.GITHUB_EMULATOR_URL,
		files: fileStore(),
		version: deployedVersion(),
	};
}
