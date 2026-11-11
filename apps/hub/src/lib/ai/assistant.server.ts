import "@tanstack/react-start/server-only";
import {
	type ChatCompletionResult,
	type ChatMessage,
	completeChat,
} from "@geld/review/ai-client";
import { and, eq } from "drizzle-orm";
import { getDb } from "#/db";
import { aiProvider } from "#/db/schema";
import { platform } from "#/platform";
import {
	type AssistantAnswer,
	type AssistantContext,
	assistantMessages,
	questionProblem,
} from "./assistant";
import { openCredential } from "./credentials.server";
import { type AiPolicy, POLICY_WORDS } from "./policy";
import { allowedAiUrl, isProviderKind, readSettings } from "./providers";

type ReadyProvider = {
	kind: string;
	label: string;
	baseUrl: string;
	apiKey: string;
	model: string;
};

/** The reader's first provider that is on, has a key this server can open and names a model. */
export async function readyProvider(
	userId: string,
): Promise<ReadyProvider | null> {
	const rows = await getDb()
		.select()
		.from(aiProvider)
		.where(and(eq(aiProvider.userId, userId), eq(aiProvider.enabled, true)));
	const hosts = platform.config().AI_ALLOWED_HOSTS;
	for (const row of rows.sort((a, b) => a.label.localeCompare(b.label))) {
		const settings = readSettings(row.settings);
		const [model] = settings.models;
		if (
			!isProviderKind(row.provider) ||
			settings.mode !== "api" ||
			model === undefined ||
			row.baseUrl === null ||
			row.encryptedKey === null ||
			!allowedAiUrl(row.baseUrl, hosts)
		) {
			continue;
		}
		const apiKey = await openCredential(row.encryptedKey).catch(() => null);
		if (apiKey === null) continue;
		return {
			kind: row.provider,
			label: row.label,
			baseUrl: row.baseUrl,
			apiKey,
			model,
		};
	}
	return null;
}

const NO_REDIRECT: RequestInit = { redirect: "error" };

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

async function completeAnthropic(
	provider: ReadyProvider,
	messages: readonly ChatMessage[],
): Promise<ChatCompletionResult> {
	const failed = { ok: false as const, reason: "The AI provider is unavailable" };
	try {
		const response = await fetch(
			new URL("/v1/messages", provider.baseUrl).toString(),
			{
				...NO_REDIRECT,
				method: "POST",
				signal: AbortSignal.timeout(90_000),
				headers: {
					"x-api-key": provider.apiKey,
					"anthropic-version": "2023-06-01",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: provider.model,
					max_tokens: 4000,
					system: messages
						.filter((message) => message.role === "system")
						.map((message) => message.content)
						.join("\n"),
					messages: messages.filter((message) => message.role !== "system"),
				}),
			},
		);
		if (!response.ok) return failed;
		const payload: unknown = await response.json();
		if (typeof payload !== "object" || payload === null) return failed;
		const fields: Record<string, unknown> = { ...payload };
		const parts = Array.isArray(fields.content) ? fields.content : [];
		const answer = parts
			.map((part: unknown) =>
				typeof part === "object" && part !== null && "text" in part
					? text(part.text)
					: "",
			)
			.join("");
		return answer === ""
			? failed
			: { ok: true, text: answer, model: text(fields.model) || provider.model };
	} catch {
		return failed;
	}
}

function complete(
	provider: ReadyProvider,
	messages: readonly ChatMessage[],
): Promise<ChatCompletionResult> {
	if (provider.kind === "claude") return completeAnthropic(provider, messages);
	return completeChat({
		baseUrl: provider.baseUrl,
		apiKey: provider.apiKey,
		model: provider.model,
		messages,
		timeoutMs: 90_000,
		fetch: (input, init) => fetch(input, { ...init, ...NO_REDIRECT }),
	});
}

/**
 * Answers one question about a pull request with the reader's own provider.
 * `loadContext` is called only once a provider is ready and the repository
 * allows it, so nothing is read for a request that will not be sent.
 */
export async function askPullAssistant(input: {
	userId: string;
	question: string;
	policy: () => Promise<AiPolicy>;
	loadContext: () => Promise<AssistantContext>;
}): Promise<AssistantAnswer> {
	const problem = questionProblem(input.question);
	if (problem !== null) return { ok: false, error: problem };
	const provider = await readyProvider(input.userId);
	if (provider === null) {
		return {
			ok: false,
			setup: true,
			error: "Add an AI provider with a key and a model in Settings first.",
		};
	}
	const policy = await input.policy();
	if (!policy.allowed) return { ok: false, error: POLICY_WORDS[policy.reason] };
	const context = await input.loadContext();
	const result = await complete(
		provider,
		assistantMessages(context, input.question.trim()),
	);
	if (!result.ok) {
		return { ok: false, error: `${provider.label} did not answer. Try again.` };
	}
	return {
		ok: true,
		text: result.text,
		model: result.model,
		provider: provider.label,
	};
}
