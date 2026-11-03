// @vitest-environment happy-dom
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { bitbucketCommentSignature, renderBitbucketComment } from '../bitbucket/comment-render';
import { renderProviderReviewPanel } from './review-panel';
import type { ProviderCommentRenderContext } from './comment-render';

const url = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
const comment: ProviderReviewComment = { id: '471253038', anchor: 'comment-471253038', url: `${url}/_/diff#comment-471253038`, author: { id: '{native-user}', login: 'reviewer' }, body: '**Review** the change.', createdAt: '2024-02-13T15:46:48Z' };
const input: ProviderReviewInput = { subject: { provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'atlassian/bitbucket-upload-file', id: '22', headSha: 'a'.repeat(40) }, threads: [], reviewers: [], checks: [] };

beforeEach(() => { window.location.href = url; document.body.replaceChildren(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('refreshes formatted native content when the original mounts or changes without replacing API data', () => {
  const host = document.createElement('main'); document.body.append(host);
  const options = { comments: [comment], renderComment: (source: ProviderReviewComment, body: HTMLElement) => renderBitbucketComment(source, body, document), commentSignature: (source: ProviderReviewComment) => bitbucketCommentSignature(source, document) };
  const panel = renderProviderReviewPanel(host, input, options);
  const before = panel.element.querySelector('.geld-provider-review__body');
  expect(before?.textContent).toBe(comment.body);
  expect(before?.querySelector('strong')).toBeNull();
  const native = document.createElement('article');
  native.id = comment.anchor; native.dataset.testid = 'comment';
  native.innerHTML = `<header data-testid="comment-header"><a href="#${comment.anchor}">Original</a></header><div data-testid="comment-content"><div><div class="ak-renderer-document"><p><strong>Review</strong> the change.</p></div></div></div>`;
  document.body.append(native);
  panel.update(input, options);
  expect(panel.element.querySelector('.geld-provider-review__body strong')?.textContent).toBe('Review');
  const formatted = panel.element.querySelector('.geld-provider-review__body');
  panel.update(input, options);
  expect(panel.element.querySelector('.geld-provider-review__body')).toBe(formatted);
  const paragraph = native.querySelector('p');
  if (paragraph === null) throw new Error('Missing original paragraph');
  paragraph.innerHTML = '<em>Updated native review</em>';
  panel.update(input, options);
  expect(panel.element.querySelector('.geld-provider-review__body em')?.textContent).toBe('Updated native review');
  native.remove();
  panel.update(input, options);
  expect(panel.element.querySelector('.geld-provider-review__body')?.textContent).toBe(comment.body);
  panel.destroy();
});

it('refreshes native typography on unchanged panel updates and viewport resize without rebuilding the body', () => {
  const host = document.createElement('main'); document.body.append(host);
  const native = document.createElement('article'); native.id = comment.anchor; native.dataset.testid = 'comment';
  native.innerHTML = `<header data-testid="comment-header"><a href="#${comment.anchor}">Original</a></header><div data-testid="comment-content"><div><div class="ak-renderer-document" style="line-height:24px"><p>Review</p></div></div></div>`;
  document.body.append(native);
  const source = native.querySelector<HTMLElement>('.ak-renderer-document');
  const carrier = source?.parentElement;
  if (source === null || carrier === null || carrier === undefined) throw new Error('Missing native font context');
  const font = 'normal 400 1em/1.714 Arial';
  carrier.style.setProperty('--ak-renderer-base-font-size', '14px');
  carrier.style.setProperty('--ak-renderer-editor-font-normal-text', font);
  const options = { comments: [comment], renderComment: (value: ProviderReviewComment, body: HTMLElement, context?: ProviderCommentRenderContext) => renderBitbucketComment(value, body, document, context), commentSignature: (value: ProviderReviewComment) => bitbucketCommentSignature(value, document) };
  const panel = renderProviderReviewPanel(host, input, options);
  const body = panel.element.querySelector<HTMLElement>('.geld-provider-review__body');
  const rendered = body?.firstElementChild;
  if (body === null) throw new Error('Missing rendered body');
  expect(body.style.getPropertyValue('--ak-renderer-base-font-size')).toBe('14px');
  carrier.style.setProperty('--ak-renderer-base-font-size', '18px');
  carrier.style.setProperty('--ak-renderer-editor-font-normal-text', 'normal 400 1em/1.8 Arial');
  panel.update(input, options);
  expect(panel.element.querySelector('.geld-provider-review__body')).toBe(body);
  expect(body.firstElementChild).toBe(rendered);
  expect(body.style.getPropertyValue('--ak-renderer-base-font-size')).toBe('18px');
  expect(body.style.getPropertyValue('--ak-renderer-editor-font-normal-text')).toBe('normal 400 1em/1.8 Arial');
  source.style.lineHeight = '31px';
  window.dispatchEvent(new Event('resize'));
  expect(body.style.getPropertyValue('--geld-bitbucket-body-line-height')).toBe('31px');
  expect(body.firstElementChild).toBe(rendered);
  const reads = vi.spyOn(window, 'getComputedStyle');
  panel.destroy();
  window.dispatchEvent(new Event('resize'));
  expect(reads).not.toHaveBeenCalled();
});
