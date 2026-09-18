/**
 * GitHub GraphQL + REST used by the Action. Token-only; never clones the
 * pull request. Pagination is followed until the cursor is exhausted.
 */

import { looksLikeSummaryBody, parseSummaryBody } from '@geld/review';
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
          isResolved
          isOutdated
          path
          line
          comments(first: 50) {
            nodes { databaseId author { login } body createdAt }
          }
        }
      }
      comments(first: 50, after: $commentCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { databaseId author { login } body createdAt }
      }
      reviews(first: 50, after: $reviewCursor) {
        pageInfo { hasNextPage endCursor }
        nodes { databaseId author { login } state body submittedAt commit { oid } }
      }
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              contexts: contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion }
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
}

interface GqlThread {
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly path: string | null;
  readonly line: number | null;
  readonly comments: { readonly nodes: readonly { readonly databaseId: number; readonly author: GqlAuthor | null; readonly body: string; readonly createdAt: string }[] };
}

interface GqlComment {
  readonly databaseId: number;
  readonly author: GqlAuthor | null;
  readonly body: string;
  readonly createdAt: string;
}

interface GqlReview {
  readonly databaseId: number;
  readonly author: GqlAuthor | null;
  readonly state: string;
  readonly body: string;
  readonly submittedAt: string | null;
  readonly commit: { readonly oid: string } | null;
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
        readonly statusCheckRollup: {
          readonly contexts: {
            readonly nodes: readonly {
              readonly __typename: string;
              readonly name?: string;
              readonly status?: string;
              readonly conclusion?: string | null;
              readonly context?: string;
              readonly state?: string;
            }[];
          };
        } | null;
      };
    }[];
  };
}

function loginOf(author: GqlAuthor | null): string {
  return author?.login ?? 'ghost';
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
      threads.push({
        path: thread.path,
        line: thread.line,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        comments: thread.comments.nodes.map((node) => ({
          databaseId: node.databaseId,
          author: loginOf(node.author),
          body: node.body,
          createdAt: node.createdAt,
        })),
      });
    }
    for (const node of pr.comments.nodes) {
      comments.push({ databaseId: node.databaseId, author: loginOf(node.author), body: node.body, createdAt: node.createdAt });
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
    const commit = pr.commits.nodes[0]?.commit;
    if (commit?.statusCheckRollup !== undefined && commit.statusCheckRollup !== null) {
      checks = [];
      for (const node of commit.statusCheckRollup.contexts.nodes) {
        if (node.__typename === 'CheckRun' && node.name !== undefined && node.status !== undefined) {
          checks.push({ name: node.name, status: node.status.toLowerCase(), conclusion: node.conclusion?.toLowerCase() ?? null, sha: commit.oid });
        } else if (node.__typename === 'StatusContext' && node.context !== undefined && node.state !== undefined) {
          const state = node.state.toLowerCase();
          const conclusion = state === 'success' ? 'success' : state === 'pending' ? null : 'failure';
          checks.push({ name: node.context, status: state === 'pending' ? 'in_progress' : 'completed', conclusion, sha: commit.oid });
        }
      }
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

export function findSummaryComment(comments: readonly RawIssueComment[]): ExistingSummary | null {
  for (const comment of comments) {
    if (!looksLikeSummaryBody(comment.body)) continue;
    const parsed = parseSummaryBody(comment.body);
    return { commentId: comment.databaseId, body: comment.body, meta: parsed.ok ? parsed.value : null };
  }
  return null;
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
