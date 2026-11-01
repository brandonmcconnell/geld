import type { ProviderReviewAuthor, ProviderReviewComment, ProviderReviewInput, ProviderReviewReviewer, ProviderReviewThread, RawCheckRun } from '@geld/review';
import type { ProviderReviewPanelEvent } from '../providers/review-panel';
import type { ProviderReviewPage, ProviderReviewSnapshot } from '../providers/types';
import { BitbucketApiError, BitbucketClient } from './api';
import type { BitbucketActivity, BitbucketAuthor, BitbucketComment, BitbucketPullRequest, BitbucketStatus, BitbucketTask } from './api';

export interface BitbucketReviewSnapshot extends ProviderReviewSnapshot {
  readonly tasks: readonly BitbucketTask[];
}

interface Unavailable {
  readonly area: string;
  readonly reason: string;
}

function reviewAuthor(author: BitbucketAuthor): ProviderReviewAuthor {
  return { id: author.id, login: author.login };
}

function canonicalUrl(value: string | null, page: ProviderReviewPage): URL | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    const base = new URL(page.url);
    return url.origin === page.repository.origin && url.protocol === 'https:' && url.username === '' && url.password === '' && (url.pathname === base.pathname || url.pathname.startsWith(`${base.pathname}/`)) ? url : null;
  } catch {
    return null;
  }
}

function normalizedComment(comment: BitbucketComment, page: ProviderReviewPage): ProviderReviewComment | null {
  if (comment.deleted || comment.author === null) return null;
  const url = canonicalUrl(comment.url, page);
  if (url === null) return null;
  let anchor: string;
  try {
    anchor = decodeURIComponent(url.hash.slice(1));
  } catch {
    return null;
  }
  if (anchor !== `comment-${comment.id}` && anchor !== `comment_${comment.id}`) return null;
  return { id: String(comment.id), anchor, url: url.href, author: reviewAuthor(comment.author), body: comment.body, createdAt: comment.createdAt, updatedAt: comment.updatedAt };
}

export function normalizeBitbucketComments(source: readonly BitbucketComment[], page: ProviderReviewPage): {
  readonly threads: readonly ProviderReviewThread[];
  readonly comments: readonly ProviderReviewComment[];
  readonly unavailable: readonly Unavailable[];
} {
  const unavailable: Unavailable[] = [];
  const indexed = new Map<number, BitbucketComment>();
  for (const comment of source) {
    if (indexed.has(comment.id)) unavailable.push({ area: 'comments', reason: `Bitbucket repeated comment ${comment.id} while loading.` });
    const prior = indexed.get(comment.id);
    if (prior === undefined || Date.parse(comment.updatedAt) > Date.parse(prior.updatedAt)) indexed.set(comment.id, comment);
  }
  const groups = new Map<number, BitbucketComment[]>();
  for (const comment of indexed.values()) {
    let root = comment;
    let rootId = comment.id;
    const seen = new Set<number>();
    let cycle = false;
    while (root.parentId !== null) {
      if (seen.has(root.id)) {
        cycle = true;
        break;
      }
      seen.add(root.id);
      rootId = root.parentId;
      const parent = indexed.get(rootId);
      if (parent === undefined) {
        unavailable.push({ area: 'comments', reason: `Bitbucket omitted parent comment ${rootId}.` });
        break;
      }
      root = parent;
    }
    if (cycle) {
      unavailable.push({ area: 'comments', reason: `Bitbucket returned a parent cycle for comment ${comment.id}.` });
      continue;
    }
    const group = groups.get(rootId) ?? [];
    group.push(comment);
    groups.set(rootId, group);
  }
  const threads: ProviderReviewThread[] = [];
  const comments: ProviderReviewComment[] = [];
  for (const [rootId, sourceComments] of groups) {
    sourceComments.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id);
    const normalized: ProviderReviewComment[] = [];
    for (const comment of sourceComments) {
      const sourceComment = normalizedComment(comment, page);
      if (sourceComment !== null) normalized.push(sourceComment);
      else if (!comment.deleted) unavailable.push({ area: 'comments', reason: `Bitbucket did not supply a usable author or canonical source link for comment ${comment.id}.` });
    }
    const first = normalized[0];
    if (first === undefined) continue;
    const root = indexed.get(rootId);
    const location = root?.path === null || root?.path === undefined ? sourceComments.find((comment) => comment.path !== null) : root;
    const threaded = sourceComments.length > 1 || location !== undefined || root?.resolved !== null && root?.resolved !== undefined;
    if (!threaded) {
      comments.push(first);
      continue;
    }
    const stateKnown = root !== undefined && root.resolved !== null && root.outdated !== null;
    if (!stateKnown) unavailable.push({ area: 'thread state', reason: `Bitbucket did not supply the native resolution or outdated state of thread ${rootId}.` });
    threads.push({
      id: String(rootId), anchor: first.anchor, url: first.url, comments: normalized,
      resolved: root?.resolved === true, outdated: root?.outdated === true, stateKnown,
      ...(location?.path === null || location?.path === undefined ? {} : { path: location.path }),
      ...(location?.line === null || location?.line === undefined || location.line <= 0 ? {} : { line: location.line }),
    });
  }
  return { threads, comments, unavailable };
}

