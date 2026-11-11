import "@tanstack/react-start/server-only";
import { parseUnifiedDiff } from "@geld/core/diff-parse";
import { createMatcher } from "@geld/core/matcher";
import type { ProviderClient, ProviderResult } from "@geld/domain";
import { readGeldSettings } from "../geld/settings.server";
import { providerClientFor } from "./connections.server";
import {
	MAX_DIFF_CHARS,
	type ProviderPullInput,
	type ProviderPullResult,
	providerPullView,
	repositoryParts,
} from "./provider-pull";

const HOSTS = { gitlab: "gitlab.com", bitbucket: "bitbucket.org" } as const;

function failure<T>(
	result: Exclude<ProviderResult<T>, { ok: true }>,
): ProviderPullResult {
	if (result.reason === "signed_out" || result.reason === "permission") {
		return { ok: false, reason: "reconnect" };
	}
	return {
		ok: false,
		reason: result.reason === "not_found" ? "not-found" : "unavailable",
	};
}

/**
 * One GitLab or Bitbucket pull request as the hub shows it. The diff is read
 * for its paths and counts and dropped, and nothing of it is stored.
 */
export async function readProviderPull(
	userId: string,
	input: ProviderPullInput,
	clientFor: (
		userId: string,
		provider: ProviderPullInput["provider"],
	) => Promise<ProviderClient | null> = providerClientFor,
): Promise<ProviderPullResult> {
	const parts = repositoryParts(input.repository);
	if (!parts || !Number.isInteger(input.number) || input.number < 1) {
		return { ok: false, reason: "not-found" };
	}
	const client = await clientFor(userId, input.provider);
	if (!client) return { ok: false, reason: "not-connected" };
	const ref = {
		provider: input.provider,
		host: HOSTS[input.provider],
		...parts,
		number: input.number,
	};
	try {
		const detail = await client.pull(ref);
		if (!detail.ok) return failure(detail);
		const [diff, threads, { settings }] = await Promise.all([
			client.diff(ref),
			client.threads(ref),
			readGeldSettings(userId),
		]);
		const stats = !diff.ok
			? "unavailable"
			: diff.value.length > MAX_DIFF_CHARS
				? "too-large"
				: parseUnifiedDiff(diff.value);
		return {
			ok: true,
			pull: providerPullView(
				input,
				detail.value,
				stats,
				threads.ok ? threads.value : null,
				createMatcher(settings, input.repository),
			),
		};
	} catch {
		return { ok: false, reason: "unavailable" };
	}
}
