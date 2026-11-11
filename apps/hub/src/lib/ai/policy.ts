import { parseRepoConfig } from "@geld/core/repo-config";

/** One place a repository's Geld config may be: its text, or why it could not be read. */
export type PolicyFile =
	| { state: "missing" }
	| { state: "unreadable" }
	| { state: "found"; text: string };

export type AiPolicy =
	| { allowed: true }
	| { allowed: false; reason: "disabled" | "unreadable" };

/**
 * Whether a repository lets its pull requests be sent to a model. A config
 * that says `review.ai: false` forbids it, and one that cannot be read or
 * understood forbids it too: the rule may be in the part that was not read.
 */
export function aiPolicyFrom(files: readonly PolicyFile[]): AiPolicy {
	let unreadable = false;
	for (const file of files) {
		if (file.state === "missing") continue;
		if (file.state === "unreadable") {
			unreadable = true;
			continue;
		}
		const parsed = parseRepoConfig(file.text);
		if (!parsed.ok) {
			unreadable = true;
			continue;
		}
		if (parsed.config.review?.ai === false) {
			return { allowed: false, reason: "disabled" };
		}
	}
	return unreadable ? { allowed: false, reason: "unreadable" } : { allowed: true };
}

export const POLICY_WORDS: Record<"disabled" | "unreadable", string> = {
	disabled: "This repository turns AI off in its Geld config.",
	unreadable:
		"This repository's Geld config could not be read, so nothing is sent to a model until it can be.",
};
