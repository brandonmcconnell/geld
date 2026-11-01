import type { ProviderReviewAuthor, ProviderReviewSubject } from '@geld/review';
import { providerReviewUrl } from '@geld/review';

export interface ProviderReviewReference {
  readonly id: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly label: string;
  readonly title: string | null;
  readonly target: {
    readonly provider: 'gitlab';
    readonly origin: string;
    readonly repository: string;
    readonly projectId: string;
    readonly nativeId: string;
    readonly number: string;
    readonly kind: 'merge-request' | 'issue';
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
  if (reference.target.provider !== subject.provider || reference.target.origin !== subject.origin || reference.source.reviewUrl !== providerReviewUrl(subject)
    || !reference.label.trim() || !/^[1-9]\d*$/.test(reference.target.number) || !/^[1-9]\d*$/.test(reference.target.nativeId) || !/^[1-9]\d*$/.test(reference.target.projectId)) return false;
  if (reference.direction === 'incoming' && (reference.source.eventId === undefined || !/^[1-9]\d*$/.test(reference.source.eventId) || reference.source.anchor !== `note_${reference.source.eventId}`)) return false;
  if (reference.direction === 'outgoing' && (reference.source.anchor !== null || reference.source.eventId !== undefined)) return false;
  try {
    const url = new URL(reference.target.url);
    if (url.origin !== subject.origin || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || !['http:', 'https:'].includes(url.protocol)) return false;
    const path = decodeURIComponent(url.pathname);
    const root = `/${reference.target.repository}/-/`;
    return reference.target.kind === 'merge-request' ? path === `${root}merge_requests/${reference.target.number}`
      : path === `${root}work_items/${reference.target.number}` || path === `${root}issues/${reference.target.number}`;
  } catch { return false; }
}
