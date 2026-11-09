import type { ProviderReviewAuthor, ProviderReviewSubject } from '@geld/review';
import { providerReviewUrl } from '@geld/review';

export interface ProviderReviewReference {
  readonly id: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly label: string;
  readonly title: string | null;
  readonly target: {
    readonly provider: ProviderReviewSubject['provider'];
    readonly origin: string;
    readonly repository: string;
    readonly projectId: string;
    readonly nativeId: string;
    readonly number: string;
    readonly kind: 'merge-request' | 'pull-request' | 'issue';
    readonly url: string;
  };
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
      || !reference.label.trim() || [reference.id, reference.target.repository, reference.target.number, reference.target.nativeId, reference.target.projectId].some((value) => !value.trim() || /[\x00-\x1f\x7f]/.test(value))) return false;
    if (reference.direction === 'incoming' && (reference.source.eventId === undefined || !reference.source.eventId.trim() || /[\x00-\x1f\x7f]/.test(reference.source.eventId)
      || reference.source.anchor === null || !reference.source.anchor || /[#\x00-\x20\x7f]/.test(reference.source.anchor))) return false;
    if (reference.direction === 'outgoing' && (reference.source.anchor !== null || reference.source.eventId !== undefined)) return false;
    const url = new URL(reference.target.url);
    return url.origin === subject.origin && url.username === '' && url.password === '' && ['http:', 'https:'].includes(url.protocol);
  } catch { return false; }
}
