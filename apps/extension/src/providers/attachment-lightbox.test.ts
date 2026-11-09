// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { gitLabAttachmentLink } from '../gitlab/attachment';
import { bitbucketAttachmentLink } from '../bitbucket/attachment';
import { ProviderAttachmentLightbox } from './attachment-lightbox';
import type { ProviderAdapter, ProviderReviewPage } from './types';

const page: ProviderReviewPage = { provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/project' }, number: '1', kind: 'overview', url: 'https://gitlab.com/group/project/-/merge_requests/1', diffPageUrl: '', diffUrl: '', headSha: null, version: '1' };
const imageUrl = 'https://gitlab.com/-/project/123/uploads/0acc0b3514c56d8c6949d7c6aaa9c092/image.png';
let manager: ProviderAttachmentLightbox;
let adapter: ProviderAdapter;
function image(url = imageUrl): HTMLImageElement {
  document.body.innerHTML = `<div id="description"><a href="${url}"><img src="${url}" alt="Test image"></a></div>`;
  return document.querySelector('img')!;
}
beforeEach(() => {
  window.location.href = page.url;
  adapter = { id: 'gitlab', describe: () => page, readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff: async () => ({ files: [], revision: '1', complete: true }), descriptionHost: () => document.getElementById('description'), attachmentLink: gitLabAttachmentLink };
  manager = new ProviderAttachmentLightbox(adapter);
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false;this.dispatchEvent(new Event('close')); });
});
afterEach(() => { manager.clear();document.body.replaceChildren();vi.restoreAllMocks(); });

it('shares the fitted viewer with native image links, keeps modified clicks and restores focus', () => {
  const source = image();manager.update(page, true);
  source.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  expect(document.querySelector('dialog')).toBeNull();
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });source.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
  const dialog = document.querySelector('dialog');expect(dialog?.getAttribute('aria-label')).toBe('Test image');
  expect(dialog?.querySelector('.btn, .BtnGroup')).toBeNull();
  expect(dialog?.querySelector('a')?.href).toBe(imageUrl);
  dialog?.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(document.querySelector('dialog')).toBeNull();expect(document.activeElement).toBe(source.closest('a'));
});

it('restores annotations and closes the viewer on disable or navigation', () => {
  const source = image();manager.update(page, true);source.click();
  manager.update(page, false);expect(document.querySelector('dialog')).toBeNull();
  expect(source.hasAttribute('data-geld-provider-lightbox')).toBe(false);
  manager.update(page, true);window.location.href = `${page.url}/diffs`;adapter.describe = () => ({ ...page, url: window.location.href, kind: 'diff' });
  source.click();expect(document.querySelector('dialog')).toBeNull();
});

it('does not intercept downloads, unrelated pages or image links with a different destination', () => {
  const source = image();const anchor = source.closest('a')!;
  anchor.download = 'image.png';expect(gitLabAttachmentLink(source, page)).toBeNull();
  anchor.removeAttribute('download');anchor.href = 'https://example.com';expect(gitLabAttachmentLink(source, page)).toBeNull();
  anchor.href = source.src = 'https://gitlab.com/group/project/-/issues/2';expect(gitLabAttachmentLink(source, page)).toBeNull();
  anchor.href = source.src = 'https://elsewhere.example/uploads/0acc0b3514c56d8c6949d7c6aaa9c092/image.png';expect(gitLabAttachmentLink(source, page)).toBeNull();
});

it('qualifies same-repository Bitbucket image files without reusing GitLab upload rules', () => {
  const bb: ProviderReviewPage = { ...page, provider: 'bitbucket', repository: { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'team/project' }, url: 'https://bitbucket.org/team/project/pull-requests/1' };
  const source = image('https://bitbucket.org/team/project/raw/abcdef/screens/test.png');
  expect(bitbucketAttachmentLink(source, bb)).toBe(source.closest('a'));
  source.closest('a')!.href = source.src = 'https://bitbucket.org/another/project/raw/abcdef/screens/test.png';
  expect(bitbucketAttachmentLink(source, bb)).toBeNull();
});
