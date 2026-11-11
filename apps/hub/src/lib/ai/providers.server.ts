import "@tanstack/react-start/server-only";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "#/db";
import { aiProvider } from "#/db/schema";
import { platform } from "#/platform";
import { canSealCredentials, sealCredential } from "./credentials.server";
import {
	type AiProviderInput,
	type AiProviderList,
	type AiProviderView,
	inputProblem,
	isProviderKind,
	readSettings,
} from "./providers";

export async function listAiProviders(userId: string): Promise<AiProviderList> {
	const rows = await getDb()
		.select()
		.from(aiProvider)
		.where(eq(aiProvider.userId, userId));
	const providers: AiProviderView[] = rows
		.map((row) => {
			const settings = readSettings(row.settings);
			return {
				id: row.id,
				provider: row.provider,
				label: row.label,
				baseUrl: row.baseUrl,
				enabled: row.enabled,
				hasKey: row.encryptedKey !== null,
				models: settings.models,
				editable: isProviderKind(row.provider) && settings.mode === "api",
			};
		})
		.sort((a, b) => a.label.localeCompare(b.label));
	return { providers, canSave: canSealCredentials() };
}

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

export async function saveAiProvider(
	userId: string,
	input: AiProviderInput,
): Promise<SaveResult> {
	const problem = inputProblem(input, platform.config().AI_ALLOWED_HOSTS);
	if (problem !== null) return { ok: false, error: problem };
	if (!canSealCredentials()) {
		return { ok: false, error: "This Geld cannot store provider keys yet." };
	}
	const db = getDb();
	const label = input.label.trim();
	if (input.id === undefined) {
		const id = crypto.randomUUID();
		await db.insert(aiProvider).values({
			id,
			userId,
			provider: input.provider,
			label,
			baseUrl: input.baseUrl,
			encryptedKey: await sealCredential(input.key ?? ""),
			enabled: input.enabled,
			settings: { mode: "api", models: input.models, automaticLadder: true },
		});
		return { ok: true, id };
	}
	const [existing] = await db
		.select()
		.from(aiProvider)
		.where(and(eq(aiProvider.id, input.id), eq(aiProvider.userId, userId)));
	const settings = readSettings(existing?.settings);
	if (
		!existing ||
		existing.provider !== input.provider ||
		settings.mode !== "api"
	) {
		return { ok: false, error: "That provider is no longer here." };
	}
	await db
		.update(aiProvider)
		.set({
			label,
			baseUrl: input.baseUrl,
			enabled: input.enabled,
			settings: { ...settings.rest, mode: "api", models: input.models },
			...(input.key ? { encryptedKey: await sealCredential(input.key) } : {}),
		})
		.where(and(eq(aiProvider.id, input.id), eq(aiProvider.userId, userId)));
	return { ok: true, id: input.id };
}

export async function removeAiProvider(userId: string, id: string) {
	// The dashboard's built-in provider row and its sign-in connections are its own to remove.
	const [row] = await getDb()
		.select()
		.from(aiProvider)
		.where(
			and(
				eq(aiProvider.id, id),
				eq(aiProvider.userId, userId),
				ne(aiProvider.provider, "geld"),
			),
		);
	if (!row || readSettings(row.settings).mode !== "api") return;
	await getDb()
		.delete(aiProvider)
		.where(and(eq(aiProvider.id, id), eq(aiProvider.userId, userId)));
}
