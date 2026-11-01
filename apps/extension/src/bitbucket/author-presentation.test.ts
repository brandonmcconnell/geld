// @vitest-environment happy-dom
import type { ProviderReviewComment } from '@geld/review';
import { bitbucketAuthorPresentation } from './author-presentation';

const comment: ProviderReviewComment = { id: '471253038', anchor: 'comment-471253038', url: 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22/_/diff#comment-471253038', author: { id: '{c3cbd4fd-2494-4a26-a4db-ea02e2cdb5ee}', login: 'native-login' }, body: 'Internal maintenance: Update tests to access token auth.', createdAt: '2024-02-13T15:46:48Z' };
const SRC = 'https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/initials/OK-5.png';

beforeEach(() => {
  window.location.href = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/22';
  // Author header and separate avatar column reduced from anonymous PR22, November 1, 2026.
  document.body.innerHTML = `<div id="comment-471253038" data-testid="comment"><div><div role="img" aria-labelledby="native-author-name"><span><img src="${SRC}" alt="" aria-hidden="true" data-vc="avatar-image" class="_16jlkb7n _1o9zkb7n _i0dl1osq _1e0c1txw _1bsb1osq _4t3i1osq _2rko1rr0"></span><span id="native-author-name" hidden>Oleksandr Kyrdan</span></div></div><div><h3><span data-testid="comment-header"><span><span role="presentation"><span>Oleksandr Kyrdan</span></span></span><span><a href="#comment-471253038"><time datetime="2024-02-13">2024-02-13</time></a></span></span></h3><div data-testid="comment-content"><p>Internal maintenance: Update tests to access token auth.</p></div></div></div>`;
});

it('binds the actual native header name to the API comment author without inventing profile, alias, or role metadata', () => {
  const value = bitbucketAuthorPresentation(comment, document);
  expect(value).toEqual({ authorId: comment.author.id, displayName: 'Oleksandr Kyrdan' });
  expect(value?.avatar).toBeUndefined();
});

it('uses measured native avatar dimensions instead of inferring a default from the compiled classes', () => {
  const image = document.querySelector('img');
  if (image === null) throw new Error('Missing native avatar');
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 30.5, 30.5));
  const value = bitbucketAuthorPresentation(comment, document);
  expect(value?.avatar).toMatchObject({ src: SRC, width: 30.5, height: 30.5, className: image.className });
});

it('reads actual CSS dimensions for a compacted original and drops unsafe or unmeasured avatar sources', () => {
  const image = document.querySelector('img');
  if (image === null) throw new Error('Missing native avatar');
  image.style.width = '28px';
  image.style.height = '28px';
  expect(bitbucketAuthorPresentation(comment, document)?.avatar).toMatchObject({ width: 28, height: 28 });
  image.setAttribute('src', 'data:image/svg+xml,bad');
  expect(bitbucketAuthorPresentation(comment, document)?.avatar).toBeUndefined();
  image.removeAttribute('src');
  expect(bitbucketAuthorPresentation(comment, document)?.avatar).toBeUndefined();
});

it('retains only previously measured dimensions while compacted, refreshing measurements and invalidating changed sources', () => {
  const image = document.querySelector('img');
  if (image === null) throw new Error('Missing native avatar');
  const rect = vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 30, 30));
  expect(bitbucketAuthorPresentation(comment, document)?.avatar?.width).toBe(30);
  rect.mockReturnValue(new DOMRect());
  image.style.width = '100%'; image.style.height = '100%';
  expect(bitbucketAuthorPresentation(comment, document)?.avatar?.width).toBe(30);
  rect.mockReturnValue(new DOMRect(0, 0, 24, 24));
  window.dispatchEvent(new Event('resize'));
  expect(bitbucketAuthorPresentation(comment, document)?.avatar?.width).toBe(24);
  rect.mockReturnValue(new DOMRect());
  image.setAttribute('src', 'data:image/svg+xml,changed');
  expect(bitbucketAuthorPresentation(comment, document)?.avatar).toBeUndefined();
  image.setAttribute('src', SRC);
  expect(bitbucketAuthorPresentation(comment, document)?.avatar).toBeUndefined();
  rect.mockReturnValue(new DOMRect(0, 0, 24, 24));
  window.dispatchEvent(new Event('resize'));
  expect(bitbucketAuthorPresentation(comment, document)?.avatar?.width).toBe(24);
  rect.mockReturnValue(new DOMRect());
  image.setAttribute('src', 'https://example.com/new-avatar.png');
  expect(bitbucketAuthorPresentation(comment, document)?.avatar).toBeUndefined();
  image.setAttribute('src', SRC);
  expect(bitbucketAuthorPresentation(comment, document)?.avatar).toBeUndefined();
});

it('reads avatar geometry once across 200 unchanged author-presentation passes', () => {
  const image = document.querySelector('img');
  if (image === null) throw new Error('Missing native avatar');
  image.style.width = '28px'; image.style.height = '28px';
  const rect = vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect());
  const styles = vi.spyOn(window, 'getComputedStyle');
  for (let index = 0; index < 200; index += 1) expect(bitbucketAuthorPresentation(comment, document)?.avatar?.width).toBe(28);
  expect(rect).toHaveBeenCalledOnce();
  expect(styles).toHaveBeenCalledOnce();
});

it('does not transfer a previous measurement to a remounted native image', () => {
  const image = document.querySelector('img');
  if (image === null) throw new Error('Missing native avatar');
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 30, 30));
  expect(bitbucketAuthorPresentation(comment, document)?.avatar?.width).toBe(30);
  image.replaceWith(image.cloneNode(true));
  expect(bitbucketAuthorPresentation(comment, document)?.avatar).toBeUndefined();
});

it('never uses body mentions or badges, or a different person’s avatar label', () => {
  const content = document.querySelector('[data-testid="comment-content"]');
  content?.insertAdjacentHTML('afterbegin', '<span data-testid="comment-header"><span>Administrator</span></span><span class="gl-badge">Owner</span><img data-vc="avatar-image" src="https://example.com/body.png" width="32" height="32">');
  document.getElementById('native-author-name')?.replaceChildren('Another person');
  expect(bitbucketAuthorPresentation(comment, document)).toEqual({ authorId: comment.author.id, displayName: 'Oleksandr Kyrdan' });
  document.querySelector('h3')?.remove();
  expect(bitbucketAuthorPresentation(comment, document)).toBeNull();
});

it('rejects foreign review identity and ignores copied author metadata inside extension UI', () => {
  expect(bitbucketAuthorPresentation({ ...comment, url: comment.url.replace('/22/', '/27/') }, document)).toBeNull();
  const root = document.querySelector('[data-testid="comment"]');
  root?.setAttribute('data-geld-ui', '');
  expect(bitbucketAuthorPresentation(comment, document)).toBeNull();
});
