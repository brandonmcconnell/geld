import { AwsClient } from "aws4fetch";
import { platform } from "#/platform";
import type { FileStoreConfig } from "#/platform";

export type StoredFile = { size: number; contentType?: string };

/**
 * Files live in an S3-compatible bucket and are reached over the S3 API, so
 * the same code serves R2, AWS S3 or MinIO.
 */
export type FileStore = {
	publicBaseUrl: string;
	/** `body` is a Blob so the request carries its length, which S3 requires. */
	put(
		key: string,
		body: Blob,
		options: { contentType: string; cacheControl?: string },
	): Promise<void>;
	/** `null` when the object does not exist. */
	head(key: string): Promise<StoredFile | null>;
};

function objectUrl(bucketUrl: string, key: string) {
	return `${bucketUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function createFileStore(
	config: FileStoreConfig,
	send: typeof fetch = fetch,
): FileStore {
	const client = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region: config.region,
		service: "s3",
	});
	const request = async (key: string, init: RequestInit) =>
		send(await client.sign(objectUrl(config.bucketUrl, key), init));

	return {
		publicBaseUrl: config.publicBaseUrl,
		async put(key, body, options) {
			const response = await request(key, {
				method: "PUT",
				body,
				headers: {
					"Content-Type": options.contentType,
					...(options.cacheControl
						? { "Cache-Control": options.cacheControl }
						: {}),
				},
			});
			if (!response.ok) {
				throw new Error(`File store put failed: ${response.status}`);
			}
		},
		async head(key) {
			const response = await request(key, { method: "HEAD" });
			if (response.status === 404) return null;
			if (!response.ok) {
				throw new Error(`File store head failed: ${response.status}`);
			}
			return {
				size: Number(response.headers.get("Content-Length") ?? 0),
				contentType: response.headers.get("Content-Type") ?? undefined,
			};
		},
	};
}

/** The configured file store, or `null` where uploads are switched off. */
export function getFileStore(): FileStore | null {
	const config = platform.config().files;
	return config ? createFileStore(config) : null;
}