function normalizeReviewers(pr: BitbucketPullRequest): readonly ProviderReviewReviewer[] {
  const reviewers = new Map<string, ProviderReviewReviewer>();
  for (const participant of pr.participants) {
    if (participant.role !== 'REVIEWER' && !participant.approved && !participant.changesRequested) continue;
    reviewers.set(participant.author.id, {
      author: reviewAuthor(participant.author),
      state: participant.changesRequested ? 'changes_requested' : participant.approved ? 'approved' : 'pending',
    });
  }
  return [...reviewers.values()];
}

function normalizeChecks(source: readonly BitbucketStatus[], headSha: string, unavailable: Unavailable[]): readonly RawCheckRun[] {
  const checks: RawCheckRun[] = [];
  for (const status of source) {
    if (status.sha === null) {
      unavailable.push({ area: 'CI checks', reason: `Bitbucket did not identify the commit for ${status.name}.` });
      continue;
    }
    if (status.sha !== headSha) continue;
    checks.push({
      name: status.name, sha: status.sha, status: status.state === 'INPROGRESS' ? 'in_progress' : 'completed',
      conclusion: status.state === 'INPROGRESS' ? null : status.state === 'SUCCESSFUL' ? 'success' : status.state === 'FAILED' ? 'failure' : 'cancelled',
      startedAt: status.createdAt,
      ...(status.state === 'INPROGRESS' ? {} : { completedAt: status.updatedAt }),
      ...(status.url === null ? {} : { detailsUrl: status.url }),
    });
  }
  return checks;
}

function normalizeEvents(source: readonly BitbucketActivity[], page: ProviderReviewPage, unavailable: Unavailable[]): readonly ProviderReviewPanelEvent[] {
  const events = new Map<string, ProviderReviewPanelEvent>();
  for (const event of source) {
    if (event.kind === 'comment') continue;
    if (event.kind === 'unknown') {
      unavailable.push({ area: 'activity', reason: 'Bitbucket returned a review activity this adapter could not classify.' });
      continue;
    }
    let body: string;
    if (event.kind === 'approval') body = 'Approved the pull request';
    else if (event.kind === 'changes-requested') body = 'Requested changes';
    else if (event.state === 'MERGED' && event.previousState !== null && event.previousState !== 'MERGED') body = 'Merged the pull request';
    else if (event.state === 'DECLINED' && event.previousState !== null && event.previousState !== 'DECLINED') body = 'Declined the pull request';
    else if (event.state === 'OPEN' && event.previousState !== null && event.previousState !== 'OPEN') body = 'Reopened the pull request';
    else if (event.headSha !== null) body = `Pushed ${event.headSha.slice(0, 8)}`;
    else body = 'Updated the pull request';
    if (event.author === null || event.at === null) {
      unavailable.push({ area: 'activity', reason: 'Bitbucket omitted the author or time of a review event.' });
      continue;
    }
    const id = `activity:${event.kind}:${event.at}:${event.author.id}:${event.headSha ?? event.state}:${event.previousState ?? ''}`;
    const stateChange = event.kind === 'update' && event.previousState !== null && event.state !== null && event.state !== event.previousState;
    events.set(id, { id, url: page.url, author: reviewAuthor(event.author), body, createdAt: event.at,
      kind: stateChange ? 'state' : event.kind === 'update' && event.headSha !== null ? 'push' : 'activity',
      ...(event.kind === 'update' && event.headSha !== null ? { headSha: event.headSha } : {}),
    });
  }
  return [...events.values()];
}

