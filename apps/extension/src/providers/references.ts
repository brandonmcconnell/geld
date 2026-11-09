import type { ProviderReviewAuthor, ProviderReviewComment, ProviderReviewSubject } from '@geld/review';
import { providerReviewUrl } from '@geld/review';
import { describeRepository } from '@geld/core';

interface ReferenceTarget {
  readonly origin: string;
  readonly repository: string;
  readonly number: string;
  readonly url: string;
}

export interface GitLabReferenceTarget extends ReferenceTarget {
  readonly provider: 'gitlab';
  readonly projectId: string;
  readonly nativeId: string;
  readonly kind: 'merge-request' | 'issue';
}

export interface BitbucketReferenceTarget extends ReferenceTarget {
  readonly provider: 'bitbucket';
  readonly identityBasis: 'canonical-url';
  readonly kind: 'pull-request';
}

export interface ProviderReviewReference {
  readonly id: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly label: string;
  readonly title: string | null;
  readonly target: GitLabReferenceTarget | BitbucketReferenceTarget;
  readonly source: {
    readonly reviewUrl: string;
    readonly anchor: string | null;
    readonly eventId?: string;
    readonly author?: ProviderReviewAuthor;
    readonly createdAt?: string;
  };
}

export function referenceForSubject(reference: ProviderReviewReference, subject: ProviderReviewSubject): boolean {
  try {
    if (reference.target.provider !== subject.provider || reference.target.origin !== subject.origin || reference.source.reviewUrl !== providerReviewUrl(subject)
      || !reference.label.trim() || [reference.id, reference.target.repository, reference.target.number].some((value) => !value.trim() || /[\x00-\x1f\x7f]/.test(value))) return false;
    if (reference.target.provider === 'gitlab' && [reference.target.nativeId, reference.target.projectId].some((value) => !value.trim() || /[\x00-\x1f\x7f]/.test(value))) return false;
    if (reference.direction === 'incoming' && (reference.source.eventId === undefined || !reference.source.eventId.trim() || /[\x00-\x1f\x7f]/.test(reference.source.eventId)
      || reference.source.anchor === null || !reference.source.anchor || /[#\x00-\x20\x7f]/.test(reference.source.anchor))) return false;
    if (reference.direction === 'outgoing') {
      if (reference.source.eventId !== undefined) return false;
      if (reference.source.anchor !== null && (!nativeCommentAnchor(reference.source.anchor, subject.provider) || reference.source.author === undefined
        || reference.source.author.id.trim() === '' || reference.source.author.login.trim() === '' || !Number.isFinite(Date.parse(reference.source.createdAt ?? '')))) return false;
    }
    const url = new URL(reference.target.url);
    if (url.origin !== subject.origin || url.username !== '' || url.password !== '' || !['http:', 'https:'].includes(url.protocol)) return false;
    if (reference.target.provider === 'bitbucket') {
      const repository = describeRepository(url);
      return reference.direction === 'outgoing' && reference.target.identityBasis === 'canonical-url' && reference.target.kind === 'pull-request'
        && !('projectId' in reference.target) && !('nativeId' in reference.target) && reference.target.url === url.href
        && url.origin === 'https://bitbucket.org' && repository?.provider === 'bitbucket' && repository.path === reference.target.repository
        && /^[1-9]\d*$/.test(reference.target.number) && url.href === `${url.origin}/${repository.path.split('/').map(encodeURIComponent).join('/')}/pull-requests/${reference.target.number}`;
    }
    return true;
  } catch { return false; }
}


function nativeCommentAnchor(anchor: string, provider: ProviderReviewSubject['provider']): boolean {
  return provider === 'gitlab' ? /^note_[1-9]\d*$/.test(anchor) : provider === 'bitbucket' ? /^comment-[1-9]\d*$/.test(anchor) : false;
}

export function referenceSourceComments(comments: readonly ProviderReviewComment[], provider: ProviderReviewSubject['provider'], reviewUrl: string): readonly ProviderReviewComment[] {
  const found = new Map<string, ProviderReviewComment | null>();
  for (const comment of comments) {
    if (!nativeCommentAnchor(comment.anchor, provider) || comment.url !== `${reviewUrl}#${comment.anchor}` || !Number.isFinite(Date.parse(comment.createdAt))
      || comment.author.id.trim() === '' || comment.author.login.trim() === '') continue;
    const previous = found.get(comment.anchor);
    if (found.has(comment.anchor) && JSON.stringify(previous) !== JSON.stringify(comment)) found.set(comment.anchor, null);
    else found.set(comment.anchor, comment);
  }
  return [...found.values()].filter((comment): comment is ProviderReviewComment => comment !== null).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.anchor.localeCompare(b.anchor));
}
