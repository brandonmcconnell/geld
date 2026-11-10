'use client';
import Link from 'next/link';
import { useDashboard } from '@/lib/dashboard-context';
import { Check, Flag, RefreshCw } from './icons';
import { useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import type { PullSummary } from '@geld/domain';
import { pullPath } from '@geld/domain';
import { hiddenFilesLabel, queueInsightSchema } from '@/lib/queue-insight';
import type { QueueDigest, QueueInsight } from '@/lib/queue-insight';
export function useQueueInsights(pulls: readonly PullSummary[], scope: string) {
  const { cache } = useDashboard();
  const requestKey = JSON.stringify(
    pulls.map((pull) => ({ ref: pull.ref, headSha: pull.headSha, updatedAt: pull.updatedAt })),
  );
  const key = `${scope}:${requestKey}`;
  const [state, setState] = useState<{ key: string; values: Readonly<Record<string, QueueInsight | null>> }>({
    key: '',
    values: {},
  });
  useEffect(() => {
    const abort = new AbortController();
    let index = 0;
    const refs = pulls;
    async function worker() {
      while (!abort.signal.aborted && index < refs.length) {
        const pull = refs[index++];
        if (!pull) return;
        const path = pullPath(pull.ref);
        const itemKey = `${scope}:${path}:${pull.headSha}:${pull.updatedAt}`;
        const cached = cache?.insights.get(itemKey);
        let insight: QueueInsight | null = cached ?? null;
        if (cached) continue;
        try {
          const query = new URLSearchParams({ ...pull.ref, number: String(pull.ref.number) });
          const response = await fetch(`/api/queue/insight?${query}`, {
            signal: abort.signal,
            cache: 'no-store',
          });
          const parsed = queueInsightSchema.safeParse(await response.json());
          if (response.ok && parsed.success && parsed.data.headSha === pull.headSha) {
            insight = parsed.data;
            cache?.insights.set(itemKey, insight);
          }
        } catch {}
        if (!abort.signal.aborted)
          setState((previous) => ({
            key,
            values: { ...(previous.key === key ? previous.values : {}), [path]: insight },
          }));
      }
    }
    void Promise.all([worker(), worker(), worker()]);
    return () => abort.abort();
    // The serialized key includes the reference, head and account scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return Object.fromEntries(
    pulls.map((pull) => {
      const path = pullPath(pull.ref);
      return [
        path,
        cache?.insights.get(`${scope}:${path}:${pull.headSha}:${pull.updatedAt}`) ??
          (state.key === key ? state.values[path] : undefined),
      ];
    }),
  );
}
export function ChangeCounts({ insight }: { readonly insight: QueueInsight | null | undefined }) {
  if (!insight)
    return (
      <span
        className="change-count-placeholder"
        title={insight === null ? 'Change counts could not be loaded' : 'Loading change counts'}
      >
        {insight === null ? 'Counts unavailable' : 'Counting changes…'}
      </span>
    );
  return (
    <div className="queue-change-counts">
      {insight.hidden.files > 0 && (
        <Popover.Root>
          <Popover.Trigger className="hidden-count" aria-label={`Hidden files: ${hiddenFilesLabel(insight)}`}>
            {hiddenFilesLabel(insight)}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={6} className="popover-positioner">
              <Popover.Popup className="counts-popover">
                <Popover.Title>Hidden from your review</Popover.Title>
                <dl>
                  {insight.categories.map((category) => (
                    <div key={category.id}>
                      <dt>{category.label}</dt>
                      <dd>
                        {category.files}{' '}
                        <span className="muted">{category.files === 1 ? 'file' : 'files'}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="muted">Available in Diff whenever you need them.</p>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
      <span className="diffstat">
        <span>+{insight.essential.additions}</span>
        <span>−{insight.essential.deletions}</span>
      </span>
    </div>
  );
}

export function QueueDigestSummary({
  digest,
  href,
}: {
  readonly digest: QueueDigest | null | undefined;
  readonly href: string;
}) {
  if (!digest) return null;
  if (digest.state === 'stale')
    return (
      <Link className="queue-digest-link" href={href}>
        <RefreshCw size={12} />
        Digest outdated
      </Link>
    );
  const bots = [...digest.bots].sort((a, b) => {
    const rank = { failed: 0, findings: 1, running: 2, earlier: 3, skipped: 4, unknown: 5, clean: 6 };
    return rank[a.verdict] - rank[b.verdict];
  });
  if (!digest.open && !digest.approvals && !digest.changesRequested && !bots.length) return null;
  const prefix = digest.partial ? '≥' : '';
  return (
    <span className="queue-digest-summary" role="group" aria-label="Review digest">
      {digest.open > 0 && (
        <Link href={href} className="queue-digest-link" data-tone="attention">
          <Flag size={12} />
          {prefix}
          {digest.open} open{digest.needsReply > 0 ? ` · ${prefix}${digest.needsReply} needs reply` : ''}
        </Link>
      )}
      {digest.changesRequested > 0 ? (
        <Link href={href} className="queue-digest-link" data-tone="attention">
          Changes requested
        </Link>
      ) : digest.approvals > 0 ? (
        <Link
          href={href}
          className="queue-digest-link"
          data-tone="success"
          data-mobile-secondary={digest.open > 0 || undefined}
        >
          <Check size={12} />
          {digest.approvals} {digest.approvals === 1 ? 'approval' : 'approvals'}
        </Link>
      ) : null}
      {bots.slice(0, 2).map((bot, index) => (
        <Link
          key={bot.id}
          data-mobile-secondary={(digest.open > 0 && index > 0) || undefined}
          href={href}
          className="queue-digest-link"
          data-tone={
            bot.verdict === 'clean'
              ? 'success'
              : bot.verdict === 'findings' || bot.verdict === 'failed'
                ? 'attention'
                : undefined
          }
          title={`${bot.name}: ${bot.verdict === 'earlier' ? 'reviewed an earlier commit' : bot.verdict}${bot.score !== undefined ? `, ${bot.score}/5` : ''}`}
        >
          {bot.verdict === 'clean' ? (
            <Check size={12} />
          ) : bot.verdict === 'running' ? (
            <RefreshCw size={12} />
          ) : bot.verdict === 'findings' || bot.verdict === 'failed' ? (
            <Flag size={12} />
          ) : null}
          {bot.name} {bot.score !== undefined ? `${bot.score}/5` : bot.verdict}
        </Link>
      ))}
      {digest.open > 0 && bots.length > 1 && (
        <Link
          className="queue-digest-more-mobile"
          href={href}
          aria-label={`${bots.length - 1} more bot reviews`}
        >
          +{bots.length - 1}
        </Link>
      )}
      {bots.length > 2 && (
        <Link className="queue-digest-link" data-mobile-secondary={digest.open > 0 || undefined} href={href}>
          +{bots.length - 2} bots
        </Link>
      )}
    </span>
  );
}
