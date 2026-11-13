import { describe, expect, it } from 'vitest';
import { applySuggestionsRequest, lastCommentId, newestCommentId, refusalOf, reviewReplyRequest } from './apply-suggestion';

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
