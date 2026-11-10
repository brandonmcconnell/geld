'use client';
import Link from 'next/link';
import { useDashboard } from '@/lib/dashboard-context';
import { Check, Flag, RefreshCw, MessagesSquare } from './icons';
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

function SignalAvatar({ src, name }: { readonly src: string; readonly name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="signal-avatar signal-initial" aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  ) : (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img className="signal-avatar" src={src} alt="" onError={() => setFailed(true)} />
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
  return (
    <span className="queue-digest-summary" role="group" aria-label="Review digest">
      {(digest.approvedBy ?? []).map((login) => (
        <span
          className="review-signal"
          key={login}
          title={`${login} approved`}
          aria-label={`${login} approved`}
        >
          <SignalAvatar name={login} src={`https://github.com/${encodeURIComponent(login)}.png?size=40`} />
          <Check size={11} />
        </span>
      ))}
      {!digest.approvedBy?.length && digest.approvals > 0 && (
        <span className="review-signal" aria-label={`${digest.approvals} approvals`}>
          <Check size={11} />
          {digest.approvals}
        </span>
      )}
      {digest.changesRequested > 0 && (
        <span className="review-signal" title="Changes requested">
          <Flag size={11} />
          {digest.changesRequested}
        </span>
      )}
      {digest.bots.map((bot) => (
        <span
          key={bot.id}
          className="review-signal"
          data-tone={bot.verdict}
          title={`${bot.name}: ${bot.verdict}${bot.score !== undefined ? `, ${bot.score}/5` : ''}`}
          aria-label={`${bot.name} ${bot.score !== undefined ? `${bot.score}/5` : bot.verdict}`}
        >
          {['coderabbit', 'greptile'].includes(bot.id) ? (
            <SignalAvatar
              name={bot.name}
              src={`https://avatars.githubusercontent.com/in/${bot.id === 'coderabbit' ? '347564' : '867647'}?s=40`}
            />
          ) : (
            <span className="signal-avatar signal-initial">{bot.name.slice(0, 1)}</span>
          )}
          {bot.score !== undefined && <span>{bot.score}/5</span>}
          {bot.verdict === 'clean' ? (
            <Check size={11} />
          ) : ['findings', 'failed'].includes(bot.verdict) ? (
            <i className="signal-ember" />
          ) : bot.verdict === 'running' ? (
            <RefreshCw size={11} />
          ) : (
            <span className="signal-revision">{bot.verdict}</span>
          )}
        </span>
      ))}
      {digest.unresolvedThreads != null && digest.unresolvedThreads > 0 && (
        <span
          className="review-signal signal-threads"
          aria-label={`${digest.unresolvedThreads} unresolved threads`}
          title="Unresolved review threads"
        >
          <MessagesSquare size={13} />
          {digest.unresolvedThreads}
        </span>
      )}
    </span>
  );
}
