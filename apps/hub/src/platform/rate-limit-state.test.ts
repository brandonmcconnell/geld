import { describe, expect, it } from "vitest";
import {
	acquireLease,
	blockUntil,
	emptyRateLimitState,
	releaseLease,
} from "./rate-limit-state";

const NOW = 1_800_000_000_000;

describe("rate limit state", () => {
	it("holds calls to the concurrency limit and frees a slot on release", () => {
		const rule = { maxConcurrent: 1, leaseMs: 30_000 };
		const first = acquireLease(emptyRateLimitState(), rule, NOW, "a");
		expect(first.decision).toEqual({ ok: true, lease: "a" });

		const second = acquireLease(first.state, rule, NOW + 1_000, "b");
		expect(second.decision).toEqual({ ok: false, retryAfterMs: 29_000 });

		const third = acquireLease(
			releaseLease(second.state, "a"),
			rule,
			NOW + 2_000,
			"c",
		);
		expect(third.decision).toEqual({ ok: true, lease: "c" });
	});

	it("takes back a lease that was never released", () => {
		const rule = { maxConcurrent: 1, leaseMs: 5_000 };
		const { state } = acquireLease(emptyRateLimitState(), rule, NOW, "a");
		expect(acquireLease(state, rule, NOW + 5_000, "b").decision).toEqual({
			ok: true,
			lease: "b",
		});
	});

	it("counts starts per window and says when the window reopens", () => {
		const rule = {
			maxConcurrent: 10,
			perWindow: { limit: 2, windowMs: 60_000 },
		};
		let state = emptyRateLimitState();
		for (const [lease, at] of [
			["a", NOW],
			["b", NOW + 10_000],
		] as const) {
			state = releaseLease(acquireLease(state, rule, at, lease).state, lease);
		}
		expect(acquireLease(state, rule, NOW + 20_000, "c").decision).toEqual({
			ok: false,
			retryAfterMs: 40_000,
		});
		expect(acquireLease(state, rule, NOW + 60_000, "c").decision).toEqual({
			ok: true,
			lease: "c",
		});
	});

	it("starts nothing before the time the provider named, and never moves it earlier", () => {
		const rule = { maxConcurrent: 5 };
		const blocked = blockUntil(
			blockUntil(emptyRateLimitState(), NOW + 30_000),
			NOW + 10_000,
		);
		expect(acquireLease(blocked, rule, NOW, "a").decision).toEqual({
			ok: false,
			retryAfterMs: 30_000,
		});
		expect(acquireLease(blocked, rule, NOW + 30_000, "a").decision.ok).toBe(
			true,
		);
	});
});
