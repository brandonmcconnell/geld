import { normalizeReviewAccountId, repositoryKey, withTrustedSummaryPublisher } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import { providerReviewKey, sourceLink } from '@geld/review';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { isProviderReviewPage } from './types';
import type { ProviderPage, ProviderReviewSnapshot } from './types';

export interface ProviderPublisherTrustEnvironment {
  readonly page: () => ProviderPage | null;
  readonly snapshot: () => ProviderReviewSnapshot | null;
  readonly retired: () => boolean;
  readonly updated: (settings: GeldSettings) => void;
  readonly settings: {
    update(edit: (current: GeldSettings) => Partial<GeldSettings>): Promise<GeldSettings>;
  };
  /** Strict native frame, scope and source eligibility only. This does not authorize the publisher. */
  readonly eligible: (input: ProviderReviewInput, comment: ProviderReviewComment) => boolean;
}

export type SaveTrustedPublisher = (input: ProviderReviewInput, candidate: ProviderReviewComment) => Promise<void>;

function sourceSignature(comment: ProviderReviewComment): string {
  return JSON.stringify([comment.id, comment.anchor, comment.url, comment.author.id, comment.author.login, comment.body, comment.createdAt, comment.updatedAt ?? null]);
}

export function createProviderPublisherTrust(environment: ProviderPublisherTrustEnvironment): SaveTrustedPublisher {
  return async (input, candidate) => {
    const reviewKey = providerReviewKey(input.subject);
    const headSha = input.subject.headSha;
    const signature = sourceSignature(candidate);
    const verifiedAccount = (): { readonly page: ProviderPage; readonly comment: ProviderReviewComment } => {
      const page = environment.page();
      const snapshot = environment.snapshot();
      if (environment.retired() || page === null || !isProviderReviewPage(page) || snapshot === null
        || providerReviewKey(input.subject) !== reviewKey || input.subject.headSha !== headSha
        || providerReviewKey(snapshot.input.subject) !== reviewKey || snapshot.input.subject.headSha !== headSha
        || page.provider !== input.subject.provider || page.number !== input.subject.id
        || repositoryKey(page.repository) !== repositoryKey({ provider: input.subject.provider, origin: input.subject.origin, path: input.subject.repository })
        || page.repository.origin !== input.subject.origin || (page.headSha !== null && page.headSha !== headSha)) throw new Error('This review changed. Reload its conversation before trusting a publisher.');
      const matches = [...snapshot.comments, ...snapshot.input.threads.flatMap((thread) => thread.comments)]
        .filter((comment) => comment.id === candidate.id && comment.anchor === candidate.anchor);
      const comment = matches[0];
      if (comment === undefined || matches.some((source) => sourceSignature(source) !== signature)
        || !/^[1-9]\d*$/.test(comment.id)
        || (page.provider === 'gitlab' ? comment.anchor !== `note_${comment.id}` : page.provider !== 'bitbucket' || (comment.anchor !== `comment-${comment.id}` && comment.anchor !== `comment_${comment.id}`))
        || normalizeReviewAccountId(page.provider, comment.author.id) === null
        || sourceLink({ anchor: comment.anchor, url: comment.url, kind: 'comment', author: comment.author.login }, snapshot.input.subject) === null
        || !environment.eligible(snapshot.input, comment)) throw new Error('Choose an unchanged native Geld summary with a durable publisher id.');
      return { page, comment };
    };
    verifiedAccount();
    const settings = await environment.settings.update((current) => {
      // A settings edit may wait in the shared queue while the review or source changes.
      const { page, comment } = verifiedAccount();
      return { trustedSummaryPublishers: withTrustedSummaryPublisher(current.trustedSummaryPublishers, page.repository, comment.author.id) };
    });
    if (!environment.retired()) environment.updated(settings);
  };
}
