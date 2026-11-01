import type { ProviderReviewComment } from '@geld/review';
import type { ProviderReviewAuthorPresentation } from '../providers/review-panel';
import { isProviderReviewPage } from '../providers/types';
import { describeGitLabPage } from './page';
import { readNativeAuthorAvatarGeometry } from '../providers/author-geometry';

function profile(href: string | null, doc: Document): string | null {
  if (href === null) return null;
  try { const url = new URL(href, doc.URL); return url.origin === doc.location.origin && url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : null; } catch { return null; }
}

export function gitLabAuthorPresentation(comment: ProviderReviewComment, doc: Document): ProviderReviewAuthorPresentation | null {
  if (!/^[1-9]\d*$/.test(comment.id) || comment.anchor !== `note_${comment.id}`) return null;
  let sourceUrl: URL;
  try { sourceUrl = new URL(comment.url); } catch { return null; }
  const source = describeGitLabPage(sourceUrl, doc);
  const current = describeGitLabPage(new URL(doc.URL), doc);
  if (source === null || current === null || !isProviderReviewPage(source) || !isProviderReviewPage(current) || source.url !== current.url || sourceUrl.hash !== `#${comment.anchor}`) return null;
  const root = [...doc.querySelectorAll<HTMLElement>('[data-testid="noteable-note-container"][id]')].find((node) => node.id === comment.anchor && node.closest('[data-geld-ui]') === null);
  const header = root?.querySelector<HTMLElement>(':scope > .timeline-entry-inner > .timeline-content > .note-header');
  const author = header?.querySelector<HTMLAnchorElement>(':scope > .note-header-info > a.author-name-link[data-user-id][data-username]');
  if (root === undefined || header === null || header === undefined || author === null || author === undefined || author.getAttribute('data-user-id') !== comment.author.id || author.getAttribute('data-username') !== comment.author.login) return null;
  const displayName = author.querySelector('[data-testid="author-name"]')?.textContent?.trim();
  const profileUrl = profile(author.getAttribute('href'), doc);
  if (!displayName || profileUrl === null) return null;
  const alias = header.querySelector<HTMLAnchorElement>(':scope > .note-header-info > .author-username > a.author-username-link');
  const username = alias?.textContent?.trim();
  const avatarLink = root.querySelector<HTMLAnchorElement>(':scope > .timeline-entry-inner > .timeline-avatar > a.gl-avatar-link[data-user-id][data-username]');
  const image = avatarLink?.getAttribute('data-user-id') === comment.author.id && avatarLink.getAttribute('data-username') === comment.author.login && profile(avatarLink.getAttribute('href'), doc) === profileUrl ? avatarLink.querySelector<HTMLImageElement>('img.gl-avatar') : null;
  const geometry = image === null || image === undefined ? null : readNativeAuthorAvatarGeometry(image);
  const badges = [...header.querySelectorAll<HTMLElement>(':scope > .note-actions > .gl-badge')].flatMap((badge) => {
    const label = badge.querySelector(':scope > .gl-badge-content')?.textContent?.trim();
    if (!label || badge.closest('[data-geld-ui]') !== null) return [];
    const className = [...badge.classList].filter((name) => name === 'gl-badge' || name === 'badge' || name.startsWith('badge-')).join(' ');
    const title = badge.getAttribute('title');
    return [{ label, className, ...(title === null ? {} : { title }) }];
  });
  return { authorId: comment.author.id, displayName, profileUrl,
    ...(username && profile(alias?.getAttribute('href') ?? null, doc) === profileUrl ? { username } : {}),
    ...(geometry === null ? {} : { avatar: { ...geometry, className: image?.className ?? '' } }), ...(badges.length === 0 ? {} : { badges }),
  };
}
