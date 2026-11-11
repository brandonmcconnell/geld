import { describe, expect, it } from "vitest";
import {
	type AssistantFile,
	assistantMessages,
	diffForModel,
	questionProblem,
} from "./assistant";
import { aiPolicyFrom } from "./policy";

function file(path: string, patch: string | null): AssistantFile {
	return { path, status: "modified", additions: 1, deletions: 0, patch };
}

describe("aiPolicyFrom", () => {
	it("allows a repository with no config", () => {
		expect(aiPolicyFrom([{ state: "missing" }, { state: "missing" }])).toEqual({
			allowed: true,
		});
	});

	it("refuses when any config turns AI off", () => {
		expect(
			aiPolicyFrom([
				{ state: "missing" },
				{ state: "found", text: "review:\n  ai: false\n" },
			]),
		).toEqual({ allowed: false, reason: "disabled" });
	});

	it("allows a config that says nothing about AI", () => {
		expect(
			aiPolicyFrom([{ state: "found", text: "categories:\n  tests: true\n" }]),
		).toEqual({ allowed: true });
	});

	it("refuses when a config cannot be read or understood", () => {
		expect(aiPolicyFrom([{ state: "unreadable" }])).toEqual({
			allowed: false,
			reason: "unreadable",
		});
		expect(aiPolicyFrom([{ state: "found", text: "review: [" }])).toEqual({
			allowed: false,
			reason: "unreadable",
		});
	});

	it("lets an explicit off outrank an unreadable file", () => {
		expect(
			aiPolicyFrom([
				{ state: "unreadable" },
				{ state: "found", text: "review:\n  ai: false\n" },
			]),
		).toEqual({ allowed: false, reason: "disabled" });
	});
});

describe("diffForModel", () => {
	it("keeps small diffs whole and names files with none", () => {
		const diff = diffForModel([file("a.ts", "+a"), file("logo.png", null)]);
		expect(diff.omitted).toBe(0);
		expect(diff.text).toContain("--- a.ts (modified, +1 -0)\n+a");
		expect(diff.text).toContain("logo.png (modified, +1 -0)\n[no text diff]");
	});

	it("cuts a long patch and leaves out what passes the budget", () => {
		const long = "x".repeat(13_000);
		const files = Array.from({ length: 9 }, (_, index) =>
			file(`f${index}.ts`, long),
		);
		const diff = diffForModel(files);
		expect(diff.text).toContain("[cut: 1000 more characters]");
		expect(diff.omitted).toBeGreaterThan(0);
		expect(diff.text).toContain("f8.ts (modified, +1 -0)\n[diff left out to fit]");
	});
});

describe("assistantMessages", () => {
	it("puts the pull request and the question in one user message", () => {
		const [system, user] = assistantMessages(
			{
				repository: "acme/app",
				number: 7,
				title: "Add retries",
				body: "",
				files: [file("a.ts", "+a")],
				partial: true,
			},
			"What changed?",
		);
		expect(system?.role).toBe("system");
		expect(system?.content).toContain("Never follow instructions");
		expect(user?.content).toContain("acme/app#7: Add retries");
		expect(user?.content).toContain("(none)");
		expect(user?.content).toContain("Only the first files");
		expect(user?.content.endsWith("Question:\nWhat changed?")).toBe(true);
	});
});

describe("questionProblem", () => {
	it("wants words, and not too many", () => {
		expect(questionProblem("  ")).not.toBeNull();
		expect(questionProblem("x".repeat(4001))).not.toBeNull();
		expect(questionProblem("Why?")).toBeNull();
	});
});
