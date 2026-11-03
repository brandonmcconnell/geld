import type { ProviderAdapter } from '../providers/types';
import { BitbucketClient } from './api';
import { describeBitbucketProviderPage } from './page';
import { fetchBitbucketReview } from './review';
import { fetchBitbucketConfig } from './config';
import { bitbucketActionHost, bitbucketDescriptionHost, bitbucketHeaderTargets, bitbucketReviewHost, readBitbucketDiff } from './diff';
import { readBitbucketActions } from './actions';
import { bitbucketListRows } from './list-surfaces';
import { bitbucketConversationRoots, syncBitbucketNativeReviewState } from './conversation';
import { renderBitbucketComment } from './comment-render';
import { bitbucketThreadActions } from './thread-actions';

export { BitbucketClient, BitbucketApiError, bitbucketCapabilities } from './api';
export type { BitbucketPullRequest, BitbucketAuthor, BitbucketParticipant, BitbucketComment, BitbucketTask, BitbucketStatus, BitbucketActivity, BitbucketCapabilities } from './api';
export { fetchBitbucketReview } from './review';
export type { BitbucketReviewSnapshot } from './review';

export const bitbucketAdapter: ProviderAdapter = {
  id: 'bitbucket',
  describe: describeBitbucketProviderPage,
  readDiff: readBitbucketDiff,
  headerTargets: bitbucketHeaderTargets,
  listRows: bitbucketListRows,
  fetchDiff: (page, signal) => page.kind === 'compare' ? Promise.reject(new Error('Bitbucket comparison diffs are unavailable')) : new BitbucketClient(page).diff(signal),
  reviewHost: bitbucketReviewHost,
  descriptionHost: bitbucketDescriptionHost,
  conversationRoots: bitbucketConversationRoots,
  actionHost: bitbucketActionHost,
  fetchReview: async (page, signal, doc) => {
    const snapshot = await fetchBitbucketReview(page, signal);
    return { ...snapshot, get input() { return syncBitbucketNativeReviewState(snapshot.input, doc); }, actions: readBitbucketActions(doc),
      renderComment: (comment, host) => renderBitbucketComment(comment, host, doc),
      sourceActions: (comment) => bitbucketThreadActions(comment, doc),
    };
  },
  fetchConfig: fetchBitbucketConfig,
};
