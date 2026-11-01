import { describeRepository } from '@geld/core';
import type { ProviderReviewPage } from '../providers/types';

export function describeBitbucketPage(url: URL): ProviderReviewPage | null {
  const repository = describeRepository(url);
  if (repository?.provider !== 'bitbucket' || repository.origin !== 'https://bitbucket.org') return null;
  const match = /^\/[^/]+\/[^/]+\/pull-requests\/([1-9]\d*)(?:\/(diff|commits|activity))?\/?$/.exec(url.pathname);
  const number = match?.[1];
  if (number === undefined) return null;
  const tab = match?.[2];
  const pageUrl = `${repository.origin}/${repository.path}/pull-requests/${number}`;
  const apiPath = repository.path.split('/').map(encodeURIComponent).join('/');
  return {
    provider: 'bitbucket',
    repository,
    number,
    url: pageUrl,
    diffPageUrl: `${pageUrl}/diff`,
    diffUrl: `https://api.bitbucket.org/2.0/repositories/${apiPath}/pullrequests/${number}/diff`,
    kind: tab === 'diff' ? 'diff' : tab === undefined ? 'overview' : 'other',
    headSha: null,
    version: 'current',
  };
}
