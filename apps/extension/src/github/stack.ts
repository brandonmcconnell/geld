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
  /** Reads that failed (no answer, or one that could not be read), and when the last did. */
  failures: number;
  failedAt: number;
}

let read: Read | null = null;

/** What shows a pull request is stacked without the layout route: the header's "11/14" badge, the timeline's "added this pull request to stack #193". */
const STACK_SIGNS = '[class*="stackBadge"], a[href*="/stack/"]';

/** A failed read is asked again after this, doubling each time, at most `STACK_READ_TRIES` times in all. */
const STACK_RETRY_MS = 15_000;
const STACK_READ_TRIES = 4;

type Answer = { readonly settled: true; readonly stack: PageStack | null } | { readonly settled: false };

/** `page_data/stacks`'s answer: a stack, settled as none (`stack: null`), or a failure worth asking again. Exported for its test. */
export function stackAnswer(payload: unknown, pullPath: string): Answer {
  if (!isRecord(payload) || !('stack' in payload)) return { settled: false };
  if (payload.stack === null) return { settled: true, stack: null };
  const stack = parsePageStack(payload.stack, pullPath);
  return stack === null ? { settled: false } : { settled: true, stack };
}

/** Whether a read that failed `failures` times, last at `failedAt`, is due again at `now`. Exported for its test. */
export function stackRetryDue(failures: number, failedAt: number, now: number): boolean {
  return failures > 0 && failures < STACK_READ_TRIES && now - failedAt >= STACK_RETRY_MS * 2 ** (failures - 1);
}

function ask(asked: Read, onChange: () => void): void {
  asked.pending = true;
  void fetchStackPayload(asked.pull).then((payload) => {
    asked.pending = false;
    const answer = stackAnswer(payload, asked.pull);
    if (!answer.settled) {
      asked.failures += 1;
      asked.failedAt = Date.now();
      // Nothing else may make a pass on a quiet page, so the retry asks for one when it is due.
      if (read === asked && asked.failures < STACK_READ_TRIES) window.setTimeout(() => read === asked && onChange(), STACK_RETRY_MS * 2 ** (asked.failures - 1));
      return;
    }
    asked.failures = 0;
    asked.stack = answer.stack;
    if (read === asked && asked.stack !== null) onChange();
  });
}

/**
 * The page's stack: from what the page embeds, else, where the page shows one, asked of `page_data/stacks` once per
 * pull request, again after a failure with a growing wait, `onChange` asking for a pass when the answer lands.
 */
export function pageStack(onChange: () => void): PageStack | null {
  const pull = /^\/[^/]+\/[^/]+\/pull\/\d+/.exec(location.pathname)?.[0] ?? null;
  if (pull === null) return null;
  const embedded = embeddedStackRecord(pull);
  if (embedded === 'none') return null;
  if (embedded !== null) return parsePageStack(embedded, pull);
  if (read?.pull !== pull && document.querySelector(STACK_SIGNS) === null) return null;
  if (read?.pull !== pull) {
    read = { pull, pending: false, stack: null, failures: 0, failedAt: 0 };
    ask(read, onChange);
  } else if (!read.pending && stackRetryDue(read.failures, read.failedAt, Date.now())) {
    ask(read, onChange);
  }
  return read.stack;
}

export function forgetPageStack(): void {
  read = null;
}
