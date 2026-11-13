import { suggestionReplyBody } from '@geld/review';
import { pageFetch } from '../page-fetch';
import { fetchNonce, pullPathOf } from '../timeline-comment';

/**
 * Applying a triage fix the way GitHub applies a reviewer's suggestion, so nothing needs a token with write access to
 * the code: the fix is posted as a `suggestion` reply in the finding's thread, then committed to the pull request's
 * branch with GitHub's own "Commit suggestion" request. Both requests are the ones GitHub's pull request page sends,
 * read from its bundle in Nov 2026: `page_data/create_review_comment` (`{ text, inReplyTo, submitBatch, path }`, the
 * thread's reply box) and `page_data/apply_review_suggestions` (`{ comments: [{ id, suggestionIndex }], message, expectedHeadOid }`
 * with an `Idempotency-Key`, the batch commit). GitHub refuses either for a reader who may not, and says why.
 */

function headers(nonce: string, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const all: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest', ...extra };
  if (nonce !== '') all['X-Fetch-Nonce'] = nonce;
  return all;
}

export interface PageRequest {
  readonly url: string;
  readonly init: RequestInit;
}

export function reviewReplyRequest(pullPath: string, reply: { readonly text: string; readonly inReplyTo: number; readonly path: string }, nonce: string): PageRequest {
  return {
    url: `${pullPath}/page_data/create_review_comment`,
    init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce), body: JSON.stringify({ text: reply.text, inReplyTo: reply.inReplyTo, submitBatch: false, path: reply.path }) },
  };
}

export function applySuggestionsRequest(pullPath: string, commentIds: readonly number[], message: string, headOid: string, nonce: string, idempotencyKey: string): PageRequest {
  return {
    url: `${pullPath}/page_data/apply_review_suggestions`,
    // Each reply holds one suggestion block, the first; GitHub answers "requires a suggestion_index" without it.
    init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, { 'Idempotency-Key': idempotencyKey }), body: JSON.stringify({ comments: commentIds.map((id) => ({ id, suggestionIndex: 0 })), message, expectedHeadOid: headOid }) },
  };
}

/** The commit's message: the finding's title for one fix, a line per finding for several. */
export function commitMessage(titles: readonly string[]): string {
  if (titles.length === 1) return `Apply suggestion from Geld triage\n\n${titles[0] ?? ''}`;
  return `Apply ${titles.length} suggestions from Geld triage\n\n${titles.map((title) => `- ${title}`).join('\n')}`;
}

/** The newest review comment id in a thread's comment anchors (`discussion_r<id>`): the comment a reply answers. */
export function lastCommentId(anchors: readonly string[]): number | null {
  const ids = anchors.flatMap((anchor) => {
    const id = /^discussion_r(\d+)$/.exec(anchor)?.[1];
    return id === undefined ? [] : [Number(id)];
  });
  return ids.length === 0 ? null : Math.max(...ids);
}

/** The reply's id in GitHub's answer: the largest `databaseId` it names above the comment answered (the answer is the whole thread). */
export function newestCommentId(answer: unknown, after: number): number | null {
  let best: number | null = null;
  const walk = (value: unknown, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'databaseId' && typeof entry === 'number' && entry > after && (best === null || entry > best)) best = entry;
      else walk(entry, depth + 1);
    }
  };
  walk(answer, 0);
  return best;
}

/** GitHub's own words for a refusal, from the JSON it answers with. */
export function refusalOf(answer: unknown, status: number): string {
  if (answer !== null && typeof answer === 'object' && !Array.isArray(answer)) {
    const record = new Map(Object.entries(answer));
    for (const key of ['message', 'error', 'errorMessage']) {
      const text = record.get(key);
      if (typeof text === 'string' && text.trim() !== '') return text.trim();
    }
    const errors = record.get('errors');
    if (Array.isArray(errors)) {
      for (const error of errors) {
        if (typeof error === 'string' && error !== '') return error;
        if (error !== null && typeof error === 'object') {
          const message = new Map(Object.entries(error)).get('message');
          if (typeof message === 'string' && message !== '') return message;
        }
      }
    }
  }
  return status === 0 ? 'GitHub did not answer.' : `GitHub answered ${status}.`;
}

