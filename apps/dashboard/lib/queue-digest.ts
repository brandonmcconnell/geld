import type { ProviderComment, PullRef } from '@geld/domain';
import { isOpenStatus } from '@geld/review/model';
import { REVIEW_BOTS } from '@geld/review/bots';
import { trustedDigests } from './trusted-digest';
import type { QueueDigest } from './queue-insight';

export function queueDigest(ref: PullRef, head: string, comments: readonly ProviderComment[]): QueueDigest | null {
  const meta = trustedDigests(ref.provider, comments)
    .map((summary) => summary.meta)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
  if (!meta) return null;
  if (meta.headSha.toLowerCase() !== head.toLowerCase()) return { state: 'stale' };
  const active = meta.items.filter((item) => isOpenStatus(item.status));
  return {
    state: 'current',
    open: active.length,
    needsReply: active.filter((item) => item.status === 'needs-reply').length,
    approvals: meta.reviewers.filter((reviewer) => reviewer.state === 'approved').length,
    changesRequested: meta.reviewers.filter((reviewer) => reviewer.state === 'changes_requested').length,
    partial: !!meta.truncated,
    bots: meta.bots.map((bot) => {
      const sha = bot.reviewedSha.toLowerCase();
      const current = sha.length >= 7 && (head.toLowerCase().startsWith(sha) || sha.startsWith(head.toLowerCase()));
      return {
        id: bot.id,
        name:
          REVIEW_BOTS.find((item) => item.id === bot.id || item.logins.includes(bot.login))?.title ??
          bot.login.replace(/\[bot\]$/, ''),
        verdict: !current
          ? 'earlier'
          : bot.verdict === 'loading'
            ? 'running'
            : bot.verdict === 'failed' && bot.reason
              ? 'skipped'
              : bot.verdict,
        ...(current && bot.score !== undefined ? { score: bot.score } : {}),
      };
    }),
  };
}
