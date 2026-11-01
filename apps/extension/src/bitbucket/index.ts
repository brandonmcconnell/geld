import { isProviderReviewPage } from '../providers/types';
import type { ProviderAdapter } from '../providers/types';
import { BitbucketClient } from './api';
import { describeBitbucketPage } from './page';
import { fetchBitbucketReview } from './review';
import { fetchBitbucketConfig } from './config';

export { BitbucketClient, BitbucketApiError, bitbucketCapabilities } from './api';
export type { BitbucketPullRequest, BitbucketAuthor, BitbucketParticipant, BitbucketComment, BitbucketTask, BitbucketStatus, BitbucketActivity, BitbucketCapabilities } from './api';
export { fetchBitbucketReview } from './review';
export type { BitbucketReviewSnapshot } from './review';

export const bitbucketAdapter: ProviderAdapter = {
  id: 'bitbucket',
  describe: describeBitbucketPage,
  // These surfaces require a hydrated public PR fixture before their selectors can be implemented.
  readDiff: () => null,
  headerTargets: () => [],
  listRows: () => [],
  fetchDiff: (page, signal) => isProviderReviewPage(page) ? new BitbucketClient(page).diff(signal) : Promise.reject(new Error('Bitbucket standalone diffs are unavailable')),
  fetchReview: (page, signal) => fetchBitbucketReview(page, signal),
  fetchConfig: fetchBitbucketConfig,
};
