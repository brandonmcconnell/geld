import { describeRepository } from '@geld/core';
import type { ProviderCommitPage, ProviderPage, ProviderReviewPage } from '../providers/types';

export function describeBitbucketPage(url: URL): ProviderReviewPage | null {
  const repository = describeRepository(url);
  if (repository?.provider !== 'bitbucket' || repository.origin !== 'https://bitbucket.org') return null;
  const match = /^\/[^/]+\/[^/]+\/pull-requests\/([1-9]\d*)(?:\/(diff|commits|activity)|\/_\/(diff|overview))?\/?$/.exec(url.pathname);
  const number = match?.[1];
  if (number === undefined) return null;
  const tab = match?.[2] ?? match?.[3];
  const pageUrl = `${repository.origin}/${repository.path}/pull-requests/${number}`;
  const apiPath = repository.path.split('/').map(encodeURIComponent).join('/');
  return {
    provider: 'bitbucket',
    repository,
    number,
    url: pageUrl,
    diffPageUrl: `${pageUrl}/diff`,
    diffUrl: `https://api.bitbucket.org/2.0/repositories/${apiPath}/pullrequests/${number}/diff`,
    kind: tab === 'diff' ? 'diff' : tab === undefined || tab === 'overview' ? 'overview' : 'other',
    headSha: null,
    version: 'current',
  };
}

export function describeBitbucketCommitPage(url: URL): ProviderCommitPage | null {
  const repository = describeRepository(url);
  const match = /^\/[^/]+\/[^/]+\/commits\/([a-f0-9]{7,64})\/?$/i.exec(url.pathname);
  const ref = match?.[1]?.toLowerCase();
  if (repository?.provider !== 'bitbucket' || repository.origin !== 'https://bitbucket.org' || ref === undefined || (ref.length > 40 && ref.length !== 64)) return null;
  const root = `${repository.origin}/${repository.path.split('/').map(encodeURIComponent).join('/')}`;
  const canonical = `${root}/commits/${ref}`;
  return { provider: 'bitbucket', repository, kind: 'commit', ref, url: canonical, diffPageUrl: canonical, diffUrl: `https://api.bitbucket.org/2.0/repositories/${repository.path.split('/').map(encodeURIComponent).join('/')}/diff/${ref}`, headSha: ref.length === 40 || ref.length === 64 ? ref : null, version: `commit:${ref}` };
}

export function describeBitbucketProviderPage(url: URL): ProviderPage | null {
  return describeBitbucketPage(url) ?? describeBitbucketCommitPage(url);
}
