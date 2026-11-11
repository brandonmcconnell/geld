import type { FileStats } from "@geld/core/diff-parse";
import type { PathMatcher } from "@geld/core/matcher";
import type { PullDetail, ProviderThread } from "@geld/domain";

export const OPENABLE_PROVIDERS = ["gitlab", "bitbucket"] as const;
export type OpenableProvider = (typeof OPENABLE_PROVIDERS)[number];

export function isOpenableProvider(value: unknown): value is OpenableProvider {
	return OPENABLE_PROVIDERS.some((provider) => provider === value);
}

/** A diff past this is not parsed: its files are then not listed. */
export const MAX_DIFF_CHARS = 4_000_000;
const EXCERPT_CHARS = 240;

export type ProviderPullInput = {
	provider: OpenableProvider;
	/** The whole path of the repository: a GitLab group may be several deep. */
	repository: string;
	number: number;
};

export type ProviderPullFile = {
	path: string;
	additions: number;
	deletions: number;
	status: "added" | "deleted" | "renamed" | "modified";
	/** The Geld category that sets this file aside, or null for one to review. */
	category: string | null;
};

export type ProviderPullThread = {
	id: string;
	path: string | null;
	line: number | null;
	resolved: boolean;
	outdated: boolean;
	author: string;
	excerpt: string;
	replies: number;
	url: string | null;
};

export type ProviderPullView = {
	provider: OpenableProvider;
	repository: string;
	number: number;
	title: string;
	body: string;
	author: string;
	authorAvatar: string | null;
	state: "open" | "closed" | "merged";
	draft: boolean;
	url: string;
	headBranch: string | null;
	updatedAt: string;
	labels: string[];
	/** Why there are no files when there are none: the diff was too large, or could not be had. */
	diff: "read" | "too-large" | "unavailable";
	files: ProviderPullFile[];
	toReview: { files: number; additions: number; deletions: number };
	setAside: { category: string; files: number; lines: number }[];
	/** Null when the provider would not list them. */
	threads: ProviderPullThread[] | null;
};

export type ProviderPullResult =
	| { ok: true; pull: ProviderPullView }
	| {
			ok: false;
			reason: "not-connected" | "reconnect" | "not-found" | "unavailable";
	  };

/** A repository's path split as the provider client wants it, or null for one that is no path. */
export function repositoryParts(
	repository: string,
): { owner: string; repo: string } | null {
	const slash = repository.lastIndexOf("/");
	if (slash < 1 || slash === repository.length - 1) return null;
	return {
		owner: repository.slice(0, slash),
		repo: repository.slice(slash + 1),
	};
}

function excerptOf(body: string): string {
	const text = body.replace(/\s+/g, " ").trim();
	return text.length <= EXCERPT_CHARS
		? text
		: `${text.slice(0, EXCERPT_CHARS).trimEnd()}…`;
}

function threadView(thread: ProviderThread): ProviderPullThread | null {
	const [first, ...rest] = thread.comments;
	if (!first) return null;
	return {
		id: thread.id,
		path: thread.path,
		line: thread.line,
		resolved: thread.resolved,
		outdated: thread.outdated,
		author: first.author,
		excerpt: excerptOf(first.body),
		replies: rest.length,
		url: first.url || null,
	};
}

export function providerPullView(
	input: ProviderPullInput,
	detail: PullDetail,
	diff: readonly FileStats[] | "too-large" | "unavailable",
	threads: readonly ProviderThread[] | null,
	matcher: PathMatcher,
): ProviderPullView {
	const stats = typeof diff === "string" ? [] : diff;
	const toReview = { files: 0, additions: 0, deletions: 0 };
	const aside = new Map<string, { category: string; files: number; lines: number }>();
	const files = stats.map((file): ProviderPullFile => {
		const category = matcher.categorizeFile(file);
		if (category === null) {
			toReview.files += 1;
			toReview.additions += file.additions;
			toReview.deletions += file.deletions;
		} else {
			const entry = aside.get(category.id) ?? {
				category: category.title,
				files: 0,
				lines: 0,
			};
			entry.files += 1;
			entry.lines += file.additions + file.deletions;
			aside.set(category.id, entry);
		}
		return {
			path: file.path,
			additions: file.additions,
			deletions: file.deletions,
			status: file.status ?? "modified",
			category: category?.title ?? null,
		};
	});
	return {
		provider: input.provider,
		repository: input.repository,
		number: input.number,
		title: detail.title,
		body: detail.body,
		author: detail.author,
		authorAvatar: detail.authorAvatar,
		state: detail.state,
		draft: detail.draft,
		url: detail.url,
		headBranch: detail.headBranch ?? null,
		updatedAt: detail.updatedAt,
		labels: [...detail.labels],
		diff: typeof diff === "string" ? diff : "read",
		files,
		toReview,
		setAside: [...aside.values()],
		threads:
			threads === null
				? null
				: threads.flatMap((thread) => threadView(thread) ?? []),
	};
}
