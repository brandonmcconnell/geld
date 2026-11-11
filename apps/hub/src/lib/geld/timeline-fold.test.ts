import { describe, expect, it } from "vitest";
import {
	type FoldReason,
	foldLabel,
	foldReasonOf,
	foldTimeline,
} from "./timeline-fold";

describe("foldReasonOf", () => {
	it("keeps a person's comment", () => {
		expect(
			foldReasonOf({
				kind: "comment",
				login: "mira",
				actorType: "User",
				body: "This needs a test for the empty case.",
			}),
		).toBeNull();
	});

	it("folds a request for a bot review, whoever wrote it", () => {
		expect(
			foldReasonOf({
				kind: "comment",
				login: "mira",
				actorType: "User",
				body: "bugbot run",
			}),
		).toBe("request");
	});

	it("folds a bot's comment by actor type or login", () => {
		expect(
			foldReasonOf({
				kind: "comment",
				login: "deploy-helper",
				actorType: "Bot",
				body: "Preview ready",
			}),
		).toBe("bot");
		expect(
			foldReasonOf({
				kind: "comment",
				login: "deploy-helper[bot]",
				actorType: null,
				body: "Preview ready",
			}),
		).toBe("bot");
	});

	it("folds bookkeeping events and keeps state changes", () => {
		expect(foldReasonOf({ kind: "event", event: "labeled" })).toBe("event");
		expect(foldReasonOf({ kind: "event", event: "reviewed" })).toBeNull();
		expect(foldReasonOf({ kind: "event", event: "closed" })).toBeNull();
		expect(foldReasonOf({ kind: "other" })).toBeNull();
	});
});

describe("foldTimeline", () => {
	const reasons: Record<string, FoldReason | null> = {
		a: null,
		b: "bot",
		c: "event",
		d: null,
		e: "request",
	};
	const reasonOf = (item: string) => reasons[item] ?? null;
	const keyOf = (item: string) => item;

	it("gathers each run of folded items into one entry", () => {
		const folded = foldTimeline(
			["a", "b", "c", "d", "e"],
			reasonOf,
			keyOf,
			new Set(),
		);
		expect(folded).toEqual([
			{ type: "item", item: "a" },
			{
				type: "fold",
				key: "b",
				items: ["b", "c"],
				counts: { request: 0, bot: 1, event: 1 },
			},
			{ type: "item", item: "d" },
			{
				type: "fold",
				key: "e",
				items: ["e"],
				counts: { request: 1, bot: 0, event: 0 },
			},
		]);
	});

	it("lays an opened run out in place", () => {
		const folded = foldTimeline(
			["a", "b", "c", "d"],
			reasonOf,
			keyOf,
			new Set(["b"]),
		);
		expect(folded.map((entry) => entry.type)).toEqual([
			"item",
			"item",
			"item",
			"item",
		]);
	});
});

describe("foldLabel", () => {
	it("names what is folded, bots first", () => {
		expect(foldLabel({ request: 1, bot: 2, event: 0 })).toBe(
			"2 bot comments, 1 review request",
		);
		expect(foldLabel({ request: 0, bot: 0, event: 1 })).toBe("1 event");
	});
});
