/**
 * GitHub GraphQL + REST used by the Action. Token-only; never clones the
 * pull request. Pagination is followed until the cursor is exhausted.
 */

import { isAllowedSummaryAuthor, looksLikeSummaryBody, parseSummaryBody } from '@geld/review';
import type { GeldPrMeta } from '@geld/review';
import type { RawCheckRun } from '@geld/review';
import type { RawIssueComment, RawPullRequest, RawReview, RawThread } from '@geld/review';

const API = 'https://api.github.com';
const GRAPHQL = `${API}/graphql`;

export interface GithubClient {
  readonly token: string;
  readonly fetch: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function githubJson(client: GithubClient, url: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${client.token}`);
  headers.set('accept', 'application/vnd.github+json');
  headers.set('x-github-api-version', '2022-11-28');
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await client.fetch(url, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub ${response.status} ${url}: ${text.slice(0, 400)}`);
  return text === '' ? null : JSON.parse(text);
}

async function graphql(client: GithubClient, query: string, variables: Record<string, unknown>): Promise<unknown> {
  const body = await githubJson(client, GRAPHQL, { method: 'POST', body: JSON.stringify({ query, variables }) });
  if (!isRecord(body)) throw new Error('GitHub GraphQL returned a non-object.');
  if (body.errors !== undefined) throw new Error(`GitHub GraphQL: ${JSON.stringify(body.errors).slice(0, 400)}`);
  return body.data;
}

interface GeldPrQuery {
  readonly repository: { readonly pullRequest: GqlPr | null };
}

/** GraphQL `data` matches the selection set below; GitHub does not type it for us. */
function assertPrQuery(value: unknown): asserts value is GeldPrQuery {
  if (!isRecord(value) || !isRecord(value.repository)) {
    throw new Error('GitHub GraphQL returned an unexpected pull request payload.');
  }
}

