import { suggestionReplyBody } from '@geld/review';
import { pageFetch } from '../page-fetch';
import { fetchNonce, pullPathOf } from '../timeline-comment';

/**
 * Applying a triage fix the way GitHub applies a reviewer's suggestion, so nothing needs a token with write access to
 * the code: the fix is posted as a `suggestion` reply in the finding's thread, then committed to the pull request's
 * branch with GitHub's own "Commit suggestion" request. Both requests are the ones GitHub's pull request page sends,
 * read from its bundle in Nov 2026: `page_data/create_review_comment` (`{ text, inReplyTo, submitBatch, path }`, the
 * thread's reply box) and `page_data/apply_review_suggestions` (`{ comments: [{ id }], message, expectedHeadOid }`
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

export function applySuggestionsRequest(pullPath: string, commentId: number, message: string, headOid: string, nonce: string, idempotencyKey: string): PageRequest {
  return {
    url: `${pullPath}/page_data/apply_review_suggestions`,
    init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, { 'Idempotency-Key': idempotencyKey }), body: JSON.stringify({ comments: [{ id: commentId }], message, expectedHeadOid: headOid }) },
  };
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
}

export type ApplyResult =
  | { readonly ok: true; readonly replyAnchor: string }
  /** `posted`: the suggestion reply stands in the thread, so GitHub's own Commit suggestion can still take it. */
  | { readonly ok: false; readonly reason: string; readonly posted: boolean };

export async function applyFix(fix: FixToApply): Promise<ApplyResult> {
  const pullPath = pullPathOf(window.location.pathname);
  const inReplyTo = lastCommentId(fix.threadAnchors);
  if (pullPath === null || inReplyTo === null) return { ok: false, reason: 'This finding has no review thread to suggest in.', posted: false };
  const reply = await send(reviewReplyRequest(pullPath, { text: suggestionReplyBody(fix.replacement, fix.summary), inReplyTo, path: fix.path }, fetchNonce()));
  if (!reply.ok) return { ok: false, reason: refusalOf(reply.answer, reply.status), posted: false };
  const commentId = newestCommentId(reply.answer, inReplyTo);
  if (commentId === null) return { ok: false, reason: 'The suggestion is in the thread. Commit it from there.', posted: true };
  const message = `Apply suggestion from Geld triage\n\n${fix.title}`;
  const commit = await send(applySuggestionsRequest(pullPath, commentId, message, fix.headSha, fetchNonce(), crypto.randomUUID()));
  if (!commit.ok) return { ok: false, reason: `${refusalOf(commit.answer, commit.status)} The suggestion is in the thread.`, posted: true };
  return { ok: true, replyAnchor: `discussion_r${commentId}` };
}
