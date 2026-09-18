/**
 * Turn a fetched pull request (threads, comments, reviews, checks) into
 * GeldPrMeta. Pure; the Action supplies GitHub data and optional AI output.
 */

import type { AddressedEvidence, GeldPrMeta, ProducerRecord, ReviewItem, ReviewSummary, ReviewerRecord, ReviewerState } from './model';
import { META_VERSION, PAYLOAD_BUDGET, STATUS_RANK, truncateMeta } from './model';
import { looksLikeBotLogin, resolveBotId, verdictsFrom } from './bots';
import type { RawCheckRun } from './bots';
import type { RawComment } from './cluster';
import { clusterComments, isBotOnly } from './cluster';
import { applyAddressedAll } from './addressed';
import type { Carried } from './consolidate';
import { applyConsolidation, fixVisible } from './consolidate';
import { looksLikeSummaryBody, tickedItemIds } from './summary-parse';
import type { AddressedOutputItem, ConsolidateOutputItem } from './prompts';

export interface RawThreadComment {
  readonly databaseId: number;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface RawThread {
  readonly path: string | null;
  readonly line: number | null;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly comments: readonly RawThreadComment[];
}

export interface RawIssueComment {
  readonly databaseId: number;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface RawReview {
  readonly databaseId: number;
  readonly author: string;
  readonly state: string;
  readonly body: string;
  readonly submittedAt: string | null;
  readonly commitOid: string | null;
}

export interface RawPullRequest {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly headSha: string;
  readonly threads: readonly RawThread[];
  readonly comments: readonly RawIssueComment[];
  readonly reviews: readonly RawReview[];
  readonly checks: readonly RawCheckRun[];
  /** Paths changed on the PR (for the addressed rubric). */
  readonly changedPaths?: readonly string[];
}

export interface BuildOptions {
  readonly producer: ProducerRecord;
  readonly generatedAt: string;
  readonly extraBotLogins?: readonly string[];
  readonly previous?: GeldPrMeta | null;
  readonly previousBody?: string;
  /** Fresh model output for items whose sources changed. */
  readonly rewritten?: readonly ConsolidateOutputItem[];
  /** Previous model output for items whose sources did not change. */
  readonly carried?: ReadonlyMap<string, Carried>;
  readonly semantic?: readonly AddressedOutputItem[];
  readonly summary?: ReviewSummary;
  /** Which suggested fixes to keep in the payload; `bots` by default. */
  readonly suggestedFixes?: 'all' | 'bots' | 'ai' | 'off';
  readonly budget?: number;
  /** Soft cap on items (open first) before the character budget. */
  readonly maxItems?: number;
}

const REVIEWER_STATE: Readonly<Record<string, ReviewerState>> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  COMMENTED: 'commented',
  PENDING: 'pending',
  DISMISSED: 'commented',
};

function reviewerState(raw: string): ReviewerState {
  return REVIEWER_STATE[raw.toUpperCase()] ?? 'commented';
}

function threadToComment(thread: RawThread): RawComment | null {
  const first = thread.comments[0];
  if (first === undefined) return null;
  const path = thread.path === null || thread.path === '' ? undefined : thread.path;
  const line = thread.line === null || thread.line <= 0 ? undefined : thread.line;
  const comment: RawComment = {
    anchor: `discussion_r${first.databaseId}`,
    kind: 'thread',
    author: first.author,
    body: first.body,
    createdAt: first.createdAt,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    threadAnchors: thread.comments.map((entry) => ({
      anchor: `discussion_r${entry.databaseId}`,
      kind: 'thread',
      author: entry.author,
      body: entry.body,
    })),
  };
  if (path !== undefined && line !== undefined) return { ...comment, path, line };
  if (path !== undefined) return { ...comment, path };
  if (line !== undefined) return { ...comment, line };
  return comment;
}

/** The comments `buildMeta` clusters, for callers that need excerpts (consolidation prompts). */
export function rawCommentsOf(pr: RawPullRequest): readonly RawComment[] {
  return collectRawComments(pr);
}

function collectRawComments(pr: RawPullRequest): readonly RawComment[] {
  const comments: RawComment[] = [];
  for (const thread of pr.threads) {
    const converted = threadToComment(thread);
    if (converted !== null) comments.push(converted);
  }
  for (const comment of pr.comments) {
    if (looksLikeSummaryBody(comment.body)) continue;
    comments.push({
      anchor: `issuecomment-${comment.databaseId}`,
      kind: 'comment',
      author: comment.author,
      body: comment.body,
      createdAt: comment.createdAt,
    });
  }
  for (const review of pr.reviews) {
    if (review.body.trim() === '') continue;
    comments.push({
      anchor: `pullrequestreview-${review.databaseId}`,
      kind: 'review',
      author: review.author,
      body: review.body,
      createdAt: review.submittedAt ?? '',
    });
  }
  return comments;
}

function reviewersOf(pr: RawPullRequest): readonly ReviewerRecord[] {
  const latest = new Map<string, ReviewerState>();
  for (const review of pr.reviews) {
    if (looksLikeBotLogin(review.author)) continue;
    latest.set(review.author, reviewerState(review.state));
  }
  return [...latest.entries()].map(([login, state]) => ({ login, state }));
}

function foldOf(pr: RawPullRequest, extraLogins: readonly string[]): { comments: string[]; events: string[] } {
  const comments: string[] = [];
  for (const comment of pr.comments) {
    if (looksLikeSummaryBody(comment.body)) continue;
    if (resolveBotId(comment.author, extraLogins) !== null || looksLikeBotLogin(comment.author)) {
      comments.push(`issuecomment-${comment.databaseId}`);
    }
  }
  for (const review of pr.reviews) {
    if (looksLikeBotLogin(review.author) && review.body.trim() !== '') {
      comments.push(`pullrequestreview-${review.databaseId}`);
    }
  }
  return { comments, events: [] };
}

function humanRepliedIn(item: ReviewItem, pr: RawPullRequest): boolean {
  const anchors = new Set(item.sources.map((source) => source.anchor));
  for (const thread of pr.threads) {
    const ids = thread.comments.map((entry) => `discussion_r${entry.databaseId}`);
    if (!ids.some((id) => anchors.has(id))) continue;
    let lastBot = -1;
    let lastHuman = -1;
    thread.comments.forEach((entry, index) => {
      if (looksLikeBotLogin(entry.author)) lastBot = index;
      else lastHuman = index;
    });
    if (lastBot >= 0 && lastHuman > lastBot) return true;
  }
  return false;
}

function keepAllowedFixes(items: readonly ReviewItem[], mode: 'all' | 'bots' | 'ai' | 'off'): readonly ReviewItem[] {
  return items.map((item) => {
    if (item.fix === undefined || fixVisible(item.fix, mode)) return item;
    const { fix: _dropped, ...rest } = item;
    return rest;
  });
}

function semanticMap(entries: readonly AddressedOutputItem[]): Map<string, AddressedEvidence> {
  const map = new Map<string, AddressedEvidence>();
  for (const entry of entries) {
    map.set(entry.id, { verdict: entry.verdict, evidence: entry.evidence });
  }
  return map;
}

export function buildMeta(pr: RawPullRequest, options: BuildOptions): GeldPrMeta {
  const extra = options.extraBotLogins ?? [];
  const raw = collectRawComments(pr);
  let items = clusterComments(raw, extra);
  const previous = options.previous ?? null;
  const previousBody = options.previousBody ?? '';
  const manualDone = new Set<string>([
    ...(previous?.items.filter((item) => item.status === 'done-manual').map((item) => item.id) ?? []),
    ...(previous !== null ? tickedItemIds(previousBody, previous.items) : []),
  ]);
  items = applyAddressedAll(
    items,
    (item) => ({
      changedPaths: pr.changedPaths ?? [],
      manualDoneIds: manualDone,
      humanReplied: humanRepliedIn(item, pr),
    }),
    semanticMap(options.semantic ?? []),
  );
  // People's words stay theirs: model output is applied to bot-only items only.
  const botOnlyOutputs = (options.rewritten ?? []).filter((entry) => items.some((item) => item.id === entry.id && isBotOnly(item)));
  items = applyConsolidation(items, options.carried ?? new Map<string, Carried>(), botOnlyOutputs);
  items = keepAllowedFixes(items, options.suggestedFixes ?? 'bots');
  const maxItems = options.maxItems;
  const uncappedCount = items.length;
  if (maxItems !== undefined && items.length > maxItems) {
    items = [...items].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]).slice(0, maxItems);
  }

  const botComments = [
    ...pr.comments.map((comment) => ({ author: comment.author, body: comment.body, anchor: `issuecomment-${comment.databaseId}` })),
    ...pr.reviews.map((review) => ({ author: review.author, body: review.body, anchor: `pullrequestreview-${review.databaseId}` })),
  ];
  const bots = verdictsFrom(pr.checks, botComments, pr.headSha, extra);
  const meta: GeldPrMeta = {
    v: META_VERSION,
    generatedAt: options.generatedAt,
    headSha: pr.headSha,
    producer: options.producer,
    items,
    bots,
    reviewers: reviewersOf(pr),
    fold: foldOf(pr, extra),
    ...(uncappedCount > items.length ? { truncated: true as const } : {}),
    ...(options.summary === undefined ? {} : { summary: options.summary }),
  };
  return truncateMeta(meta, options.budget ?? PAYLOAD_BUDGET);
}

/** Bot-only items the Action/extension may send to a model for titles. */
export function botOnlyForRewrite(items: readonly ReviewItem[]): readonly ReviewItem[] {
  return items.filter(isBotOnly);
}
