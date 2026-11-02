'use client';
import { useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import type { PullSummary } from '@geld/domain';
import { pullPath } from '@geld/domain';
import { queueInsightSchema } from '@/lib/queue-insight';
import type { QueueInsight } from '@/lib/queue-insight';
export function useQueueInsights(pulls: readonly PullSummary[], scope: string) {
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
        let insight: QueueInsight | null = null;
        try {
          const query = new URLSearchParams({ ...pull.ref, number: String(pull.ref.number) });
          const response = await fetch(`/api/queue/insight?${query}`, { signal: abort.signal, cache: 'no-store' });
          const parsed = queueInsightSchema.safeParse(await response.json());
          if (response.ok && parsed.success && parsed.data.headSha === pull.headSha) insight = parsed.data;
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
  return state.key === key ? state.values : {};
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
      <span className="essential-count">{insight.essential.files} essential</span>
      <span className="diffstat">
        <span>+{insight.essential.additions}</span>
        <span>−{insight.essential.deletions}</span>
      </span>
      {insight.hidden.files > 0 && (
        <Popover.Root>
          <Popover.Trigger className="hidden-count">{insight.hidden.files} hidden</Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={6} className="popover-positioner">
              <Popover.Popup className="counts-popover">
                <Popover.Title>Hidden from your review</Popover.Title>
                <dl>
                  {insight.categories.map((category) => (
                    <div key={category.id}>
                      <dt>{category.label}</dt>
                      <dd>
                        {category.files} <span className="muted">{category.files === 1 ? 'file' : 'files'}</span>
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
    </div>
  );
}
