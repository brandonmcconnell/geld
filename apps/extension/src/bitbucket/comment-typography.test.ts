// @vitest-environment happy-dom
import { bindBitbucketCommentTypography } from './comment-typography';
import { renderBitbucketComment } from './comment-render';
import type { ProviderReviewComment } from '@geld/review';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

const theme = readFileSync(new NodeURL('./theme.css', import.meta.url), 'utf8');

const BASE = '--ak-renderer-base-font-size';
const PARAGRAPH = '--ak-renderer-editor-font-normal-text';
const ROOT = '--geld-bitbucket-body-line-height';
const font = 'normal 400 1em/1.714 "Atlassian Sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, "Helvetica Neue", sans-serif';
const comment: ProviderReviewComment = { id: '471253038', anchor: 'comment-471253038', url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/_/diff#comment-471253038', author: { id: '{native-user}', login: 'reviewer' }, body: 'Internal maintenance: Update tests to access token auth.', createdAt: '2024-02-13T15:46:48Z', updatedAt: '2024-02-13T15:46:48Z' };

function source(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="comment-content"] .ak-renderer-document');
  if (element === null) throw new Error('Missing native body');
  return element;
}

function carrier(): HTMLElement {
  const element = source().parentElement;
  if (element === null) throw new Error('Missing native carrier');
  return element;
}

