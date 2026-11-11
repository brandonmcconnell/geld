import {
  AlertCircleIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleIcon,
} from "@geld/hub-icons";
import { cn } from "@geld/hub-ui/lib/utils";
import { stripInlineMarkdown } from "@geld/review/inline-markdown";
import type { ReviewItem } from "@geld/review/model";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { buildPullDigest, type DigestBot } from "#/lib/geld/digest";
import {
  type GitHubQueryScope,
  githubPullStatusQueryOptions,
} from "#/lib/github.query";
import type {
  PullComment,
  PullDetail,
  PullReviewComment,
  ReviewThreadInfo,
} from "#/lib/github.types";

const TONE_CLASS: Record<DigestBot["tone"], string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

function BotPill({ bot }: { bot: DigestBot }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border-[0.5px] border-rule px-2 py-0.5 text-xs">
      <span className="font-medium text-foreground">{bot.name}</span>
      <span className={TONE_CLASS[bot.tone]}>{bot.words}</span>
    </span>
  );
}

function authorsOf(item: ReviewItem): string {
  return [...new Set(item.sources.map((source) => source.author))].join(", ");
}

function ItemRow({
  item,
  settled,
  owner,
  repo,
  pullNumber,
}: {
  item: ReviewItem;
  settled: boolean;
  owner: string;
  repo: string;
  pullNumber: number;
}) {
  const place = item.path
    ? item.line
      ? `${item.path}:${item.line}`
      : item.path
    : null;
  return (
    <li>
      <Link
        to="/$owner/$repo/review/$pullId"
        params={{ owner, repo, pullId: String(pullNumber) }}
        className="flex items-center gap-2.5 px-4 py-2 text-[13px] hover:bg-group/60"
      >
        {settled ? (
          <CircleCheckIcon size={14} className="shrink-0 text-success" />
        ) : item.severity === "blocking" ? (
          <AlertCircleIcon size={14} className="shrink-0 text-destructive" />
        ) : (
          <CircleIcon size={14} className="shrink-0 text-warning" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {stripInlineMarkdown(item.title)}
        </span>
        {place ? (
          <span className="hidden max-w-[40%] shrink-0 truncate font-mono text-xs text-muted-foreground md:inline">
            {place}
          </span>
        ) : null}
        <span className="shrink-0 text-xs text-muted-foreground">
          {authorsOf(item)}
        </span>
      </Link>
    </li>
  );
}

/**
 * Where the review stands, before the timeline: how many threads are left,
 * what each review bot said, and one line per thread. Built in the browser
 * from what the page already loaded.
 */
export function PullDigestSection({
  pr,
  owner,
  repo,
  pullNumber,
  scope,
  comments,
  reviewComments,
  threads,
}: {
  pr: PullDetail;
  owner: string;
  repo: string;
  pullNumber: number;
  scope: GitHubQueryScope;
  comments: readonly PullComment[];
  reviewComments: readonly PullReviewComment[] | undefined;
  threads: readonly ReviewThreadInfo[] | undefined;
}) {
  const [showSettled, setShowSettled] = useState(false);
  const { data: status } = useQuery({
    ...githubPullStatusQueryOptions(scope, { owner, repo, pullNumber }),
    enabled: Boolean(reviewComments && threads),
  });
  const digest = useMemo(() => {
    if (!(reviewComments && threads)) return null;
    return buildPullDigest(
      {
        owner,
        repo,
        number: pullNumber,
        title: pr.title,
        headSha: pr.headSha,
        comments,
        reviewComments,
        threads,
        status: status ?? undefined,
      },
      new Date()
    );
  }, [
    owner,
    repo,
    pullNumber,
    pr.title,
    pr.headSha,
    comments,
    reviewComments,
    threads,
    status,
  ]);

  if (!digest || (digest.threads.total === 0 && digest.bots.length === 0)) {
    return null;
  }

  const resolved = digest.threads.total - digest.threads.open;
  const share =
    digest.threads.total === 0 ? 0 : (resolved / digest.threads.total) * 100;

  return (
    <section
      aria-label="Digest"
      data-testid="pull-digest"
      className="overflow-hidden rounded-lg bg-card shadow-card"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-[0.5px] border-rule bg-group/60 px-4 py-3">
        <h3 className="text-sm font-medium text-foreground">Digest</h3>
        {digest.threads.total > 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            <span
              aria-hidden
              className="h-1.5 w-24 overflow-hidden rounded-full bg-rule"
            >
              <span
                className="block h-full rounded-full bg-success"
                style={{ width: `${share}%` }}
              />
            </span>
            <span>
              {resolved} of {digest.threads.total}{" "}
              {digest.threads.total === 1 ? "thread" : "threads"} resolved
            </span>
          </div>
        ) : null}
        {digest.bots.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 md:ml-auto">
            {digest.bots.map((bot) => (
              <BotPill key={bot.id} bot={bot} />
            ))}
          </div>
        ) : null}
      </div>
      {digest.open.length > 0 ? (
        <ul className="divide-y-[0.5px] divide-rule">
          {digest.open.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              settled={false}
              owner={owner}
              repo={repo}
              pullNumber={pullNumber}
            />
          ))}
        </ul>
      ) : digest.threads.total > 0 ? (
        <p className="px-4 py-2.5 text-[13px] text-muted-foreground">
          Every thread is resolved.
        </p>
      ) : null}
      {digest.settled.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={showSettled}
            onClick={() => setShowSettled((shown) => !shown)}
            className="flex w-full items-center gap-1.5 border-t-[0.5px] border-rule px-4 py-2 text-xs text-muted-foreground hover:bg-group/60"
          >
            <ChevronDownIcon
              size={12}
              className={cn(
                "transition-transform",
                showSettled ? null : "-rotate-90"
              )}
            />
            {digest.settled.length} resolved{" "}
            {digest.settled.length === 1 ? "thread" : "threads"}
          </button>
          {showSettled ? (
            <ul className="divide-y-[0.5px] divide-rule border-t-[0.5px] border-rule">
              {digest.settled.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  settled
                  owner={owner}
                  repo={repo}
                  pullNumber={pullNumber}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
