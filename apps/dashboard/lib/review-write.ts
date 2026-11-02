import type { ProviderClient, ProviderResult, PullRef, ReviewSubmission } from '@geld/domain';
export async function submitProviderReview(input: { readonly client: ProviderClient; readonly ref: PullRef; readonly review: ReviewSubmission; readonly viewer: string | null }): Promise<ProviderResult<string> | { readonly ok: false; readonly reason: 'stale' | 'own_review' }> {
  const current = await input.client.pull(input.ref);
  if (!current.ok) return current;
  if (current.value.headSha !== input.review.headSha) return { ok: false, reason: 'stale' };
  if (input.review.event !== 'comment' && input.viewer?.toLowerCase() === current.value.author.toLowerCase()) return { ok: false, reason: 'own_review' };
  if (!current.value.capabilities.includes(input.review.event === 'comment' ? 'comment' : 'review')) return { ok: false, reason: 'permission', required: 'pull_requests=write', url: current.value.url };
  return input.client.review(input.ref, input.review);
}