const PR_QUERY = `
query GeldPr($owner: String!, $name: String!, $number: Int!, $threadCursor: String, $commentCursor: String, $reviewCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      headRefOid
      reviewThreads(first: 50, after: $threadCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes { databaseId author { login __typename } body createdAt }
          }
        }
      }
      comments(first: 50, after: $commentCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { databaseId author { login __typename } body createdAt lastEditedAt }
      }
      reviews(first: 50, after: $reviewCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { databaseId author { login __typename } state body submittedAt commit { oid } }
      }
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              contexts: contexts(first: 100) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion startedAt completedAt }
                  ... on StatusContext { context state }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

interface PageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

interface GqlAuthor {
  readonly login: string | null;
  readonly __typename?: string;
}

interface GqlThreadComment {
  readonly databaseId: number;
  readonly author: GqlAuthor | null;
  readonly body: string;
  readonly createdAt: string;
}

interface GqlThread {
  readonly id: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly path: string | null;
  readonly line: number | null;
  readonly comments: { readonly pageInfo: PageInfo; readonly nodes: readonly GqlThreadComment[] };
}

/**
 * The rest of one thread's comments, for a thread longer than the first
 * query's page. A reply past that page is as much a part of the thread as
 * the first — a person's answer there decides whether the item still needs
 * one — so every thread is read to its end.
 */
const THREAD_COMMENTS_QUERY = `
query GeldThreadComments($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { databaseId author { login __typename } body createdAt }
      }
    }
  }
}
`;

interface GeldThreadCommentsQuery {
  readonly node: { readonly comments: { readonly pageInfo: PageInfo; readonly nodes: readonly GqlThreadComment[] } } | null;
}

function assertThreadCommentsQuery(value: unknown): asserts value is GeldThreadCommentsQuery {
  if (!isRecord(value) || !('node' in value)) throw new Error('GitHub GraphQL returned an unexpected shape for the thread comments.');
}

async function remainingThreadComments(client: GithubClient, threadId: string, first: { readonly pageInfo: PageInfo; readonly nodes: readonly GqlThreadComment[] }): Promise<readonly GqlThreadComment[]> {
  const nodes = [...first.nodes];
  let cursor = first.pageInfo.endCursor;
  let more = first.pageInfo.hasNextPage;
  while (more && cursor !== null) {
    const data = await graphql(client, THREAD_COMMENTS_QUERY, { id: threadId, cursor });
    assertThreadCommentsQuery(data);
    if (data.node === null) break;
    nodes.push(...data.node.comments.nodes);
    more = data.node.comments.pageInfo.hasNextPage;
    cursor = data.node.comments.pageInfo.endCursor;
  }
  return nodes;
}

interface GqlComment {
  readonly databaseId: number;
  readonly author: GqlAuthor | null;
  readonly body: string;
  readonly createdAt: string;
  /** Issue comments only (the query asks for it there); null when never edited. */
  readonly lastEditedAt?: string | null;
}

interface GqlReview {
  readonly databaseId: number;
  readonly author: GqlAuthor | null;
  readonly state: string;
  readonly body: string;
  readonly submittedAt: string | null;
  readonly commit: { readonly oid: string } | null;
}

interface GqlCheckContext {
  readonly __typename: string;
  readonly name?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly context?: string;
  readonly state?: string;
}

interface GqlCheckContexts {
  readonly pageInfo: PageInfo;
  readonly nodes: readonly GqlCheckContext[];
}

interface GqlPr {
  readonly number: number;
  readonly headRefOid: string;
  readonly reviewThreads: { readonly pageInfo: PageInfo; readonly nodes: readonly GqlThread[] };
  readonly comments: { readonly pageInfo: PageInfo; readonly nodes: readonly GqlComment[] };
  readonly reviews: { readonly pageInfo: PageInfo; readonly nodes: readonly GqlReview[] };
  readonly commits: {
    readonly nodes: readonly {
      readonly commit: {
        readonly oid: string;
        readonly statusCheckRollup: { readonly contexts: GqlCheckContexts } | null;
      };
    }[];
  };
}

/**
 * The rest of the head commit's check contexts, for a pull request with
 * more than the first query's page of them (large monorepos run hundreds of
 * jobs). A review bot's check run past that page would otherwise be missing
 * from the digest's verdicts.
 */
const CHECK_CONTEXTS_QUERY = `
query GeldCheckContexts($owner: String!, $name: String!, $oid: GitObjectID!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        statusCheckRollup {
          contexts(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              __typename
              ... on CheckRun { name status conclusion startedAt completedAt }
              ... on StatusContext { context state }
            }
          }
        }
      }
    }
  }
}
`;

interface GeldCheckContextsQuery {
  readonly repository: { readonly object: { readonly statusCheckRollup: { readonly contexts: GqlCheckContexts } | null } | null } | null;
}

function assertCheckContextsQuery(value: unknown): asserts value is GeldCheckContextsQuery {
  if (!isRecord(value) || !('repository' in value)) throw new Error('GitHub GraphQL returned an unexpected shape for the check contexts.');
}

async function remainingCheckContexts(client: GithubClient, owner: string, repo: string, oid: string, first: GqlCheckContexts): Promise<readonly GqlCheckContext[]> {
  const nodes = [...first.nodes];
  let cursor = first.pageInfo.endCursor;
  let more = first.pageInfo.hasNextPage;
  while (more && cursor !== null) {
    const data = await graphql(client, CHECK_CONTEXTS_QUERY, { owner, name: repo, oid, cursor });
    assertCheckContextsQuery(data);
    const contexts = data.repository?.object?.statusCheckRollup?.contexts;
    if (contexts === undefined) break;
    nodes.push(...contexts.nodes);
    more = contexts.pageInfo.hasNextPage;
    cursor = contexts.pageInfo.endCursor;
  }
  return nodes;
}

function checkRunOf(node: GqlCheckContext, sha: string): RawCheckRun | null {
  if (node.__typename === 'CheckRun' && node.name !== undefined && node.status !== undefined) {
    return {
      name: node.name,
      status: node.status.toLowerCase(),
      conclusion: node.conclusion?.toLowerCase() ?? null,
      sha,
      ...(typeof node.startedAt === 'string' ? { startedAt: node.startedAt } : {}),
      ...(typeof node.completedAt === 'string' ? { completedAt: node.completedAt } : {}),
    };
  }
  if (node.__typename === 'StatusContext' && node.context !== undefined && node.state !== undefined) {
    const state = node.state.toLowerCase();
    const conclusion = state === 'success' ? 'success' : state === 'pending' ? null : 'failure';
    return { name: node.context, status: state === 'pending' ? 'in_progress' : 'completed', conclusion, sha };
  }
  return null;
}

/** GraphQL names an App `cursor` with `__typename: Bot`; REST, the page and the extension know it as `cursor[bot]`. */
function loginOf(author: GqlAuthor | null): string {
  const login = author?.login ?? 'ghost';
  return author?.__typename === 'Bot' && !/\[bot\]$/i.test(login) ? `${login}[bot]` : login;
}

export async function loadPullRequest(client: GithubClient, owner: string, repo: string, number: number): Promise<RawPullRequest> {
  const threads: RawThread[] = [];
  const comments: RawIssueComment[] = [];
  const reviews: RawReview[] = [];
  let checks: RawCheckRun[] = [];
  let headSha = '';
  let threadCursor: string | null = null;
  let commentCursor: string | null = null;
  let reviewCursor: string | null = null;

  for (;;) {
    const data = await graphql(client, PR_QUERY, {
      owner,
      name: repo,
      number,
      threadCursor,
      commentCursor,
      reviewCursor,
    });
    assertPrQuery(data);
    const pr = data.repository.pullRequest;
    if (pr === null) throw new Error(`Pull request ${owner}/${repo}#${number} was not found.`);
    headSha = pr.headRefOid;
    for (const thread of pr.reviewThreads.nodes) {
      const threadComments = thread.comments.pageInfo.hasNextPage ? await remainingThreadComments(client, thread.id, thread.comments) : thread.comments.nodes;
      threads.push({
        path: thread.path,
        line: thread.line,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        comments: threadComments.map((node) => ({
          databaseId: node.databaseId,
          author: loginOf(node.author),
          body: node.body,
          createdAt: node.createdAt,
        })),
      });
    }
    for (const node of pr.comments.nodes) {
      comments.push({
        databaseId: node.databaseId,
        author: loginOf(node.author),
        body: node.body,
        createdAt: node.createdAt,
        ...(typeof node.lastEditedAt === 'string' ? { editedAt: node.lastEditedAt } : {}),
      });
    }
    for (const node of pr.reviews.nodes) {
      reviews.push({
        databaseId: node.databaseId,
        author: loginOf(node.author),
        state: node.state,
        body: node.body,
        submittedAt: node.submittedAt,
        commitOid: node.commit?.oid ?? null,
      });
    }
    // The head commit's checks come with the first page and are the same on every later one; read them once, to
    // their last page.
    const commit = pr.commits.nodes[0]?.commit;
    if (checks.length === 0 && commit?.statusCheckRollup !== undefined && commit.statusCheckRollup !== null) {
      const contexts = await remainingCheckContexts(client, owner, repo, commit.oid, commit.statusCheckRollup.contexts);
      checks = contexts.map((node) => checkRunOf(node, commit.oid)).filter((check): check is RawCheckRun => check !== null);
    }
    const moreThreads = pr.reviewThreads.pageInfo.hasNextPage;
    const moreComments = pr.comments.pageInfo.hasNextPage;
    const moreReviews = pr.reviews.pageInfo.hasNextPage;
    // Keep the last cursor on exhausted connections so a later page of another
    // connection does not re-fetch their first page.
    if (pr.reviewThreads.pageInfo.endCursor !== null) threadCursor = pr.reviewThreads.pageInfo.endCursor;
    if (pr.comments.pageInfo.endCursor !== null) commentCursor = pr.comments.pageInfo.endCursor;
    if (pr.reviews.pageInfo.endCursor !== null) reviewCursor = pr.reviews.pageInfo.endCursor;
    if (!moreThreads && !moreComments && !moreReviews) break;
  }

  return { owner, repo, number, headSha, threads, comments, reviews, checks };
}

