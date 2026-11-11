import {
	isTriggerComment,
	looksLikeBotLogin,
} from "@geld/review/bots";

export type FoldReason = "request" | "bot" | "event";

export type FoldCandidate =
	| {
			kind: "comment";
			login: string | null;
			actorType: string | null;
			body: string;
	  }
	| { kind: "event"; event: string }
	| { kind: "other" };

const FOLDED_EVENTS = new Set([
	"labeled",
	"unlabeled",
	"assigned",
	"unassigned",
	"milestoned",
	"demilestoned",
	"renamed",
	"review_requested",
	"review_request_removed",
	"head_ref_deleted",
	"head_ref_restored",
	"referenced",
	"cross-referenced",
]);

export function foldReasonOf(candidate: FoldCandidate): FoldReason | null {
	if (candidate.kind === "event") {
		return FOLDED_EVENTS.has(candidate.event) ? "event" : null;
	}
	if (candidate.kind !== "comment") return null;
	if (isTriggerComment(candidate.body)) return "request";
	const bot =
		candidate.actorType === "Bot" ||
		(candidate.login !== null && looksLikeBotLogin(candidate.login));
	return bot ? "bot" : null;
}

export type FoldCounts = Record<FoldReason, number>;

export type Folded<T> =
	| { type: "item"; item: T }
	| { type: "fold"; key: string; items: T[]; counts: FoldCounts };

export function foldTimeline<T>(
	items: readonly T[],
	reasonOf: (item: T) => FoldReason | null,
	keyOf: (item: T) => string,
	opened: ReadonlySet<string>,
): Folded<T>[] {
	const out: Folded<T>[] = [];
	let run: { key: string; items: T[]; counts: FoldCounts } | null = null;
	const flush = () => {
		if (run === null) return;
		if (opened.has(run.key)) {
			for (const item of run.items) out.push({ type: "item", item });
		} else {
			out.push({ type: "fold", ...run });
		}
		run = null;
	};
	for (const item of items) {
		const reason = reasonOf(item);
		if (reason === null) {
			flush();
			out.push({ type: "item", item });
			continue;
		}
		run ??= {
			key: keyOf(item),
			items: [],
			counts: { request: 0, bot: 0, event: 0 },
		};
		run.items.push(item);
		run.counts[reason] += 1;
	}
	flush();
	return out;
}

const NOUNS: Record<FoldReason, readonly [string, string]> = {
	bot: ["bot comment", "bot comments"],
	request: ["review request", "review requests"],
	event: ["event", "events"],
};

const ORDER: readonly FoldReason[] = ["bot", "request", "event"];

export function foldLabel(counts: FoldCounts): string {
	return ORDER.filter((reason) => counts[reason] > 0)
		.map((reason) => {
			const count = counts[reason];
			return `${count} ${NOUNS[reason][count === 1 ? 0 : 1]}`;
		})
		.join(", ");
}
