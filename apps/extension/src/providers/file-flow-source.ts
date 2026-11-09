import { repositoryKey } from '@geld/core';
import { parseProviderDiffSourceFacts, providerSourceSubject, providerSourceSubjectKey } from './source-facts';
import type { ProviderNewFileRevision } from './source-facts';
import type { ProviderDiffResult, ProviderReviewPage } from './types';

export function providerFlowRevision(page: ProviderReviewPage, result: ProviderDiffResult, path: string): ProviderNewFileRevision | null {
  const facts = parseProviderDiffSourceFacts(result.sourceFacts);
  if (facts === null || providerSourceSubjectKey(facts.subject) !== providerSourceSubjectKey(providerSourceSubject(page))) return null;
  const file = result.files.find((file) => file.path === path);
  if (file === undefined || file.status === 'deleted') return null;
  const target = facts.newPaths.find((entry) => entry.path === path);
  if (target === undefined) return null;
  const comparison = facts.comparison;
  if (comparison.kind !== 'gitlab-review' && comparison.kind !== 'bitbucket-review') return null;
  if (comparison.kind === 'gitlab-review' && comparison.projectPath !== page.repository.path) return null;
  if (comparison.kind === 'bitbucket-review' && comparison.sourceRepository === null) return null;
  const repository = { ...page.repository, path: comparison.kind === 'bitbucket-review' ? comparison.sourceRepository! : page.repository.path };
  return { repository, path: target.newPath, headSha: comparison.headSha, key: JSON.stringify([repositoryKey(repository), comparison.headSha, target.newPath]) };
}