async function send(request: PageRequest): Promise<{ readonly ok: boolean; readonly status: number; readonly answer: unknown }> {
  try {
    const response = await pageFetch(request.url, request.init);
    const answer: unknown = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, answer };
  } catch {
    return { ok: false, status: 0, answer: null };
  }
}

export interface FixToApply {
  /** Every comment anchor of the thread the fix replaces the lines of. */
  readonly threadAnchors: readonly string[];
  readonly path: string;
  readonly replacement: readonly string[];
  readonly summary: string;
  readonly title: string;
  readonly headSha: string;
  /** A suggestion reply Geld posted for this fix whose commit was refused: committed instead of posting another. */
  readonly pendingReply?: number | null;
}

export type ApplyResult =
  | { readonly ok: true; readonly replyAnchor: string }
  /**
   * `posted`: the suggestion reply stands in the thread, so GitHub's own Commit suggestion can still take it, and
   * `reply` names it when its id was read.
   */
  | { readonly ok: false; readonly reason: string; readonly posted: boolean; readonly reply?: { readonly anchor: string; readonly id: number } };

/** One fix's suggestion reply: the one Geld posted before, else a new one. A refusal is the fix's result. */
async function replyFor(pullPath: string, fix: FixToApply): Promise<number | ApplyResult> {
  const inReplyTo = lastCommentId(fix.threadAnchors);
  if (inReplyTo === null) return { ok: false, reason: 'This finding has no review thread to suggest in.', posted: false };
  if (fix.pendingReply !== undefined && fix.pendingReply !== null) return fix.pendingReply;
  const reply = await send(reviewReplyRequest(pullPath, { text: suggestionReplyBody(fix.replacement, fix.summary), inReplyTo, path: fix.path }, fetchNonce()));
  if (!reply.ok) return { ok: false, reason: refusalOf(reply.answer, reply.status), posted: false };
  return newestCommentId(reply.answer, inReplyTo) ?? { ok: false, reason: 'The suggestion is in the thread. Commit it from there.', posted: true };
}

/**
 * Several fixes in one commit, as GitHub's "Add suggestion to batch": every commit moves the branch's head, and a
 * commit sent against the head before it is refused, so fixes one after another would all but the first fail. Each
 * fix's reply is posted (in order), then every reply that stands is committed at once. Results are in `fixes`' order.
 */
export async function applyFixes(fixes: readonly FixToApply[]): Promise<readonly ApplyResult[]> {
  const pullPath = pullPathOf(window.location.pathname);
  if (pullPath === null) return fixes.map(() => ({ ok: false, reason: 'This finding has no review thread to suggest in.', posted: false }));
  const replies: Array<{ readonly fix: FixToApply; readonly reply: number | ApplyResult }> = [];
  for (const fix of fixes) replies.push({ fix, reply: await replyFor(pullPath, fix) });
  const ready = replies.flatMap(({ fix, reply }) => (typeof reply === 'number' ? [{ fix, id: reply }] : []));
  const first = ready[0];
  if (first === undefined) return replies.flatMap(({ reply }) => (typeof reply === 'number' ? [] : [reply]));
  const commit = await send(applySuggestionsRequest(pullPath, ready.map((entry) => entry.id), commitMessage(ready.map((entry) => entry.fix.title)), first.fix.headSha, fetchNonce(), crypto.randomUUID()));
  const refusal = commit.ok ? '' : `${refusalOf(commit.answer, commit.status)} The ${ready.length === 1 ? 'suggestion is' : 'suggestions are'} in the thread.`;
  return replies.map(({ reply }): ApplyResult => {
    if (typeof reply !== 'number') return reply;
    const anchor = `discussion_r${reply}`;
    return commit.ok ? { ok: true, replyAnchor: anchor } : { ok: false, reason: refusal, posted: true, reply: { anchor, id: reply } };
  });
}

export async function applyFix(fix: FixToApply): Promise<ApplyResult> {
  return (await applyFixes([fix]))[0] ?? { ok: false, reason: 'GitHub did not answer.', posted: false };
}
