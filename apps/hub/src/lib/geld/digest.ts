import { botTitle } from "@geld/review/bots";
import {
  buildMeta,
  type RawPullRequest,
  type RawThread,
} from "@geld/review/build";
import {
  type BotVerdictRecord,
  type GeldPrMeta,
  isOpenStatus,
  type ReviewItem,
  threadCounts,
} from "@geld/review/model";
import type {
  PullComment,
  PullReviewComment,
  PullStatus,
  ReviewThreadInfo,
} from "#/lib/github.types";

export type DigestSource = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  headSha: string;
  comments: readonly PullComment[];
  reviewComments: readonly PullReviewComment[];
  threads: readonly ReviewThreadInfo[];
  status: PullStatus | undefined;
};

const UNKNOWN_AUTHOR = "ghost";

function threadsOf(source: DigestSource): RawThread[] {
  const resolved = new Map(
    source.threads.map((thread) => [thread.firstCommentId, thread.isResolved])
  );
  const byRoot = new Map<number, PullReviewComment[]>();
  for (const comment of source.reviewComments) {
    const root = comment.inReplyToId ?? comment.id;
    byRoot.set(root, [...(byRoot.get(root) ?? []), comment]);
  }
  const threads: RawThread[] = [];
  for (const [root, comments] of byRoot) {
    const ordered = [...comments].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
    const first = ordered[0];
    if (first === undefined) continue;
    threads.push({
      path: first.path,
      line: first.line,
      isResolved: resolved.get(root) ?? false,
      isOutdated: false,
      comments: ordered.map((comment) => ({
        databaseId: comment.id,
        author: comment.author?.login ?? UNKNOWN_AUTHOR,
        body: comment.body,
        createdAt: comment.createdAt,
      })),
    });
  }
  return threads;
}

/** The page's own data in the shape Geld's digest is built from, the one the Action reads from the API. */
export function digestInputFrom(source: DigestSource): RawPullRequest {
  return {
    title: source.title,
    owner: source.owner,
    repo: source.repo,
    number: source.number,
    headSha: source.headSha,
    threads: threadsOf(source),
    comments: source.comments.map((comment) => ({
      databaseId: comment.id,
      author: comment.author?.login ?? UNKNOWN_AUTHOR,
      body: comment.body,
      createdAt: comment.createdAt,
      ...(comment.editedAt ? { editedAt: comment.editedAt } : {}),
    })),
    reviews: (source.status?.reviews ?? []).map((review) => ({
      databaseId: review.id,
      author: review.author?.login ?? UNKNOWN_AUTHOR,
      state: review.state,
      body: "",
      submittedAt: null,
      commitOid: null,
    })),
    checks: (source.status?.checkRuns ?? []).map((run) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      sha: source.headSha,
      ...(run.htmlUrl ? { detailsUrl: run.htmlUrl } : {}),
      ...(run.outputTitle ? { description: run.outputTitle } : {}),
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    })),
  };
}

export type DigestBot = {
  id: string;
  name: string;
  words: string;
  tone: "good" | "warn" | "bad" | "muted";
};

export type PullDigest = {
  threads: { total: number; open: number };
  open: readonly ReviewItem[];
  settled: readonly ReviewItem[];
  bots: readonly DigestBot[];
};

function botWords(bot: BotVerdictRecord): Pick<DigestBot, "words" | "tone"> {
  switch (bot.verdict) {
    case "clean":
      return {
        words: bot.score === undefined ? "clean" : `${bot.score}/5`,
        tone: "good",
      };
    case "findings":
      if (bot.needsHuman) return { words: "needs human", tone: "warn" };
      if (bot.count === undefined) return { words: "findings", tone: "warn" };
      return {
        words: bot.count === 1 ? "1 issue" : `${bot.count} issues`,
        tone: bot.severity === "high" ? "bad" : "warn",
      };
    case "running":
    case "loading":
      return { words: "running", tone: "muted" };
    case "failed":
      return bot.reason
        ? { words: "skipped", tone: "warn" }
        : { words: "failed", tone: "bad" };
    default:
      return { words: "no word", tone: "muted" };
  }
}

export function pullDigestFrom(meta: GeldPrMeta): PullDigest {
  return {
    threads: threadCounts(meta.items),
    open: meta.items.filter((item) => isOpenStatus(item.status)),
    settled: meta.items.filter((item) => !isOpenStatus(item.status)),
    bots: meta.bots.map((bot) => ({
      id: bot.id,
      name: botTitle(bot.id, bot.login),
      ...botWords(bot),
    })),
  };
}

export function buildPullDigest(source: DigestSource, now: Date): PullDigest {
  return pullDigestFrom(
    buildMeta(digestInputFrom(source), {
      producer: { kind: "app", version: "hub", ai: false },
      generatedAt: now.toISOString(),
    })
  );
}
