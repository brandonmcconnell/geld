import { DurableObject, env } from "cloudflare:workers";
import {
	acquireLease,
	blockUntil,
	emptyRateLimitState,
	type RateLimitState,
	releaseLease,
} from "../rate-limit-state";
import type { RateLimitDecision, RateLimiter, RateLimitRule } from "../types";

const STATE_KEY = "state";

/** One instance per key, so its calls are decided in order with no race. */
export class RateLimiterObject extends DurableObject {
	async #read(): Promise<RateLimitState> {
		return (
			(await this.ctx.storage.get<RateLimitState>(STATE_KEY)) ??
			emptyRateLimitState()
		);
	}

	async acquire(rule: RateLimitRule): Promise<RateLimitDecision> {
		const { state, decision } = acquireLease(
			await this.#read(),
			rule,
			Date.now(),
			crypto.randomUUID(),
		);
		await this.ctx.storage.put(STATE_KEY, state);
		return decision;
	}

	async release(lease: string): Promise<void> {
		await this.ctx.storage.put(
			STATE_KEY,
			releaseLease(await this.#read(), lease),
		);
	}

	async schedule(resumeAt: number): Promise<void> {
		await this.ctx.storage.put(
			STATE_KEY,
			blockUntil(await this.#read(), resumeAt),
		);
	}
}

export function rateLimiter(): RateLimiter {
	const stub = (key: string) =>
		env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key));
	return {
		acquire: (key, rule) => stub(key).acquire(rule),
		release: (key, lease) => stub(key).release(lease),
		schedule: (key, resumeAt) => stub(key).schedule(resumeAt),
	};
}
