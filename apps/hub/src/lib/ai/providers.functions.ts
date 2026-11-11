import { createServerFn } from "@tanstack/react-start";
import {
	type AiProviderInput,
	type AiProviderList,
	isProviderKind,
} from "./providers";

async function sessionUserId(): Promise<string | null> {
	const { getRequestSession } = await import("../auth-runtime");
	return (await getRequestSession())?.user.id ?? null;
}

export const getAiProviders = createServerFn({ method: "GET" }).handler(
	async (): Promise<AiProviderList> => {
		const userId = await sessionUserId();
		if (!userId) return { providers: [], canSave: false };
		const { listAiProviders } = await import("./providers.server");
		return listAiProviders(userId);
	},
);

function field(data: Record<string, unknown>, key: string): string {
	const value = data[key];
	return typeof value === "string" ? value : "";
}

function inputFrom(data: unknown): AiProviderInput | null {
	if (typeof data !== "object" || data === null) return null;
	const entries: Record<string, unknown> = { ...data };
	const provider = field(entries, "provider");
	if (!isProviderKind(provider)) return null;
	const models = Array.isArray(entries.models)
		? entries.models.filter((model): model is string => typeof model === "string")
		: [];
	const id = field(entries, "id");
	const key = field(entries, "key");
	return {
		...(id ? { id } : {}),
		provider,
		label: field(entries, "label"),
		baseUrl: field(entries, "baseUrl"),
		...(key ? { key } : {}),
		enabled: entries.enabled === true,
		models,
	};
}

export const saveAiProviderFn = createServerFn({ method: "POST" })
	.validator((data: unknown) => inputFrom(data))
	.handler(async ({ data }) => {
		const userId = await sessionUserId();
		if (!userId) return { ok: false as const, error: "Sign in first." };
		if (data === null) {
			return { ok: false as const, error: "That provider could not be read." };
		}
		const { saveAiProvider } = await import("./providers.server");
		return saveAiProvider(userId, data);
	});

export const removeAiProviderFn = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		typeof data === "string" ? data : "",
	)
	.handler(async ({ data }) => {
		const userId = await sessionUserId();
		if (!userId || data === "") return { ok: false as const };
		const { removeAiProvider } = await import("./providers.server");
		await removeAiProvider(userId, data);
		return { ok: true as const };
	});
