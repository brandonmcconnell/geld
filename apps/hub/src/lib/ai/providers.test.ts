import { describe, expect, it } from "vitest";
import {
	allowedAiUrl,
	inputProblem,
	parseModels,
	readSettings,
} from "./providers";

describe("allowedAiUrl", () => {
	it("takes the listed providers over https", () => {
		expect(allowedAiUrl("https://ai-gateway.vercel.sh")).toBe(true);
		expect(allowedAiUrl("https://api.openai.com/v1")).toBe(true);
	});

	it("refuses anything that could send a key elsewhere", () => {
		expect(allowedAiUrl("http://api.openai.com")).toBe(false);
		expect(allowedAiUrl("https://api.openai.com.example.dev")).toBe(false);
		expect(allowedAiUrl("https://user:pass@api.openai.com")).toBe(false);
		expect(allowedAiUrl("https://api.openai.com:8443")).toBe(false);
		expect(allowedAiUrl("https://api.openai.com/?next=x")).toBe(false);
		expect(allowedAiUrl("not a url")).toBe(false);
	});

	it("takes a host the deployment allows", () => {
		expect(allowedAiUrl("https://llm.example.dev")).toBe(false);
		expect(
			allowedAiUrl("https://llm.example.dev", "a.example.dev, llm.example.dev"),
		).toBe(true);
	});
});

describe("inputProblem", () => {
	const input = {
		provider: "gateway" as const,
		label: "Team gateway",
		baseUrl: "https://ai-gateway.vercel.sh",
		key: "sk-test",
		enabled: true,
		models: ["a/model"],
	};

	it("passes a whole new provider", () => {
		expect(inputProblem(input)).toBeNull();
	});

	it("asks for a key on a new provider and not on an edit", () => {
		const { key: _key, ...rest } = input;
		expect(inputProblem(rest)).toBe("Paste an API key.");
		expect(inputProblem({ ...rest, id: "p1" })).toBeNull();
	});

	it("names a nameless provider and an address it will not send to", () => {
		expect(inputProblem({ ...input, label: "  " })).toBe("Give it a name.");
		expect(
			inputProblem({ ...input, baseUrl: "https://llm.example.dev" }),
		).toContain("not one Geld sends to");
	});
});

describe("parseModels", () => {
	it("reads ids apart by commas or lines, once each", () => {
		expect(parseModels("a/one, b/two\n a/one\n")).toEqual(["a/one", "b/two"]);
	});
});

describe("readSettings", () => {
	it("keeps what it does not read", () => {
		const settings = readSettings({
			mode: "api",
			models: ["m", 3, ""],
			billed: true,
		});
		expect(settings.models).toEqual(["m"]);
		expect(settings.rest.billed).toBe(true);
		expect(readSettings(null).mode).toBe("api");
		expect(readSettings({ mode: "login" }).mode).toBe("login");
	});
});