export interface ExistingSummary {
  readonly commentId: number;
  readonly body: string;
  readonly meta: GeldPrMeta | null;
}

/**
 * The summary comment this run should update: the first that reads like one
 * *and* was written by an account the Action writes as (`isAllowedSummaryAuthor`:
 * `github-actions[bot]`, the Geld Apps, plus the token's own login). Any
 * participant can post the marker or the heading; adopting their comment
 * would mean a PATCH on a comment the token does not own — a 403 instead of
 * a digest — so such comments are passed over and the Action posts its own.
 */
export function findSummaryComment(comments: readonly RawIssueComment[], ownLogins: readonly string[] = []): ExistingSummary | null {
  for (const comment of comments) {
    if (!isAllowedSummaryAuthor(comment.author, ownLogins)) continue;
    if (!looksLikeSummaryBody(comment.body)) continue;
    const parsed = parseSummaryBody(comment.body);
    return { commentId: comment.databaseId, body: comment.body, meta: parsed.ok ? parsed.value : null };
  }
  return null;
}

/**
 * The login the token writes comments as. A personal or App user token
 * answers `GET /user`; the workflow's own `GITHUB_TOKEN` answers 403 there
 * ("Resource not accessible by integration") and writes as
 * `github-actions[bot]`, which `isAllowedSummaryAuthor` already knows.
 */
