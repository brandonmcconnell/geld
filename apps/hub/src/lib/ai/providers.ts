export const PROVIDER_KINDS = ["gateway", "openai", "claude"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const PROVIDER_KIND_NAMES: Record<ProviderKind, string> = {
	gateway: "AI gateway",
	openai: "OpenAI compatible",
	claude: "Anthropic",
};

export type ProviderPreset = { label: string; kind: ProviderKind; url: string };

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
	{
		label: "Vercel AI Gateway",
		kind: "gateway",
		url: "https://ai-gateway.vercel.sh",
	},
	{ label: "OpenRouter", kind: "gateway", url: "https://openrouter.ai" },
	{ label: "OpenAI", kind: "openai", url: "https://api.openai.com" },
	{ label: "Anthropic", kind: "claude", url: "https://api.anthropic.com" },
];

const KNOWN_HOSTS = [
	"ai-gateway.vercel.sh",
	"openrouter.ai",
	"api.openai.com",
	"api.anthropic.com",
];

/** Mirrors the dashboard's `allowedAiUrl`: the same row must pass in both apps. */
export function allowedAiUrl(raw: string, extraHosts = ""): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	const allowed = [
		...KNOWN_HOSTS,
		...extraHosts
			.split(",")
			.map((host) => host.trim())
			.filter((host) => host !== ""),
	];
	return (
		url.protocol === "https:" &&
		!url.username &&
		!url.password &&
		!url.search &&
		!url.hash &&
		!url.port &&
		allowed.includes(url.hostname)
	);
}

export const MAX_MODELS = 10;

/** What the browser may know of a saved provider. Never the key. */
export type AiProviderView = {
	id: string;
	provider: string;
	label: string;
	baseUrl: string | null;
	enabled: boolean;
	hasKey: boolean;
	models: string[];
	/** False for rows the hub lists and leaves to the dashboard to change. */
	editable: boolean;
};

export type AiProviderInput = {
	id?: string;
	provider: ProviderKind;
	label: string;
	baseUrl: string;
	/** Left out when editing keeps the saved key. */
	key?: string;
	enabled: boolean;
	models: string[];
};

export type AiProviderList = {
	providers: AiProviderView[];
	/** False where the server has no key to seal credentials with. */
	canSave: boolean;
};

function record(value: unknown): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (typeof value !== "object" || value === null) return out;
	for (const [key, entry] of Object.entries(value)) out[key] = entry;
	return out;
}

/** The parts of a row's `settings` the hub reads, tolerant of what the dashboard adds. */
export function readSettings(value: unknown): {
	mode: "api" | "login";
	models: string[];
	rest: Record<string, unknown>;
} {
	const rest = record(value);
	const models = Array.isArray(rest.models)
		? rest.models.filter(
				(model): model is string => typeof model === "string" && model !== "",
			)
		: [];
	return { mode: rest.mode === "login" ? "login" : "api", models, rest };
}

export function isProviderKind(value: string): value is ProviderKind {
	return PROVIDER_KINDS.some((kind) => kind === value);
}

export function parseModels(text: string): string[] {
	return [
		...new Set(
			text
				.split(/[\n,]/)
				.map((model) => model.trim())
				.filter((model) => model !== ""),
		),
	];
}

/** Why an input cannot be saved, in words for the form, or null. */
export function inputProblem(
	input: AiProviderInput,
	extraHosts = "",
): string | null {
	const label = input.label.trim();
	if (label === "" || label.length > 100) return "Give it a name.";
	if (!allowedAiUrl(input.baseUrl, extraHosts)) {
		return "That address is not one Geld sends to. Use a listed provider, or ask whoever runs this Geld to allow your gateway.";
	}
	if (input.id === undefined && !input.key) return "Paste an API key.";
	if (input.key !== undefined && input.key.length > 4000) {
		return "That key is too long.";
	}
	if (input.models.length > MAX_MODELS) {
		return `List at most ${MAX_MODELS} models.`;
	}
	if (input.models.some((model) => model.length > 200)) {
		return "A model id is too long.";
	}
	return null;
}
