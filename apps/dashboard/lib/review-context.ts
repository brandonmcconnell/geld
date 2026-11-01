import 'server-only';
import { createMatcher, parseUnifiedDiffHunks } from '@geld/core';
import type {
  ProviderClient,
  ProviderComment,
  ProviderThread,
  ProviderResult,
  PullDetail,
  PullRef,
} from '@geld/domain';
import type { PlanFile } from '@geld/review/plan';
import type { TokenSource } from '@geld/github';
import { providerClient } from './providers';
import { reviewSettings } from './review-settings';
export interface ReviewContext { readonly pull: PullDetail; readonly files: readonly PlanFile[]; readonly comments: readonly ProviderComment[]; readonly commentsUnavailable: boolean; readonly settingsWarning: string | null; readonly aiAllowed: boolean; readonly threads: readonly ProviderThread[]; readonly threadsUnavailable: boolean }
export async function reviewContext(ref: PullRef, background?: {readonly client:ProviderClient;readonly source:TokenSource;readonly userId:string;readonly organisationSource?:TokenSource;readonly organisationComplete?:boolean}): Promise<ProviderResult<ReviewContext> | { readonly ok: false; readonly reason: 'stale' }> {
  const client = background?.client ?? await providerClient(ref.provider, ref.host, ref.owner);
  const pull = await client.pull(ref);
  if (!pull.ok) return pull;
  const [diff, comments, threads] = await Promise.all([client.diff(ref), client.comments(ref), client.threads(ref)]);
  if (!diff.ok) return diff;
  const current = await client.pull(ref);
  if (!current.ok) return current;
  if (current.value.headSha !== pull.value.headSha) return { ok: false, reason: 'stale' };
  const settings = await reviewSettings(ref, background);
  const matcher = createMatcher(settings.settings, `${ref.owner}/${ref.repo}`);
  const files = parseUnifiedDiffHunks(diff.value).map((file) => ({
    ...file,
    hidden: matcher.categorizeFile(file) !== null,
  }));
  return {
    ok: true,
    value: {
      pull: pull.value,
      files,
      comments: comments.ok ? comments.value : [],
      commentsUnavailable: !comments.ok,
      settingsWarning: settings.warning,
      aiAllowed: settings.aiAllowed,
      threads: threads.ok ? threads.value : [],
      threadsUnavailable: !threads.ok,
    },
  };
}