export async function tokenLogin(client: GithubClient): Promise<string | null> {
  try {
    const body = await githubJson(client, `${API}/user`);
    return isRecord(body) && typeof body.login === 'string' && body.login !== '' ? body.login : null;
  } catch {
    return null;
  }
}

/** Files touched between two commits. Used so "addressed" means a later push, not the original diff. */
export async function filesChangedBetween(
  client: GithubClient,
  owner: string,
  repo: string,
  fromSha: string,
  toSha: string,
): Promise<readonly string[]> {
  if (fromSha === '' || toSha === '' || fromSha.toLowerCase() === toSha.toLowerCase()) return [];
  const body = await githubJson(
    client,
    `${API}/repos/${owner}/${repo}/compare/${encodeURIComponent(fromSha)}...${encodeURIComponent(toSha)}`,
  );
  if (!isRecord(body) || !Array.isArray(body.files)) return [];
  const paths: string[] = [];
  for (const file of body.files) {
    if (isRecord(file) && typeof file.filename === 'string' && file.filename !== '') paths.push(file.filename);
  }
  return paths;
}

export async function upsertIssueComment(
  client: GithubClient,
  owner: string,
  repo: string,
  number: number,
  existingId: number | null,
  body: string,
): Promise<number> {
  if (existingId !== null) {
    await githubJson(client, `${API}/repos/${owner}/${repo}/issues/comments/${existingId}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    return existingId;
  }
  const created = await githubJson(client, `${API}/repos/${owner}/${repo}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  if (!isRecord(created) || typeof created.id !== 'number') throw new Error('GitHub did not return the new comment id.');
  return created.id;
}

export interface ActionEvent {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly actor: string;
  readonly eventName: string;
  readonly action: string;
  readonly commentAuthor: string | null;
  readonly commentBody: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function nested(value: unknown, key: string): Record<string, unknown> | null {
  const parent = record(value);
  return parent === null ? null : record(parent[key]);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Read owner/repo/number from the Actions event payload. `null` when this is not a pull request. */
export function parseActionEvent(env: Record<string, string | undefined>, payload: unknown): ActionEvent | null {
  const repository = nested(payload, 'repository');
  const fullName = str(repository?.full_name)?.split('/') ?? env.GITHUB_REPOSITORY?.split('/');
  const owner = fullName?.[0];
  const repo = fullName?.[1];
  if (owner === undefined || repo === undefined) return null;
  const pr = nested(payload, 'pull_request');
  const issue = nested(payload, 'issue');
  const check = nested(payload, 'check_run');
  const checkPrs = check !== null && Array.isArray(check.pull_requests) ? check.pull_requests : [];
  const firstCheckPr = record(checkPrs[0]);
  const number = num(pr?.number) ?? (issue !== null && issue.pull_request !== undefined ? num(issue.number) : null) ?? num(firstCheckPr?.number);
  if (number === null) return null;
  const actor = str(nested(payload, 'sender')?.login) ?? env.GITHUB_ACTOR ?? 'github-actions[bot]';
  const comment = nested(payload, 'comment');
  const root = record(payload);
  return {
    owner,
    repo,
    number,
    actor,
    eventName: env.GITHUB_EVENT_NAME ?? '',
    action: str(root?.action) ?? '',
    commentAuthor: str(nested(comment, 'user')?.login),
    commentBody: str(comment?.body),
  };
}

/**
 * Our own rewrite fires `issue_comment.edited` as github-actions[bot]. Skip
 * that loop; a human ticking a checkbox is a different actor.
 */
export function shouldSkipSelfEdit(event: ActionEvent): boolean {
  if (event.eventName !== 'issue_comment' || event.action !== 'edited') return false;
  if (event.commentAuthor !== 'github-actions[bot]' && event.commentAuthor !== 'geld[bot]') return false;
  return event.commentBody !== null && looksLikeSummaryBody(event.commentBody);
}