function taskEvents(tasks: readonly BitbucketTask[], comments: readonly BitbucketComment[], page: ProviderReviewPage, unavailable: Unavailable[]): readonly ProviderReviewPanelEvent[] {
  const events: ProviderReviewPanelEvent[] = [];
  const indexed = new Map(comments.map((comment) => [comment.id, comment]));
  for (const task of tasks) {
    const linkedComment = task.commentId === null ? undefined : indexed.get(task.commentId);
    const url = canonicalUrl(task.url ?? linkedComment?.url ?? null, page);
    if (url === null || task.creator === null || task.createdAt === null) {
      unavailable.push({ area: 'tasks', reason: `Bitbucket did not supply the source link, author or timestamp of task ${task.id}.` });
      continue;
    }
    events.push({ id: `task-${task.id}`, url: url.href, author: reviewAuthor(task.creator), body: `Task ${task.state === 'RESOLVED' ? 'resolved' : 'open'}: ${task.body}`, createdAt: task.createdAt, kind: 'task' });
  }
  return events;
}

function sourceResult<T>(area: string, result: PromiseSettledResult<readonly T[]>, unavailable: Unavailable[]): readonly T[] {
  if (result.status === 'fulfilled') return result.value;
  unavailable.push({ area, reason: result.reason instanceof Error ? result.reason.message : 'Bitbucket review source is unavailable.' });
  return [];
}

export async function fetchBitbucketReview(page: ProviderReviewPage, signal: AbortSignal, client = new BitbucketClient(page)): Promise<BitbucketReviewSnapshot> {
  const before = await client.pullRequest(signal);
  const [commentResult, taskResult, activityResult, statusResult] = await Promise.allSettled([
    client.comments(signal), client.tasks(signal), client.activity(signal), client.statuses(signal),
  ]);
  if (signal.aborted) throw new DOMException('Review request aborted.', 'AbortError');
  const after = await client.pullRequest(signal);
  if (before.headSha !== after.headSha || before.baseSha !== after.baseSha || page.headSha !== null && before.headSha !== page.headSha) throw new BitbucketApiError('changed', 'Bitbucket changed the review while its conversation was loading.');
  const unavailable: Unavailable[] = [];
  const sourceComments = sourceResult('comments', commentResult, unavailable);
  const tasks = sourceResult('tasks', taskResult, unavailable);
  const activity = sourceResult('activity', activityResult, unavailable);
  const statuses = sourceResult('CI checks', statusResult, unavailable);
  const normalized = normalizeBitbucketComments(sourceComments, page);
  unavailable.push(...normalized.unavailable);
  const checks = normalizeChecks(statuses, before.headSha, unavailable);
  const events = [...normalizeEvents(activity, page, unavailable), ...taskEvents(tasks, sourceComments, page, unavailable)];
  unavailable.push({ area: 'approval requirements', reason: 'Bitbucket did not supply repository approval requirements in the review response.' });
  const complete = unavailable.length === 0;
  const input: ProviderReviewInput = {
    subject: { provider: 'bitbucket', origin: page.repository.origin, repository: page.repository.path, id: page.number, headSha: before.headSha },
    threads: normalized.threads, reviewers: normalizeReviewers(before), checks, bots: [], complete,
    closed: after.state === 'DECLINED' || after.state === 'MERGED' || after.state === 'SUPERSEDED',
  };
  const commentsCoverage = commentResult.status === 'rejected' ? 'unavailable' : normalized.unavailable.some((source) => source.area === 'comments') ? 'partial' : 'complete';
  const threadsCoverage = commentsCoverage !== 'complete' ? commentsCoverage : normalized.unavailable.some((source) => source.area === 'thread state') ? 'partial' : 'complete';
  return { input, comments: normalized.comments, sourceCoverage: { comments: commentsCoverage, threads: threadsCoverage }, events, tasks, complete, unavailable, approvalsRequired: null, approvalsLeft: null, actions: [] };
}
