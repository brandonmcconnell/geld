import type { ProviderReviewComment } from '@geld/review';
import type { ProviderReviewAuthorPresentation } from '../providers/review-panel';
import type { ProviderReviewPage } from '../providers/types';
import { nativeBitbucketComment } from './conversation';
import { readNativeAuthorAvatarGeometry } from '../providers/author-geometry';
import { bitbucketAuthorSubjectKey, bitbucketCommentIdentity } from './author-name';
import { describeBitbucketPage } from './page';
import type { BitbucketReviewSnapshot } from './review';

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

const visits = new WeakMap<Document, object>();

export function beginBitbucketAuthorPresentation(doc: Document, page: ProviderReviewPage, signal: AbortSignal): {
  invalidate(): void;
  bind(snapshot: BitbucketReviewSnapshot): (comment: ProviderReviewComment) => ProviderReviewAuthorPresentation | null;
} {
  const visit = new URL(doc.URL);
  visit.hash = '';
  const generation = {};
  visits.set(doc, generation);
  const invalidate = (): void => {
    if (visits.get(doc) === generation) visits.delete(doc);
  };
  if (signal.aborted) invalidate();
  return {
    invalidate,
    bind: (snapshot) => {
      const subject = { ...snapshot.input.subject };
      const key = bitbucketAuthorSubjectKey(subject);
      const apiPresentation = snapshot.apiAuthorPresentation;
      const members = new Map<string, string | null>();
      for (const comment of [...snapshot.input.threads.flatMap((thread) => thread.comments), ...snapshot.comments]) {
        members.set(comment.id, members.has(comment.id) ? null : bitbucketCommentIdentity(comment));
      }
      return (comment) => {
        const current = describeBitbucketPage(new URL(doc.URL));
        const location = new URL(doc.URL);
        location.hash = '';
        if (signal.aborted || visits.get(doc) !== generation || page.provider !== 'bitbucket' || subject.provider !== 'bitbucket'
          || key === null || bitbucketAuthorSubjectKey(snapshot.input.subject) !== key || location.href !== visit.href
          || current === null || current.kind !== 'overview' || current.url !== page.url || current.version !== page.version
          || page.repository.origin !== subject.origin || page.repository.path !== subject.repository || page.number !== subject.id
          || current.repository.origin !== subject.origin || current.repository.path !== subject.repository || current.number !== subject.id
          || page.headSha !== null && page.headSha !== subject.headSha || current.headSha !== null && current.headSha !== subject.headSha
          || members.get(comment.id) !== bitbucketCommentIdentity(comment) || !/^comment-[1-9]\d*$/.test(comment.anchor)) return null;
        if (doc.getElementById(comment.anchor) === null) return apiPresentation?.(comment, subject) ?? null;
        const roots = [...doc.querySelectorAll<HTMLElement>(`[id="${comment.anchor}"]`)]
          .filter((root) => root.closest('[data-geld-ui]') === null);
        if (roots.length > 1) return null;
        if (roots.length === 1) return bitbucketAuthorPresentation(comment, doc);
        return apiPresentation?.(comment, subject) ?? null;
      };
    },
  };
}
