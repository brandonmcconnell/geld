import type { ProviderAdapter } from '../providers/types';
import { BitbucketClient } from './api';
import { describeBitbucketProviderPage } from './page';
import { fetchBitbucketReview } from './review';
import { fetchBitbucketConfig } from './config';
import { bitbucketActionHost, bitbucketDescriptionHost, bitbucketHeaderTargets, bitbucketReviewHost, readBitbucketDiff } from './diff';
import { bitbucketAuthenticated, readBitbucketActions } from './actions';
import { bitbucketListRows } from './list-surfaces';
import { fetchBitbucketListAuthors } from './list-authors';
import { bitbucketConversationRoots, syncBitbucketNativeReviewState } from './conversation';
import { renderBitbucketComment } from './comment-render';
import { bitbucketThreadActions } from './thread-actions';
import { bitbucketAuthorPresentation } from './author-presentation';
import { readBitbucketRequirements } from './requirements';
import { applyBitbucketWorkflowSyntax, removeBitbucketWorkflowSyntax } from './workflow-syntax';
import { bitbucketReferenceAnchor, readBitbucketReferences } from './references';

export { BitbucketClient, BitbucketApiError, bitbucketCapabilities } from './api';
export type { BitbucketPullRequest, BitbucketAuthor, BitbucketParticipant, BitbucketComment, BitbucketTask, BitbucketStatus, BitbucketActivity, BitbucketCapabilities } from './api';
export { fetchBitbucketReview } from './review';
export type { BitbucketReviewSnapshot } from './review';

export const bitbucketAdapter: ProviderAdapter = {
  id: 'bitbucket',
  describe: describeBitbucketProviderPage,
  readDiff: readBitbucketDiff,
  diffSyntax: { apply: (view) => applyBitbucketWorkflowSyntax(view.entries), clear: removeBitbucketWorkflowSyntax },
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
    const snapshot = await fetchBitbucketReview(page, signal);
    return { ...snapshot, get input() { return syncBitbucketNativeReviewState(snapshot.input, doc); }, get actions() { return readBitbucketActions(doc, page); },
      get requirements() { return readBitbucketRequirements(page, doc); },
      renderComment: (comment, host) => renderBitbucketComment(comment, host, doc),
      sourceActions: (comment) => bitbucketThreadActions(comment, doc),
      authorPresentation: (comment) => bitbucketAuthorPresentation(comment, doc),
    };
  },
  fetchConfig: fetchBitbucketConfig,
};
