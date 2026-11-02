import type { ProviderComment, Provider } from '@geld/domain';
import { looksLikeSummaryBody, parseSummaryBody } from '@geld/review/summary-parse';

export function trustedDigests(
  provider: Provider,
  comments: readonly Pick<ProviderComment, 'id' | 'author' | 'body'>[],
) {
  if (provider !== 'github') return [];
  return comments.flatMap((comment) => {
    if (
      !['github-actions[bot]', 'geld[bot]'].includes(comment.author.toLowerCase()) ||
      !looksLikeSummaryBody(comment.body)
    )
      return [];
    const parsed = parseSummaryBody(comment.body);
    return parsed.ok ? [{ id: comment.id, meta: parsed.value }] : [];
  });
}
