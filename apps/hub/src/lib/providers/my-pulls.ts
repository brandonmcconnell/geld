import type { GitHubActor, MyPullsResult, PullSummary } from "../github.types";

/** Reads one JSON document from a provider's API, or null when it refuses. */
export type ProviderGet = (path: string) => Promise<unknown>;

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Provider ids are numbered per provider, so they are kept apart from GitHub's. */
function rowId(id: number) {
  return -Math.abs(id);
}

function gitlabActor(value: unknown): GitHubActor | null {
  const author = record(value);
  const login = text(author?.username);
  if (!author || !login) {
    return null;
  }
  return {
    login,
    avatarUrl: text(author.avatar_url) ?? "",
    url: text(author.web_url) ?? `https://gitlab.com/${login}`,
    type: "User",
  };
}

/** A GitLab merge request as a list row, or null when it is not one. */
export function gitlabPull(value: unknown): PullSummary | null {
  const mr = record(value);
  const url = text(mr?.web_url);
  const title = text(mr?.title);
  const createdAt = text(mr?.created_at);
  if (!mr || !url || !title || !createdAt) {
    return null;
  }
  const path = /^https:\/\/gitlab\.com\/(.+?)\/-\/merge_requests\/(\d+)/u.exec(
    url
  );
  if (!path?.[1] || !path[2]) {
    return null;
  }
  const fullName = path[1];
  const slash = fullName.lastIndexOf("/");
  if (slash < 1) {
    return null;
  }
  return {
    provider: "gitlab",
    id: rowId(count(mr.id)),
    number: Number(path[2]),
    title,
    state: text(mr.state) === "opened" ? "open" : (text(mr.state) ?? "open"),
    isDraft: mr.draft === true || mr.work_in_progress === true,
    createdAt,
    updatedAt: text(mr.updated_at) ?? createdAt,
    closedAt: text(mr.closed_at),
    mergedAt: text(mr.merged_at),
    comments: count(mr.user_notes_count),
    url,
    author: gitlabActor(mr.author),
    labels: list(mr.labels).flatMap((label) => {
      const name = text(label);
      return name ? [{ name, color: "", description: null }] : [];
    }),
    repository: {
      name: fullName.slice(slash + 1),
      owner: fullName.slice(0, slash),
      fullName,
      url: `https://gitlab.com/${fullName}`,
      isPrivate: null,
    },
    baseRefName: text(mr.target_branch) ?? undefined,
    headRefName: text(mr.source_branch) ?? undefined,
  };
}

/** A Bitbucket pull request as a list row, or null when it is not one. */
export function bitbucketPull(value: unknown): PullSummary | null {
  const pr = record(value);
  const title = text(pr?.title);
  const createdAt = text(pr?.created_on);
  const url = text(record(record(pr?.links)?.html)?.href);
  const destination = record(pr?.destination);
  const fullName = text(record(destination?.repository)?.full_name);
  const number = count(pr?.id);
  if (!pr || !title || !createdAt || !url || !fullName || number < 1) {
    return null;
  }
  const slash = fullName.indexOf("/");
  if (slash < 1) {
    return null;
  }
  const author = record(pr.author);
  const login = text(author?.nickname) ?? text(author?.display_name);
  const state = text(pr.state);
  return {
    provider: "bitbucket",
    // Bitbucket numbers pull requests per repository and gives no global id.
    id: rowId(hash(`${fullName}#${number}`)),
    number,
    title,
    state: state === "OPEN" ? "open" : "closed",
    isDraft: pr.draft === true,
    createdAt,
    updatedAt: text(pr.updated_on) ?? createdAt,
    closedAt: null,
    mergedAt: state === "MERGED" ? (text(pr.updated_on) ?? createdAt) : null,
    comments: count(pr.comment_count),
    url,
    author:
      author && login
        ? {
            login,
            avatarUrl: text(record(record(author.links)?.avatar)?.href) ?? "",
            url: text(record(record(author.links)?.html)?.href) ?? url,
            type: "User",
          }
        : null,
    labels: [],
    repository: {
      name: fullName.slice(slash + 1),
      owner: fullName.slice(0, slash),
      fullName,
      url: `https://bitbucket.org/${fullName}`,
      isPrivate: null,
    },
    baseRefName: text(record(destination?.branch)?.name) ?? undefined,
    headRefName: text(record(record(pr.source)?.branch)?.name) ?? undefined,
  };
}

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (Math.imul(result, 31) + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result) + 1;
}

export type ProviderPulls = Pick<
  MyPullsResult,
  "reviewRequested" | "assigned" | "authored"
>;

function rows(
  value: unknown,
  read: (item: unknown) => PullSummary | null
): PullSummary[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.flatMap((item) => {
    const pull = read(item);
    return pull ? [pull] : [];
  });
}

/** The reader's open GitLab merge requests by role. Null when GitLab did not answer. */
export async function gitlabMyPulls(
  get: ProviderGet
): Promise<ProviderPulls | null> {
  const username = text(record(await get("user"))?.username);
  if (!username) {
    return null;
  }
  const open = "state=opened&per_page=50&order_by=updated_at";
  const [authored, assigned, reviewRequested] = await Promise.all([
    get(`merge_requests?scope=created_by_me&${open}`),
    get(`merge_requests?scope=assigned_to_me&${open}`),
    get(
      `merge_requests?scope=all&reviewer_username=${encodeURIComponent(username)}&${open}`
    ),
  ]);
  const result = {
    authored: rows(authored, gitlabPull),
    assigned: rows(assigned, gitlabPull),
    reviewRequested: rows(reviewRequested, gitlabPull),
  };
  if (!result.authored || !result.assigned || !result.reviewRequested) {
    return null;
  }
  return {
    authored: result.authored,
    assigned: result.assigned,
    reviewRequested: result.reviewRequested,
  };
}

/**
 * The reader's open Bitbucket pull requests. Bitbucket lists across
 * workspaces only by author, so review requests are not here yet.
 */
export async function bitbucketMyPulls(
  get: ProviderGet
): Promise<ProviderPulls | null> {
  const uuid = text(record(await get("user"))?.uuid);
  if (!uuid) {
    return null;
  }
  const page = record(
    await get(`pullrequests/${encodeURIComponent(uuid)}?state=OPEN&pagelen=50`)
  );
  const authored = rows(page?.values, bitbucketPull);
  if (!authored) {
    return null;
  }
  return { authored, assigned: [], reviewRequested: [] };
}

function byUpdated(a: PullSummary, b: PullSummary) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** Lays other providers' pull requests into GitHub's lists, newest first. */
export function withProviderPulls(
  result: MyPullsResult,
  extra: readonly ProviderPulls[]
): MyPullsResult {
  if (extra.length === 0) {
    return result;
  }
  const merge = (key: keyof ProviderPulls) =>
    [...result[key], ...extra.flatMap((pulls) => pulls[key])].sort(byUpdated);
  return {
    ...result,
    reviewRequested: merge("reviewRequested"),
    assigned: merge("assigned"),
    authored: merge("authored"),
  };
}
