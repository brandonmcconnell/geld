import { createServerFn } from "@tanstack/react-start";
import {
	isOpenableProvider,
	type ProviderPullInput,
	type ProviderPullResult,
} from "./provider-pull";

function inputFrom(data: unknown): ProviderPullInput | null {
	if (typeof data !== "object" || data === null) return null;
	const fields: Record<string, unknown> = { ...data };
	const { provider, repository, number } = fields;
	if (
		!isOpenableProvider(provider) ||
		typeof repository !== "string" ||
		typeof number !== "number"
	) {
		return null;
	}
	return { provider, repository, number };
}

export const getProviderPull = createServerFn({ method: "GET" })
	.validator((data: unknown) => inputFrom(data))
	.handler(async ({ data }): Promise<ProviderPullResult> => {
		if (!data) return { ok: false, reason: "not-found" };
		const { getRequestSession } = await import("../auth-runtime");
		const userId = (await getRequestSession())?.user.id;
		if (!userId) return { ok: false, reason: "not-connected" };
		const { readProviderPull } = await import("./provider-pull.server");
		return readProviderPull(userId, data);
	});
