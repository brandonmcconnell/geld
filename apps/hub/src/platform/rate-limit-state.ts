import type { RateLimitDecision, RateLimitRule } from "./types";

/** One key's bookkeeping. Plain data, so any host can store it. */
export type RateLimitState = {
	/** Lease id to the time it lapses. */
	leases: Record<string, number>;
	/** Start times of calls inside the current window. */
	starts: number[];
	/** No call starts before this. */
	blockedUntil: number;
};

const DEFAULT_LEASE_MS = 60_000;

export function emptyRateLimitState(): RateLimitState {
	return { leases: {}, starts: [], blockedUntil: 0 };
}

function withoutLapsedLeases(leases: Record<string, number>, now: number) {
	return Object.fromEntries(
		Object.entries(leases).filter(([, lapsesAt]) => lapsesAt > now),
	);
}

export function acquireLease(
	state: RateLimitState,
	rule: RateLimitRule,
	now: number,
	lease: string,
): { state: RateLimitState; decision: RateLimitDecision } {
	const leases = withoutLapsedLeases(state.leases, now);
	const windowMs = rule.perWindow?.windowMs ?? 0;
	const starts = state.starts.filter((startedAt) => startedAt > now - windowMs);
	const settled = { leases, starts, blockedUntil: state.blockedUntil };
	const refuse = (retryAfterMs: number) => ({
		state: settled,
		decision: { ok: false as const, retryAfterMs: Math.max(1, retryAfterMs) },
	});

	if (state.blockedUntil > now) return refuse(state.blockedUntil - now);

	if (Object.keys(leases).length >= rule.maxConcurrent) {
		return refuse(Math.min(...Object.values(leases)) - now);
	}

	if (rule.perWindow && starts.length >= rule.perWindow.limit) {
		return refuse(Math.min(...starts) + windowMs - now);
	}

	return {
		state: {
			leases: { ...leases, [lease]: now + (rule.leaseMs ?? DEFAULT_LEASE_MS) },
			starts: rule.perWindow ? [...starts, now] : [],
			blockedUntil: state.blockedUntil,
		},
		decision: { ok: true, lease },
	};
}

export function releaseLease(
	state: RateLimitState,
	lease: string,
): RateLimitState {
	const { [lease]: _released, ...leases } = state.leases;
	return { ...state, leases };
}

export function blockUntil(
	state: RateLimitState,
	resumeAt: number,
): RateLimitState {
	return { ...state, blockedUntil: Math.max(state.blockedUntil, resumeAt) };
}
