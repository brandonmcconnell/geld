/** A pull request GitHub's compare form failed to open, as Geld retries it. */
export interface PullAttempt {
  /** The repository the pull request is opened on. */
  readonly owner: string;
  readonly repo: string;
  readonly base: string;
  /** As the API and `gh` take it: `branch` in the base repository, else `owner:branch`. */
  readonly head: string;
  /** For a head in another repository of the base's owner, which the API cannot tell apart by owner alone. */
  readonly headRepo: string | null;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}

interface Ref {
  readonly owner: string | null;
  readonly repo: string | null;
  readonly branch: string;
}

/** A compare ref: `branch`, `owner:branch` (that owner's fork in the network) or `owner:repo:branch`. Git refs hold no colon. */
export function parseRef(raw: string): Ref | null {
  const parts = raw.split(':');
  const [first, second, third] = parts;
  if (parts.some((part) => part === '')) return null;
  if (parts.length === 1 && first !== undefined) return { owner: null, repo: null, branch: first };
  if (parts.length === 2 && first !== undefined && second !== undefined) return { owner: first, repo: null, branch: second };
  if (parts.length === 3 && first !== undefined && second !== undefined && third !== undefined) return { owner: first, repo: second, branch: third };
  return null;
}

const REPO_PATH = /^\/([^/]+)\/([^/]+)\//;
const COMPARE_RANGE = /\/compare\/(.+?)(?:\.{2,3})(.+?)\/?$/;

export interface AttemptInput {
  /** The page's path: `/owner/repo/compare/base...head`, or `/owner/repo/pull/create` once GitHub re-rendered the form. */
  readonly pagePath: string;
  /** The form's action query and the page's, the form's first: GitHub names `base` and `head` there. */
  readonly queries: readonly URLSearchParams[];
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function pullAttemptFrom(input: AttemptInput): PullAttempt | null {
  const page = REPO_PATH.exec(input.pagePath);
  if (page === null) return null;
  const [, pageOwner = '', pageRepo = ''] = page;
  const fromQuery = (name: string): string | null => input.queries.map((query) => query.get(name)).find((value) => value !== null && value !== '') ?? null;
  const range = COMPARE_RANGE.exec(input.pagePath);
  const baseRaw = fromQuery('base') ?? (range?.[1] === undefined ? null : decode(range[1]));
  const headRaw = fromQuery('head') ?? (range?.[2] === undefined ? null : decode(range[2]));
  if (baseRaw === null || headRaw === null || input.title.trim() === '') return null;
  const base = parseRef(baseRaw);
  const head = parseRef(headRaw);
  if (base === null || head === null) return null;
  const owner = base.owner ?? pageOwner;
  const repo = base.repo ?? pageRepo;
  // An unqualified head is a branch of the repository the page is in, which is the base's unless the base was qualified.
  const headOwner = head.owner ?? pageOwner;
  const headRepoName = head.repo ?? (head.owner === null ? pageRepo : null);
  const sameRepo = headOwner === owner && (headRepoName === null || headRepoName === repo);
  return {
    owner,
    repo,
    base: base.branch,
    head: sameRepo ? head.branch : `${headOwner}:${head.branch}`,
    headRepo: !sameRepo && headOwner === owner && headRepoName !== null ? headRepoName : null,
    title: input.title,
    body: input.body,
    draft: input.draft,
  };
}

const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

export function shellQuote(value: string): string {
  if (SHELL_SAFE.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The same request from the reader's own terminal: `gh pr create`, or `gh api` for a head `gh pr create` cannot name (another repository of the base's owner). */
export function ghCommand(attempt: PullAttempt, host = 'github.com'): string {
  const words =
    attempt.headRepo === null
      ? ['gh', 'pr', 'create', '--repo', `${attempt.owner}/${attempt.repo}`, '--base', attempt.base, '--head', attempt.head, '--title', attempt.title, '--body', attempt.body, ...(attempt.draft ? ['--draft'] : [])]
      : [
          'gh', 'api', '--method', 'POST', `repos/${attempt.owner}/${attempt.repo}/pulls`,
          '-f', `title=${attempt.title}`, '-f', `body=${attempt.body}`, '-f', `base=${attempt.base}`, '-f', `head=${attempt.head}`, '-f', `head_repo=${attempt.headRepo}`, '-F', `draft=${attempt.draft}`,
        ];
  const command = words.map(shellQuote).join(' ');
  return host === 'github.com' ? command : `GH_HOST=${shellQuote(host)} ${command}`;
}

/** The tab asking is a page of the repository the pull request goes to, on github.com, whose API the token is for. */
export function senderMayCreatePull(tabUrl: string | undefined, attempt: PullAttempt): boolean {
  if (tabUrl === undefined) return false;
  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    return false;
  }
  const page = REPO_PATH.exec(url.pathname);
  return url.origin === 'https://github.com' && page?.[1]?.toLowerCase() === attempt.owner.toLowerCase() && page[2]?.toLowerCase() === attempt.repo.toLowerCase();
}

/** GitHub's prefix on the compare page's flash when opening the pull request failed. */
export const CREATE_FAILED_PREFIX = 'Pull request creation failed.';

/** Failures that end the same way however often they are sent: the pull request exists, or there is nothing to open. */
const FINAL_FAILURES = [/already exists/i, /no commits between/i, /can['’]t be blank/i, /must be a branch/i, /\bis invalid\b/i];

export function isRetryableFailure(message: string): boolean {
  return !FINAL_FAILURES.some((pattern) => pattern.test(message));
}

/** GitHub's answer to `POST /repos/{owner}/{repo}/pulls`, as the content script shows it. */
export type CreatePullOutcome =
  | { readonly ok: true; readonly number: number; readonly url: string }
  /** `unavailable`: Geld's App cannot act here (not signed in, not installed on the repository), so only the page's own retry can. */
  | { readonly ok: false; readonly reason: 'unavailable' | 'refused'; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseCreatedPull(value: unknown): { readonly number: number; readonly url: string } | null {
  if (!isRecord(value) || typeof value.number !== 'number' || typeof value.html_url !== 'string') return null;
  return { number: value.number, url: value.html_url };
}

/** GitHub's own words for a refusal: a 422's `errors[].message` say what was wrong, its `message` only "Validation Failed". */
export function apiRefusal(status: number, answer: unknown): CreatePullOutcome {
  const message = isRecord(answer) && typeof answer.message === 'string' ? answer.message : '';
  const details = isRecord(answer) && Array.isArray(answer.errors) ? answer.errors.flatMap((error) => (isRecord(error) && typeof error.message === 'string' ? [error.message] : [])) : [];
  if (status === 404 || (status === 403 && /not accessible by integration/i.test(message))) {
    return { ok: false, reason: 'unavailable', message: 'The Geld app is not installed on this repository.' };
  }
  const words = details.length > 0 ? details.join('. ') : message;
  return { ok: false, reason: 'refused', message: words === '' ? `GitHub answered ${status}.` : words };
}
