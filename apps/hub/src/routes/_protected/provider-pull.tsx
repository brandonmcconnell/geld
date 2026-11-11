import { createFileRoute, Link } from "@tanstack/react-router";
import { AppMarkdown } from "#/components/markdown/app-markdown";
import { PROVIDER_NAMES } from "#/lib/providers/connections";
import {
	isOpenableProvider,
	type OpenableProvider,
	type ProviderPullFile,
	type ProviderPullResult,
	type ProviderPullThread,
	type ProviderPullView,
} from "#/lib/providers/provider-pull";
import { getProviderPull } from "#/lib/providers/provider-pull.functions";
import { buildSeo, formatPageTitle } from "#/lib/seo";

type Search = { provider: OpenableProvider; repository: string; number: number };

export const Route = createFileRoute("/_protected/provider-pull")({
	validateSearch: (raw: Record<string, unknown>): Search => ({
		provider: isOpenableProvider(raw.provider) ? raw.provider : "gitlab",
		repository: typeof raw.repository === "string" ? raw.repository : "",
		number: Number.isInteger(Number(raw.number)) ? Number(raw.number) : 0,
	}),
	loaderDeps: ({ search }) => search,
	loader: ({ deps }): Promise<ProviderPullResult> =>
		getProviderPull({ data: deps }),
	head: ({ match }) =>
		buildSeo({
			path: match.pathname,
			title: formatPageTitle("Pull request"),
			description: "A pull request from a connected provider.",
			robots: "noindex",
		}),
	component: ProviderPullPage,
});

const WHY: Record<
	Exclude<ProviderPullResult, { ok: true }>["reason"],
	(name: string) => string
> = {
	"not-connected": (name) => `Connect ${name} to open this here.`,
	reconnect: (name) => `${name} refused. Connect it again to open this here.`,
	"not-found": (name) => `${name} has no such pull request, or you cannot see it.`,
	unavailable: (name) => `${name} did not answer. Try again in a moment.`,
};

const STATE_WORDS: Record<ProviderPullView["state"], string> = {
	open: "Open",
	closed: "Closed",
	merged: "Merged",
};

const STATE_CLASS: Record<ProviderPullView["state"], string> = {
	open: "text-success",
	closed: "text-destructive",
	merged: "text-muted-foreground",
};

const FILE_MARK: Record<ProviderPullFile["status"], string> = {
	added: "A",
	deleted: "D",
	renamed: "R",
	modified: "M",
};

const card = "overflow-hidden rounded-lg bg-card shadow-card";
const cardHead =
	"flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-[0.5px] border-rule bg-group/60 px-4 py-3";

function plural(amount: number, one: string, many: string): string {
	return `${amount} ${amount === 1 ? one : many}`;
}

function ProviderPullPage() {
	const result = Route.useLoaderData();
	const search = Route.useSearch();
	const name = PROVIDER_NAMES[search.provider];

	if (!result.ok) {
		return (
			<div
				className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-10"
				data-testid="provider-pull-missing"
			>
				<h1 className="text-base font-semibold">
					{search.repository} #{search.number}
				</h1>
				<p role="status" className="text-sm text-muted-foreground">
					{WHY[result.reason](name)}
				</p>
				{result.reason === "not-connected" || result.reason === "reconnect" ? (
					<p>
						<Link
							to="/settings/connections"
							search={{ error: undefined }}
							className="text-sm underline underline-offset-2"
						>
							Connections
						</Link>
					</p>
				) : null}
			</div>
		);
	}

	const { pull } = result;
	return (
		<div
			className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8"
			data-testid="provider-pull"
		>
			<header className="flex flex-col gap-2">
				<p className="text-xs text-muted-foreground">
					{name} · {pull.repository} #{pull.number}
				</p>
				<h1 className="text-xl font-semibold text-balance">{pull.title}</h1>
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
					<span className={`font-medium ${STATE_CLASS[pull.state]}`}>
						{pull.draft && pull.state === "open"
							? "Draft"
							: STATE_WORDS[pull.state]}
					</span>
					<span aria-hidden>·</span>
					<span>{pull.author}</span>
					{pull.headBranch ? (
						<>
							<span aria-hidden>·</span>
							<code className="rounded bg-group px-1 py-px text-xs">
								{pull.headBranch}
							</code>
						</>
					) : null}
					<a
						href={pull.url}
						target="_blank"
						rel="noopener noreferrer"
						className="ml-auto underline underline-offset-2 hover:text-foreground"
					>
						Open on {name}
					</a>
				</p>
			</header>

			{pull.body.trim() ? (
				<AppMarkdown className="text-[15px] leading-6 text-text-header">
					{pull.body}
				</AppMarkdown>
			) : (
				<p className="text-sm text-muted-foreground">No description.</p>
			)}

			<FilesCard pull={pull} name={name} />
			<ThreadsCard threads={pull.threads} name={name} />

			<p className="text-xs text-muted-foreground">
				Read from {name} for this page and not stored. Commenting and
				reviewing happen on {name} for now.
			</p>
		</div>
	);
}

