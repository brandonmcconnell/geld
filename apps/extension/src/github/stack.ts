import { embeddedStackRecord, fetchStackPayload } from './merge-actions';

/**
 * The GitHub stack a pull request belongs to, as the sidebar's Related work shows it: one row for the whole stack,
 * whose hover card lists every pull request in it as GitHub's own stack popover does.
 */

export type StackPullState = 'open' | 'draft' | 'merged' | 'closed';

export interface StackPull {
  readonly number: number;
  readonly title: string;
  readonly state: StackPullState;
  /** `/owner/repo/pull/N`. */
  readonly path: string;
  readonly headBranch: string;
  readonly current: boolean;
}

export interface PageStack {
  /** The stack's own number, as GitHub writes it: "stack #193". */
  readonly number: number;
  /** `/owner/repo/stack/N`, GitHub's page for the stack. */
  readonly path: string;
  /** Where the page's pull request stands, counted as GitHub's header counts it ("11/14"). */
  readonly position: number | null;
  readonly size: number;
  /** Top of the stack first, as GitHub lists them, merged ones included. */
  readonly pulls: readonly StackPull[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function stateOf(pull: Record<string, unknown>): StackPullState {
  if (pull.state === 'MERGED') return 'merged';
  if (pull.state === 'CLOSED') return 'closed';
  return pull.isDraft === true || pull.state === 'DRAFT' ? 'draft' : 'open';
}

/** A stack payload (`pullRequestsLayoutRoute.stack`, or `page_data/stacks`'s `stack`) for the pull request at `pullPath`. Exported for its test. */
export function parsePageStack(stack: unknown, pullPath: string): PageStack | null {
  const page = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(pullPath);
  if (page === null || !isRecord(stack) || typeof stack.number !== 'number' || !Array.isArray(stack.pulls)) return null;
  const owner = typeof stack.repositoryOwnerLogin === 'string' && stack.repositoryOwnerLogin !== '' ? stack.repositoryOwnerLogin : (page[1] ?? '');
  const repo = typeof stack.repositoryName === 'string' && stack.repositoryName !== '' ? stack.repositoryName : (page[2] ?? '');
  const current = Number(page[3]);
  const pulls: StackPull[] = [];
  for (const pull of stack.pulls) {
    if (!isRecord(pull) || typeof pull.number !== 'number' || typeof pull.url !== 'string') return null;
    pulls.push({
      number: pull.number,
      title: typeof pull.title === 'string' ? pull.title : '',
      state: stateOf(pull),
      path: new URL(pull.url, 'https://github.com').pathname,
      headBranch: typeof pull.headBranch === 'string' ? pull.headBranch : '',
      current: pull.number === current,
    });
  }
  if (!pulls.some((pull) => pull.current)) return null;
  return {
    number: stack.number,
    path: `/${owner}/${repo}/stack/${stack.number}`,
    position: typeof stack.position === 'number' ? stack.position : null,
    size: typeof stack.size === 'number' ? stack.size : pulls.length,
    pulls,
  };
}

interface Read {
  readonly pull: string;
  pending: boolean;
  stack: PageStack | null;
}

let read: Read | null = null;

/** What shows a pull request is stacked without the layout route: the header's "11/14" badge, the timeline's "added this pull request to stack #193". */
const STACK_SIGNS = '[class*="stackBadge"], a[href*="/stack/"]';

/**
 * The page's stack: from what the page embeds, else, where the page shows one, asked of `page_data/stacks` once per
 * pull request, `onChange` asking for a pass when the answer lands.
 */
export function pageStack(onChange: () => void): PageStack | null {
  const pull = /^\/[^/]+\/[^/]+\/pull\/\d+/.exec(location.pathname)?.[0] ?? null;
  if (pull === null) return null;
  const embedded = embeddedStackRecord(pull);
  if (embedded === 'none') return null;
  if (embedded !== null) return parsePageStack(embedded, pull);
  if (read?.pull !== pull && document.querySelector(STACK_SIGNS) === null) return null;
  if (read?.pull !== pull) {
    const asked: Read = { pull, pending: true, stack: null };
    read = asked;
    void fetchStackPayload(pull).then((payload) => {
      asked.pending = false;
      asked.stack = isRecord(payload) ? parsePageStack(payload.stack, pull) : null;
      if (read === asked && asked.stack !== null) onChange();
    });
  }
  return read.stack;
}

export function forgetPageStack(): void {
  read = null;
}
