import type { ProviderAdapter } from '../providers/types';
import { BitbucketClient } from './api';
import { describeBitbucketProviderPage } from './page';
import { fetchBitbucketReview } from './review';
import { fetchBitbucketConfig } from './config';
import { bitbucketActionHost, bitbucketDescriptionHost, bitbucketHeaderTargets, bitbucketReviewHost, readBitbucketDiff } from './diff';
import { bitbucketAuthenticated, readBitbucketActions } from './actions';
import { readBitbucketPendingReview } from './pending-review';
import { bitbucketListRows } from './list-surfaces';
import { fetchBitbucketListAuthors } from './list-authors';
import { bitbucketConversationRoots, syncBitbucketNativeReviewState } from './conversation';
import { bitbucketCommentSignature, renderBitbucketComment } from './comment-render';
import { bitbucketThreadActions } from './thread-actions';
import { beginBitbucketAuthorPresentation } from './author-presentation';
import { readBitbucketRequirements } from './requirements';
import { createBitbucketDiffSyntax } from './diff-syntax';
export { createBitbucketDiffSyntax } from './diff-syntax';
import { bitbucketReferenceAnchor, readBitbucketReferences } from './references';
import { createBitbucketWholeTestAdapter } from './whole-test-context';
import { createBitbucketWhitespaceMode } from './whitespace-mode';
import { BitbucketSourceReferences } from './source-reference';


export { BitbucketClient, BitbucketApiError, bitbucketCapabilities } from './api';
export type { BitbucketPullRequest, BitbucketAuthor, BitbucketParticipant, BitbucketComment, BitbucketTask, BitbucketStatus, BitbucketActivity, BitbucketCapabilities } from './api';
export { fetchBitbucketReview } from './review';
export type { BitbucketReviewSnapshot } from './review';

export const bitbucketAdapter: ProviderAdapter = {
  id: 'bitbucket',
  createPageMode: createBitbucketWhitespaceMode,
  createNativeView: (doc, changed) => new BitbucketSourceReferences(doc, changed),
  wholeTests: createBitbucketWholeTestAdapter(),
  describe: describeBitbucketProviderPage,
  readDiff: readBitbucketDiff,
  diffSyntax: createBitbucketDiffSyntax(),
  headerTargets: bitbucketHeaderTargets,
  listRows: bitbucketListRows,
  readReferences: readBitbucketReferences,
  referenceAnchor: bitbucketReferenceAnchor,
  fetchListAuthors: fetchBitbucketListAuthors,
  eagerListDiffs: bitbucketAuthenticated,
  reviewRefreshMs: (doc) => bitbucketAuthenticated(doc) ? 60_000 : 30 * 60_000,
  fetchDiff: (page, signal) => page.kind === 'compare' ? Promise.reject(new Error('Bitbucket comparison diffs are unavailable')) : new BitbucketClient(page).diff(signal),
  reviewHost: bitbucketReviewHost,
  descriptionHost: bitbucketDescriptionHost,
  conversationRoots: bitbucketConversationRoots,
  actionHost: bitbucketActionHost,
  fetchReview: async (page, signal, doc) => {
    const presentation = beginBitbucketAuthorPresentation(doc, page, signal);
    try {
      const snapshot = await fetchBitbucketReview(page, signal);
      return { ...snapshot, get input() { return syncBitbucketNativeReviewState(snapshot.input, doc); }, get actions() { const pending = readBitbucketPendingReview(doc, page, snapshot.input.subject);return [...readBitbucketActions(doc, page), ...(pending === null ? [] : [pending])]; },
        get requirements() { return readBitbucketRequirements(page, doc); },
        renderComment: (comment, host) => renderBitbucketComment(comment, host, doc),
        commentSignature: (comment) => bitbucketCommentSignature(comment, doc),
        sourceActions: (comment) => bitbucketThreadActions(comment, doc),
        authorPresentation: presentation.bind(snapshot),
      };
    } catch (error: unknown) {
      presentation.invalidate();
      throw error;
    }
  },
  fetchConfig: fetchBitbucketConfig,
};
