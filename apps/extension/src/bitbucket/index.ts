import type { ProviderAdapter } from '../providers/types';
import { BitbucketClient } from './api';
import { describeBitbucketProviderPage } from './page';
import { fetchBitbucketReview } from './review';
import { fetchBitbucketConfig } from './config';
import { bitbucketActionHost, bitbucketDescriptionHost, bitbucketHeaderTargets, bitbucketReviewHost, readBitbucketDiff } from './diff';
import { readBitbucketActions } from './actions';

export { BitbucketClient, BitbucketApiError, bitbucketCapabilities } from './api';
export type { BitbucketPullRequest, BitbucketAuthor, BitbucketParticipant, BitbucketComment, BitbucketTask, BitbucketStatus, BitbucketActivity, BitbucketCapabilities } from './api';
export { fetchBitbucketReview } from './review';
export type { BitbucketReviewSnapshot } from './review';

export const bitbucketAdapter: ProviderAdapter = {
  id: 'bitbucket',
  describe: describeBitbucketProviderPage,
  readDiff: readBitbucketDiff,
  headerTargets: bitbucketHeaderTargets,
  listRows: () => [],
  fetchDiff: (page, signal) => page.kind === 'compare' ? Promise.reject(new Error('Bitbucket comparison diffs are unavailable')) : new BitbucketClient(page).diff(signal),
  reviewHost: bitbucketReviewHost,
  descriptionHost: bitbucketDescriptionHost,
  actionHost: bitbucketActionHost,
  fetchReview: async (page, signal, doc) => ({ ...await fetchBitbucketReview(page, signal), actions: readBitbucketActions(doc) }),
  fetchConfig: fetchBitbucketConfig,
};
