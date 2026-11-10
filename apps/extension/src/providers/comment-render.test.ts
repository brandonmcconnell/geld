// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import type { ProviderCommentRenderContext } from './comment-render';
import { renderProviderReviewPanel } from './review-panel';

const comment: ProviderReviewComment = { id: '11', anchor: 'note_11', url: 'https://gitlab.com/group/repo/-/merge_requests/7#note_11', author: { id: '23', login: 'author' }, body: 'Source', createdAt: '2026-11-01T12:00:00Z' };
const input: ProviderReviewInput = { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/repo', id: '7', headSha: 'a'.repeat(40) }, threads: [], reviewers: [] };
it('owns mount/dispose generations and preserves boolean state only for the exact comment occurrence/head lifetime', () => {
  const host = document.createElement('div');document.body.append(host);const contexts: ProviderCommentRenderContext[] = [];let disposals = 0;let mounted = 0;
  const renderComment = (_comment: ProviderReviewComment, body: HTMLElement, context?: ProviderCommentRenderContext): boolean => {
    if (context === undefined) throw new Error('Missing lifecycle');contexts.push(context);body.textContent = 'Owned content';context.onMount(() => { expect(context.current()).toBe(true);mounted += 1; });context.onDispose(() => { disposals += 1; });return true;
  };
  const panel = renderProviderReviewPanel(host, input, { comments: [comment, comment], renderComment });
  expect(mounted).toBe(2);expect(contexts[0]?.idNamespace).not.toBe(contexts[1]?.idNamespace);contexts[0]?.state.set('local-choice', true);expect(contexts[1]?.state.has('local-choice')).toBe(false);
  panel.update(input, { comments: [comment, comment], renderComment, version: 1 });expect(disposals).toBe(2);expect(contexts[0]?.current()).toBe(false);expect(contexts[2]?.state.get('local-choice')).toBe(true);expect(contexts[3]?.state.has('local-choice')).toBe(false);
  panel.update(input, { comments: [{ ...comment, body: 'Edited source' }], renderComment });expect(contexts.at(-1)?.state.size).toBe(0);
  panel.update({ ...input, subject: { ...input.subject, headSha: 'b'.repeat(40) } }, { comments: [comment], renderComment });expect(contexts.at(-1)?.state.size).toBe(0);
  panel.destroy();expect(contexts.every((context) => !context.current() && context.state.size === 0)).toBe(true);expect(disposals).toBe(contexts.length);host.remove();
});
it('prunes removed source state instead of resurrecting a previous local choice when a source returns', () => {
  const host = document.createElement('div');document.body.append(host);let latest: ProviderCommentRenderContext | undefined;
  const renderComment = (_comment: ProviderReviewComment, _body: HTMLElement, context?: ProviderCommentRenderContext): boolean => { latest = context;return true; };
  const panel = renderProviderReviewPanel(host, input, { comments: [comment], renderComment });latest?.state.set('expanded', true);panel.update(input, { comments: [], renderComment });panel.update(input, { comments: [comment], renderComment });expect(latest?.state.size).toBe(0);panel.destroy();host.remove();
});
