// @vitest-environment happy-dom
import type { ProviderReviewComment } from '@geld/review';
import { gitLabAuthorPresentation } from './author-presentation';

const comment: ProviderReviewComment = { id: '4118584957', anchor: 'note_4118584957', url: 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334#note_4118584957', author: { id: '33096491', login: 'jotolo_gl' }, body: 'Please review this change.', createdAt: '2026-10-29T16:52:16.580Z' };
const SRC = 'https://gitlab.com/uploads/-/system/user/avatar/33096491/avatar.png?v=1793547282';

beforeEach(() => {
  window.location.href = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';
  // Reduced from note_4118584957's actual author header in anonymous installed Chrome, November 1, 2026.
  document.body.innerHTML = `<li id="note_4118584957" data-note-id="4118584957" data-testid="noteable-note-container"><div class="timeline-entry-inner"><div class="timeline-avatar"><a href="/jotolo_gl" data-user-id="33096491" data-username="jotolo_gl" class="gl-avatar-link js-user-link"><img src="${SRC}" alt="Jorge Tomás" class="gl-avatar gl-avatar-circle gl-avatar-s32"></a></div><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a href="/jotolo_gl" data-user-id="33096491" data-username="jotolo_gl" class="author-name-link js-user-link"><span data-testid="author-name">Jorge Tomás</span></a><span class="author-username"><a href="/jotolo_gl" class="author-username-link"><span>@jotolo_gl</span></a></span><a href="#note_4118584957"><time datetime="2026-10-29T16:52:16.580Z">2 days ago</time></a></div><div class="note-actions"><span class="gl-mr-3 gl-hidden @sm/panel:gl-block gl-badge badge badge-pill badge-neutral" title="This user is the author of this merge request."><span class="gl-badge-content">Author</span></span><span class="gl-mr-3 gl-hidden @sm/panel:gl-block gl-badge badge badge-pill badge-neutral" title="This user has the developer role in the GitLab project."><span class="gl-badge-content">Developer</span></span><button>More actions</button></div></div><div class="note-body"><div class="note-text">Please review this change.</div></div></div></div></li>`;
});

it('matches the native durable user identity and exposes exact name, alias, profile and author-header badges', () => {
  const value = gitLabAuthorPresentation(comment, document);
  expect(value).toMatchObject({ authorId: '33096491', displayName: 'Jorge Tomás', username: '@jotolo_gl', profileUrl: 'https://gitlab.com/jotolo_gl', badges: [{ label: 'Author', className: 'gl-badge badge badge-pill badge-neutral', title: 'This user is the author of this merge request.' }, { label: 'Developer', className: 'gl-badge badge badge-pill badge-neutral', title: 'This user has the developer role in the GitLab project.' }] });
  expect(value?.avatar).toBeUndefined();
  expect(value?.badges?.some((badge) => badge.className?.includes('gl-hidden'))).toBe(false);
});

it('uses measured native avatar size, not the gl-avatar-s32 class name as an inferred default', () => {
  const image = document.querySelector('img');
  if (image === null) throw new Error('Missing native avatar');
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 31.5, 31.5));
  expect(gitLabAuthorPresentation(comment, document)?.avatar).toMatchObject({ src: SRC, width: 31.5, height: 31.5, className: 'gl-avatar gl-avatar-circle gl-avatar-s32' });
});

it('retains a verified measurement while hidden but discards it for a changed source or remounted image', () => {
  const image = document.querySelector('img');
  if (image === null) throw new Error('Missing native avatar');
  const rect = vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 31, 31));
  expect(gitLabAuthorPresentation(comment, document)?.avatar?.width).toBe(31);
  rect.mockReturnValue(new DOMRect());
  expect(gitLabAuthorPresentation(comment, document)?.avatar?.width).toBe(31);
  image.setAttribute('src', 'https://example.com/new-avatar.png');
  expect(gitLabAuthorPresentation(comment, document)?.avatar).toBeUndefined();
  image.setAttribute('src', SRC);
  rect.mockReturnValue(new DOMRect(0, 0, 28, 28));
  expect(gitLabAuthorPresentation(comment, document)?.avatar?.width).toBe(28);
  image.replaceWith(image.cloneNode(true));
  expect(gitLabAuthorPresentation(comment, document)?.avatar).toBeUndefined();
});

it('keeps avatar identity separate and never reads a body badge or mention as the comment author', () => {
  document.querySelector('.note-text')?.insertAdjacentHTML('afterbegin', '<span class="gl-badge"><span class="gl-badge-content">Owner</span></span><a data-user-id="1" data-username="admin" class="author-name-link"><span data-testid="author-name">Administrator</span></a>');
  document.querySelector('.gl-avatar-link')?.setAttribute('data-user-id', '1');
  const value = gitLabAuthorPresentation(comment, document);
  expect(value?.displayName).toBe('Jorge Tomás');
  expect(value?.avatar).toBeUndefined();
  expect(value?.badges?.map((badge) => badge.label)).toEqual(['Author', 'Developer']);
  document.querySelector('.note-header')?.remove();
  expect(gitLabAuthorPresentation(comment, document)).toBeNull();
});

it('rejects mismatched API authors and foreign profile or review URLs', () => {
  expect(gitLabAuthorPresentation({ ...comment, author: { id: '1', login: 'jotolo_gl' } }, document)).toBeNull();
  expect(gitLabAuthorPresentation({ ...comment, author: { id: '33096491', login: 'other-user' } }, document)).toBeNull();
  expect(gitLabAuthorPresentation({ ...comment, url: comment.url.replace('/266334', '/1') }, document)).toBeNull();
  document.querySelector('.author-name-link')?.setAttribute('href', 'https://example.com/jotolo_gl');
  expect(gitLabAuthorPresentation(comment, document)).toBeNull();
});

it('omits unsafe avatar URLs and rejects extension copies', () => {
  const image = document.querySelector('img');
  if (image === null) throw new Error('Missing native avatar');
  image.style.width = '30px';
  image.style.height = '30px';
  image.setAttribute('src', 'http://example.com/avatar.png');
  expect(gitLabAuthorPresentation(comment, document)?.avatar).toBeUndefined();
  document.querySelector('[data-testid="noteable-note-container"]')?.setAttribute('data-geld-ui', '');
  expect(gitLabAuthorPresentation(comment, document)).toBeNull();
});
