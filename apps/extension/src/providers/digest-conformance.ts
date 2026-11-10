import { digestDocumentIssues, digestFromProvider, type DigestDocument, type DigestSubject, type ProviderDigestParts } from '@geld/review';
import type { ProviderReviewPanelEvent, ProviderReviewRequirement } from './review-panel';
import type { ProviderReviewSnapshot } from './types';

/** What every host's review reader hands the digest, whatever else it carries. */
export interface ProviderDigestSource {
  readonly input: ProviderReviewSnapshot['input'];
  readonly comments: ProviderReviewSnapshot['comments'];
  readonly events: readonly ProviderReviewPanelEvent[];
  readonly complete: boolean;
  readonly unavailable: readonly { readonly area: string; readonly reason: string }[];
  readonly approvalsRequired: number | null;
  readonly approvalsLeft: number | null;
  readonly requirements?: readonly ProviderReviewRequirement[] | null;
  readonly sourceCoverage?: ProviderReviewSnapshot['sourceCoverage'];
}

export type DigestReading = { readonly document: DigestDocument; readonly issues: readonly string[] } | { readonly document: null; readonly issues: readonly string[] };

function sameOrigin(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.origin === origin;
  } catch {
    return false;
  }
}

/** Builds the shared document from a host's snapshot and lists every way the snapshot breaks the adapter contract. */
export function readProviderDigest(source: ProviderDigestSource, state?: DigestSubject['state']): DigestReading {
  const contract: string[] = [];
  const origin = source.input.subject.origin;
  const commentUrls = [...source.comments, ...source.input.threads.flatMap((thread) => thread.comments)];
  for (const comment of commentUrls) if (!sameOrigin(comment.url, origin)) contract.push(`comment ${comment.id} links off the review host`);
  const eventIds = new Set<string>();
  for (const event of source.events) {
    if (eventIds.has(event.id)) contract.push(`event ${event.id} is listed twice`);
    eventIds.add(event.id);
    if (!sameOrigin(event.url, origin)) contract.push(`event ${event.id} links off the review host`);
  }
  const parts: ProviderDigestParts = {
    input: source.input,
    events: source.events,
    approvalsRequired: source.approvalsRequired,
    approvalsLeft: source.approvalsLeft,
    requirements: source.requirements ?? null,
    unavailable: source.unavailable,
    ...(state === undefined ? {} : { state }),
    ...(source.sourceCoverage === undefined ? {} : { sourceCoverage: source.sourceCoverage }),
  };
  let document: DigestDocument;
  try {
    document = digestFromProvider(parts);
  } catch (error) {
    return { document: null, issues: [...contract, `the document does not validate: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const issues = [...contract, ...digestDocumentIssues(document)];
  return { document, issues };
}