beforeEach(() => {
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
  document.documentElement.dataset.geldProvider = 'bitbucket';
  // Reduced actual PR22 comment HTML and inline native renderer font tokens from installed run41349305261.
  document.body.innerHTML = `<div id="comment-471253038" data-testid="comment"><span data-testid="comment-header"><a href="#comment-471253038">source</a></span><div data-testid="comment-content"><div class="ak-renderer-wrapper is-comment"><div><div class="ak-renderer-document"><p data-renderer-start-pos="1">${comment.body}</p><p data-renderer-start-pos="59">&nbsp;</p></div></div></div></div><button>Reply</button></div><div class="geld-provider-review__body"></div>`;
  carrier().style.setProperty(BASE, '14px');
  carrier().style.setProperty(PARAGRAPH, font);
  // Native stylesheet is not retained; this fixture supplies only the root font metric positively measured by Chrome.
  document.head.innerHTML = `<style>.ak-renderer-wrapper .ak-renderer-document {line-height:24px} .ak-renderer-wrapper .ak-renderer-document > p {font:var(${PARAGRAPH})} .geld-provider-review__body {font:400 14px/20px sans-serif;color:var(--ds-text)} ${theme}</style>`;
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

it('retains native root and paragraph typography without copying layout, colors or unsafe source styles', () => {
  const native = source();
  const original = native.outerHTML;
  const host = document.querySelector<HTMLElement>('.geld-provider-review__body');
  if (host === null) throw new Error('Missing owned host');
  const previousClone = native.cloneNode(true);
  if (!(previousClone instanceof HTMLElement)) throw new Error('Missing previous rendering');
  host.append(previousClone);
  expect(getComputedStyle(previousClone).lineHeight).toBe('20px');
  expect(getComputedStyle(native).lineHeight).toBe('24px');
  carrier().style.position = 'fixed';
  carrier().style.color = 'red';
  const originalCarrierStyle = carrier().getAttribute('style');
  expect(renderBitbucketComment(comment, host, document)).toBe(true);
  expect(host.style.getPropertyValue(BASE)).toBe('14px');
  expect(host.style.getPropertyValue(PARAGRAPH)).toBe(font);
  expect(host.style.getPropertyValue(ROOT)).toBe('24px');
  expect(host.style.position).toBe('');
  expect(host.style.color).toBe('');
  expect(host.querySelector('[style],[id],[data-renderer-start-pos],button')).toBeNull();
  const owned = host.querySelector<HTMLElement>('.ak-renderer-document');
  if (owned === null) throw new Error('Missing owned body');
  expect(getComputedStyle(owned).lineHeight).toBe(getComputedStyle(native).lineHeight);
  expect(getComputedStyle(owned).fontSize).toBe('14px');
  const nativeParagraph = native.querySelector('p');
  const ownedParagraph = owned.querySelector('p');
  if (nativeParagraph === null || ownedParagraph === null) throw new Error('Missing measured paragraph');
  for (const property of ['font-family', 'font-size', 'font-weight', 'line-height']) expect(getComputedStyle(ownedParagraph).getPropertyValue(property)).toBe(getComputedStyle(nativeParagraph).getPropertyValue(property));
  // Happy DOM does not resolve native font-shorthand em ratios to Chrome's measured23.996px.
  expect(theme).toContain('font: var(--ak-renderer-editor-font-normal-text, inherit)');
  expect(native.outerHTML).toBe(original);
  expect(native.parentElement).toBe(carrier());
  expect(carrier().getAttribute('style')).toBe(originalCarrierStyle);
  expect(renderBitbucketComment({ ...comment, url: comment.url.replace('/22/', '/27/') }, host, document)).toBe(false);
  expect(host.style.getPropertyValue(ROOT)).toBe('');
  bindBitbucketCommentTypography(native, host);
  document.documentElement.dataset.geldProvider = 'gitlab';
  const gitlabBody = owned.cloneNode(true);
  if (!(gitlabBody instanceof HTMLElement)) throw new Error('Missing GitLab scope fixture');
  owned.replaceWith(gitlabBody);
  expect(getComputedStyle(gitlabBody).lineHeight).toBe('20px');
});

it('measures once across200 unchanged applies and refreshes once for context, theme and viewport changes', () => {
  const native = source();
  const host = document.createElement('div');
  const computed = vi.spyOn(window, 'getComputedStyle');
  const rect = vi.spyOn(native, 'getBoundingClientRect');
  const listeners = vi.spyOn(window, 'addEventListener');
  for (let index = 0; index < 200; index += 1) bindBitbucketCommentTypography(native, host);
  expect(computed).toHaveBeenCalledTimes(1);
  expect(rect).not.toHaveBeenCalled();
  expect(listeners).not.toHaveBeenCalled();
  carrier().classList.add('native-font-context');
  bindBitbucketCommentTypography(native, host);
  bindBitbucketCommentTypography(native, host);
  expect(computed).toHaveBeenCalledTimes(2);
  carrier().style.setProperty(PARAGRAPH, font.replace('/1.714', '/1.8'));
  bindBitbucketCommentTypography(native, host);
  bindBitbucketCommentTypography(native, host);
  expect(computed).toHaveBeenCalledTimes(3);
  document.documentElement.dataset.theme = 'dark';
  bindBitbucketCommentTypography(native, host);
  bindBitbucketCommentTypography(native, host);
  expect(computed).toHaveBeenCalledTimes(4);
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(window.innerWidth + 100);
  bindBitbucketCommentTypography(native, host);
  bindBitbucketCommentTypography(native, host);
  expect(computed).toHaveBeenCalledTimes(5);
  const previous = carrier();
  const next = previous.cloneNode(false);
  if (!(next instanceof HTMLElement)) throw new Error('Missing replacement context');
  previous.replaceWith(next);
  next.append(native);
  bindBitbucketCommentTypography(native, host);
  bindBitbucketCommentTypography(native, host);
  expect(computed).toHaveBeenCalledTimes(6);
  const replacement = native.cloneNode(true);
  if (!(replacement instanceof HTMLElement)) throw new Error('Missing replacement');
  native.replaceWith(replacement);
  bindBitbucketCommentTypography(replacement, host);
  bindBitbucketCommentTypography(replacement, host);
  expect(computed).toHaveBeenCalledTimes(7);
});

it('retains cached typography while compact hides the unchanged native root, and measures actual non24px changes', () => {
  const native = source();
  const host = document.createElement('div');
  const computed = vi.spyOn(window, 'getComputedStyle');
  bindBitbucketCommentTypography(native, host);
  native.closest('[data-testid="comment"]')?.setAttribute('hidden', '');
  bindBitbucketCommentTypography(native, host);
  expect(host.style.getPropertyValue(ROOT)).toBe('24px');
  bindBitbucketCommentTypography(null, host);
  expect(host.style.getPropertyValue(ROOT)).toBe('');
  expect(computed).toHaveBeenCalledTimes(1);
  native.style.lineHeight = '27.5px';
  bindBitbucketCommentTypography(native, host);
  expect(computed).toHaveBeenCalledTimes(2);
  expect(host.style.getPropertyValue(ROOT)).toBe('27.5px');
  carrier().replaceWith(carrier().cloneNode(true));
  const replacement = source();
  bindBitbucketCommentTypography(replacement, host);
  expect(computed).toHaveBeenCalledTimes(3);
  expect(host.style.getPropertyValue(ROOT)).toBe('27.5px');
  carrier().style.removeProperty(BASE);
  bindBitbucketCommentTypography(replacement, host);
  expect(host.style.getPropertyValue(ROOT)).toBe('');
  carrier().style.setProperty(BASE, '14px');
  bindBitbucketCommentTypography(replacement, host);
  expect(host.style.getPropertyValue(ROOT)).toBe('27.5px');
  replacement.remove();
  bindBitbucketCommentTypography(replacement, host);
  expect(host.style.getPropertyValue(ROOT)).toBe('');
});

it('clears prior bindings for invalid or unverified native context instead of guessing a line-height', () => {
  const native = source();
  const host = document.createElement('div');
  bindBitbucketCommentTypography(native, host);
  expect(host.style.getPropertyValue(ROOT)).toBe('24px');
  for (const value of ['normal', '0px', '999px']) {
    native.style.lineHeight = value;
    bindBitbucketCommentTypography(native, host);
    expect(host.style.getPropertyValue(ROOT)).toBe('');
  }
  native.style.removeProperty('line-height');
  carrier().style.setProperty(PARAGRAPH, 'url(https://example.com/font)');
  bindBitbucketCommentTypography(native, host);
  expect(host.style.getPropertyValue(PARAGRAPH)).toBe('');
  carrier().style.setProperty(PARAGRAPH, font);
  native.dataset.geldUi = '';
  bindBitbucketCommentTypography(native, host);
  expect(host.style.getPropertyValue(BASE)).toBe('');
  delete native.dataset.geldUi;
  native.remove();
  bindBitbucketCommentTypography(native, host);
  expect(host.style.getPropertyValue(ROOT)).toBe('');
});

it('clears typography when cloning a reused host exceeds the sanitizer budget or rejects the source element', () => {
  const native = source();
  const host = document.createElement('div');
  expect(renderBitbucketComment(comment, host, document)).toBe(true);
  expect(host.hasAttribute('data-geld-bitbucket-typography')).toBe(true);
  native.replaceChildren(...Array.from({ length: 10_001 }, () => document.createTextNode('x')));
  expect(renderBitbucketComment(comment, host, document)).toBe(false);
  expect(host.hasAttribute('data-geld-bitbucket-typography')).toBe(false);
  expect(host.style.getPropertyValue(ROOT)).toBe('');
  bindBitbucketCommentTypography(native, host);
  expect(host.hasAttribute('data-geld-bitbucket-typography')).toBe(true);
  const rejected = document.createElement('form');
  rejected.className = 'ak-renderer-document';
  native.replaceWith(rejected);
  expect(renderBitbucketComment(comment, host, document)).toBe(false);
  expect(host.hasAttribute('data-geld-bitbucket-typography')).toBe(false);
  expect(host.style.getPropertyValue(PARAGRAPH)).toBe('');
});

it('does not apply the typography bridge to an unbound body with inherited native font variables', () => {
  const host = document.querySelector<HTMLElement>('.geld-provider-review__body');
  if (host === null) throw new Error('Missing fallback host');
  host.style.setProperty(BASE, '40px');
  host.style.setProperty(PARAGRAPH, 'normal 400 2em/3 sans-serif');
  host.style.setProperty(ROOT, '90px');
  host.innerHTML = '<div class="ak-renderer-document"><p>Fallback</p></div>';
  const body = host.querySelector('div');
  if (body === null) throw new Error('Missing fallback body');
  expect(getComputedStyle(body).fontSize).toBe('14px');
  expect(getComputedStyle(body).lineHeight).toBe('20px');
});
