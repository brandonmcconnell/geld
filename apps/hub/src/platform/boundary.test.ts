import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../", import.meta.url);

// The only places that may touch a Cloudflare API. Everything else goes
// through `#/platform`, which is what keeps another host a matter of
// swapping these files.
const ALLOWED = [
	/^platform\/cloudflare\//u,
	/^entry-worker\.ts$/u,
	/^env\.d\.ts$/u,
];

const CLOUDFLARE_ONLY = [
	/["']cloudflare:[a-z-]+["']/u,
	/\b(?:KVNamespace|D1Database|R2Bucket|R2Object|DurableObjectNamespace|ExecutionContext|Hyperdrive)\b/u,
	/\bcaches\.(?:default|open)\b/u,
	/["']drizzle-orm\/d1["']/u,
];

function sourceFiles(directory: URL, prefix = ""): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = `${prefix}${entry.name}`;
		if (entry.isDirectory()) {
			return sourceFiles(new URL(`${entry.name}/`, directory), `${path}/`);
		}
		return /\.tsx?$/u.test(entry.name) ? [path] : [];
	});
}

describe("platform boundary", () => {
	it("keeps Cloudflare APIs inside src/platform/cloudflare and the Worker entry", () => {
		const offenders = sourceFiles(SRC)
			.filter((path) => !ALLOWED.some((allowed) => allowed.test(path)))
			.filter((path) => !/\.test\.tsx?$/u.test(path))
			.filter((path) => {
				// Prose may name the platform; code may not use it.
				const text = readFileSync(new URL(path, SRC), "utf8")
					.replace(/\/\*[\s\S]*?\*\//gu, "")
					.replace(/^\s*\/\/.*$/gmu, "");
				return CLOUDFLARE_ONLY.some((pattern) => pattern.test(text));
			});
		expect(offenders).toEqual([]);
	});
});
