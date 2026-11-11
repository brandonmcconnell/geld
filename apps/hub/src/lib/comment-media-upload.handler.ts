import {
	buildCommentMediaObjectKey,
	COMMENT_MEDIA_SIGNATURE_PROBE_BYTES,
	detectCommentMediaFromBytes,
	maxBytesForCommentMediaKind,
	publicUrlForFileKey,
	sanitizeCommentMediaFilename,
} from "#/lib/comment-media.server";
import type { FileStore } from "#/lib/file-store.server";
import { logRouteError, serviceUnavailable } from "#/lib/route-safety.server";

export type CommentMediaUploadRuntime = {
	storage: Pick<FileStore, "put" | "publicBaseUrl"> | null;
	getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>;
};

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

async function getRuntime(): Promise<CommentMediaUploadRuntime> {
	const [{ getFileStore }, { getAuth }] = await Promise.all([
		import("#/lib/file-store.server"),
		import("#/lib/auth.server"),
	]);
	return {
		storage: getFileStore(),
		getSession: (headers) => getAuth().api.getSession({ headers }),
	};
}

export async function handleCommentMediaUpload(
	request: Request,
	runtime?: CommentMediaUploadRuntime,
): Promise<Response> {
	const { storage, getSession } = runtime ?? (await getRuntime());

	if (!storage) {
		return Response.json(
			{ error: "Comment media uploads are not configured" },
			{ status: 503 },
		);
	}

	let session: Awaited<ReturnType<typeof getSession>>;
	try {
		session = await getSession(request.headers);
	} catch (error) {
		logRouteError("comment-media", "session lookup failed", error);
		return serviceUnavailable("session_unavailable");
	}

	if (!session) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	// formData() buffers the whole upload, so refuse oversized ones first.
	const declaredLength = Number(request.headers.get("Content-Length"));
	if (
		Number.isFinite(declaredLength) &&
		declaredLength >
			maxBytesForCommentMediaKind("video") + MULTIPART_OVERHEAD_BYTES
	) {
		return Response.json({ error: "File is too large" }, { status: 413 });
	}

	const contentType = request.headers.get("Content-Type") ?? "";
	if (!contentType.includes("multipart/form-data")) {
		return Response.json(
			{ error: "Expected multipart form data" },
			{ status: 400 },
		);
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return Response.json({ error: "Invalid multipart body" }, { status: 400 });
	}
	const file = form.get("file");

	if (!(file instanceof File)) {
		return Response.json({ error: "Missing file" }, { status: 400 });
	}

	// Client-declared MIME (file.type) is not trusted — identify by signature.
	const headerBytes = new Uint8Array(
		await file.slice(0, COMMENT_MEDIA_SIGNATURE_PROBE_BYTES).arrayBuffer(),
	);
	const detected = detectCommentMediaFromBytes(headerBytes);
	if (!detected) {
		return Response.json({ error: "Unsupported file type" }, { status: 415 });
	}

	const maxBytes = maxBytesForCommentMediaKind(detected.kind);
	if (file.size > maxBytes) {
		return Response.json({ error: "File is too large" }, { status: 413 });
	}

	const filename = sanitizeCommentMediaFilename(file.name);
	const key = buildCommentMediaObjectKey(session.user.id, filename);

	try {
		await storage.put(key, file, {
			contentType: detected.contentType,
			cacheControl: "public, max-age=31536000, immutable",
		});
	} catch (error) {
		logRouteError("comment-media", "file store put failed", error);
		return Response.json({ error: "Upload failed" }, { status: 502 });
	}

	const publicUrl = publicUrlForFileKey(storage.publicBaseUrl, key);

	return Response.json({
		key,
		publicUrl,
		kind: detected.kind,
		contentType: detected.contentType,
	});
}
