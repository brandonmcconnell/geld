// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

const requests: string[] = [];
const answers: Array<{ readonly status: number; readonly body: unknown }> = [];
vi.mock('../page-fetch', () => ({
  pageFetch: async (url: string): Promise<Response> => {
    requests.push(url);
    const next = answers.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  },
}));

const { applyFix, applySuggestionsRequest, lastCommentId, newestCommentId, refusalOf, reviewReplyRequest } = await import('./apply-suggestion');

describe('applying a fix', () => {
  const fix = { threadAnchors: ['discussion_r100'], path: 'src/a.ts', replacement: ['x'], summary: 'Fix.', title: 'Fix it', headSha: 'abc' };

  it('commits a reply it posted before rather than posting another', async () => {
    window.history.pushState({}, '', '/o/r/pull/7');
    requests.length = 0;
    answers.push({ status: 200, body: {} });
    expect(await applyFix({ ...fix, pendingReply: 200 })).toEqual({ ok: true, replyAnchor: 'discussion_r200' });
    expect(requests).toEqual(['/o/r/pull/7/page_data/apply_review_suggestions']);
  });

  it('names the reply it posted when GitHub refuses the commit', async () => {
    window.history.pushState({}, '', '/o/r/pull/7');
    requests.length = 0;
    answers.push({ status: 200, body: { thread: { commentsData: { comments: [{ databaseId: 100 }, { databaseId: 201 }] } } } }, { status: 422, body: { message: 'Head was modified' } });
    const result = await applyFix(fix);
    expect(result).toEqual({ ok: false, reason: 'Head was modified The suggestion is in the thread.', posted: true, reply: { anchor: 'discussion_r201', id: 201 } });
  });
});

describe('apply-suggestion requests', () => {
  it('replies in the thread as GitHub’s reply box does', () => {
    const request = reviewReplyRequest('/o/r/pull/7', { text: 'fix', inReplyTo: 12, path: 'src/a.ts' }, 'n0nce');
    expect(request.url).toBe('/o/r/pull/7/page_data/create_review_comment');
    expect(request.init.method).toBe('POST');
    expect(JSON.parse(String(request.init.body))).toEqual({ text: 'fix', inReplyTo: 12, submitBatch: false, path: 'src/a.ts' });
    expect(request.init.headers).toMatchObject({ 'X-Fetch-Nonce': 'n0nce', 'GitHub-Verified-Fetch': 'true' });
  });

  it('commits the reply’s suggestion against the head it was written for, once', () => {
    const request = applySuggestionsRequest('/o/r/pull/7', 99, 'Apply', 'abc', '', 'key-1');
    expect(request.url).toBe('/o/r/pull/7/page_data/apply_review_suggestions');
    expect(JSON.parse(String(request.init.body))).toEqual({ comments: [{ id: 99, suggestionIndex: 0 }], message: 'Apply', expectedHeadOid: 'abc' });
    expect(request.init.headers).toMatchObject({ 'Idempotency-Key': 'key-1' });
    expect(request.init.headers).not.toHaveProperty('X-Fetch-Nonce');
  });

  it('answers the newest comment of the thread and finds the reply in GitHub’s answer', () => {
    expect(lastCommentId(['discussion_r5', 'issuecomment-9', 'discussion_r31'])).toBe(31);
    expect(lastCommentId(['issuecomment-9'])).toBeNull();
    const answer = { thread: { id: 4, commentsData: { comments: [{ databaseId: 31 }, { databaseId: 77, body: 'x' }] } } };
    expect(newestCommentId(answer, 31)).toBe(77);
    expect(newestCommentId({ thread: { commentsData: { comments: [{ databaseId: 31 }] } } }, 31)).toBeNull();
  });

  it('says GitHub’s own words for a refusal', () => {
    expect(refusalOf({ message: 'Head was modified' }, 422)).toBe('Head was modified');
    expect(refusalOf({ errors: [{ message: 'Not allowed' }] }, 403)).toBe('Not allowed');
    expect(refusalOf(null, 500)).toBe('GitHub answered 500.');
  });
});
