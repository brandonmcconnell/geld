import type { ProviderReviewComment } from '@geld/review';
import type { ProviderReviewAuthorPresentation } from '../providers/review-panel';
import { nativeBitbucketComment } from './conversation';
import { readNativeAuthorAvatarGeometry } from '../providers/author-geometry';

export function bitbucketAuthorPresentation(comment: ProviderReviewComment, doc: Document): ProviderReviewAuthorPresentation | null {
  const root = nativeBitbucketComment(comment, doc);
  if (root === null || comment.author.id.trim() === '') return null;
  const name = root.querySelector<HTMLElement>('[data-testid="comment-header"] > span:first-child');
  const displayName = name?.textContent?.trim();
  if (!displayName || name?.closest('[data-testid="comment-content"], [data-geld-ui]') !== null) return null;
  const avatarOwner = root.querySelector<HTMLElement>(':scope > div:first-child [role="img"][aria-labelledby]');
  const labels = (avatarOwner?.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  const label = labels.map((id) => [...root.querySelectorAll('[id]')].find((element) => element.id === id)?.textContent?.trim() ?? '').join(' ');
  const image = label === displayName ? avatarOwner?.querySelector<HTMLImageElement>('img[data-vc="avatar-image"]') : null;
  const geometry = image === null || image === undefined ? null : readNativeAuthorAvatarGeometry(image);
  return { authorId: comment.author.id, displayName, ...(geometry === null ? {} : { avatar: { ...geometry, className: image?.className ?? '' } }) };
}