function FilesCard({ pull, name }: { pull: ProviderPullView; name: string }) {
	const lines = pull.toReview.additions + pull.toReview.deletions;
	return (
		<section aria-label="Files" className={card} data-testid="provider-pull-files">
			<div className={cardHead}>
				<h2 className="text-sm font-medium text-foreground">Files</h2>
				{pull.diff === "read" ? (
					<p className="text-xs text-muted-foreground tabular-nums">
						{plural(lines, "line", "lines")} to review in{" "}
						{plural(pull.toReview.files, "file", "files")}
						{pull.setAside.map((entry) => (
							<span key={entry.category}>
								{" "}
								· {entry.category} {entry.files}
							</span>
						))}
					</p>
				) : null}
			</div>
			{pull.diff === "read" ? (
				pull.files.length === 0 ? (
					<p className="px-4 py-4 text-[13px] text-muted-foreground">
						No files changed.
					</p>
				) : (
					<ul>
						{pull.files.map((file) => (
							<li
								key={file.path}
								className="flex items-center gap-2.5 px-4 py-1.5 text-[13px] not-first:border-t-[0.5px] not-first:border-rule"
							>
								<span
									className="w-3 shrink-0 text-center font-mono text-xs text-muted-foreground"
									title={file.status}
								>
									{FILE_MARK[file.status]}
								</span>
								<span
									className={`min-w-0 flex-1 truncate font-mono text-xs ${file.category ? "text-muted-foreground" : "text-foreground"}`}
								>
									{file.path}
								</span>
								{file.category ? (
									<span className="shrink-0 rounded-full border-[0.5px] border-dashed border-rule px-1.5 text-xs text-muted-foreground">
										{file.category}
									</span>
								) : null}
								<span className="shrink-0 text-xs tabular-nums">
									<span className="text-success">+{file.additions}</span>{" "}
									<span className="text-destructive">-{file.deletions}</span>
								</span>
							</li>
						))}
					</ul>
				)
			) : (
				<p className="px-4 py-4 text-[13px] text-muted-foreground">
					{pull.diff === "too-large"
						? `This diff is too large to list here. Open it on ${name}.`
						: `${name} did not give the diff. Open it on ${name}.`}
				</p>
			)}
		</section>
	);
}

function ThreadsCard({
	threads,
	name,
}: {
	threads: ProviderPullThread[] | null;
	name: string;
}) {
	const open = threads?.filter((thread) => !thread.resolved).length ?? 0;
	return (
		<section
			aria-label="Threads"
			className={card}
			data-testid="provider-pull-threads"
		>
			<div className={cardHead}>
				<h2 className="text-sm font-medium text-foreground">Threads</h2>
				{threads && threads.length > 0 ? (
					<p className="text-xs text-muted-foreground tabular-nums">
						{open} open of {threads.length}
					</p>
				) : null}
			</div>
			{threads === null ? (
				<p className="px-4 py-4 text-[13px] text-muted-foreground">
					{name} did not list the threads.
				</p>
			) : threads.length === 0 ? (
				<p className="px-4 py-4 text-[13px] text-muted-foreground">
					No review threads.
				</p>
			) : (
				<ul>
					{threads.map((thread) => (
						<li
							key={thread.id}
							className="flex flex-col gap-0.5 px-4 py-2.5 not-first:border-t-[0.5px] not-first:border-rule"
						>
							<p className="flex items-center gap-2 text-xs text-muted-foreground">
								<span
									className={
										thread.resolved ? "text-success" : "text-warning"
									}
								>
									{thread.resolved ? "Resolved" : "Open"}
								</span>
								<span className="font-medium text-foreground">
									{thread.author}
								</span>
								{thread.path ? (
									<span className="min-w-0 truncate font-mono">
										{thread.path}
										{thread.line ? `:${thread.line}` : ""}
									</span>
								) : null}
								{thread.outdated ? <span>Outdated</span> : null}
								{thread.replies > 0 ? (
									<span className="ml-auto shrink-0">
										{plural(thread.replies, "reply", "replies")}
									</span>
								) : null}
							</p>
							<p className="text-[13px] text-foreground">{thread.excerpt}</p>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
