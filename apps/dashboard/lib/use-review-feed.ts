'use client';
import { useEffect, useRef, useState } from 'react';
import type { PullDetail } from '@geld/domain';
import { activitySchema, checkSchema } from '@geld/domain';
import { useDashboard } from './dashboard-context';
import { emptyFeed, feedResponseSchema } from './review-feed';
import type { ReviewFeed } from './review-feed';

export function useReviewFeed(pull: PullDetail, revision: number) {
  const { cache, session } = useDashboard();
  const { provider, host, owner, repo, number } = pull.ref;
  const { headSha } = pull;
  const request = useRef<AbortController | null>(null);
  const key = `${session.user?.id}:${JSON.stringify(pull.ref)}:${pull.headSha}`;
  const [retry, setRetry] = useState(0);
  const stateKey = `${key}:${revision}:${retry}`;
  const cached = retry === 0 && revision === 0 ? cache?.feeds.get(key) : undefined;
  const [state, setState] = useState({ key: stateKey, feed: cached ?? emptyFeed, busy: !cached });
  const feed = state.key === stateKey ? state.feed : (cache?.feeds.get(key) ?? emptyFeed);
  const busy = state.key === stateKey ? state.busy : !cached;
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    const cached = retry === 0 && revision === 0 ? cache?.feeds.get(key) : undefined;
    if (cached) {
      return () => controller.abort();
    }
    let next: ReviewFeed = { ...(cache?.feeds.get(key) ?? emptyFeed) };
    async function read(section: 'activity' | 'checks') {
      let cursor: string | null = null;
      try {
        for (let page = 0; page < 5; page++) {
          const params = new URLSearchParams({
            provider,
            host,
            owner,
            repo,
            number: String(number),
            section,
            revision: headSha,
            ...(cursor ? { cursor } : {}),
          });
          const response = await fetch(`/api/pull/activity?${params}`, { signal: controller.signal });
          if (!response.ok) throw new Error('Activity unavailable');
          const value = feedResponseSchema.parse(await response.json());
          if (value.headSha !== headSha) throw new Error('Activity revision changed');
          cursor = value.page.cursor;
          if (section === 'activity')
            next = {
              ...next,
              activity: [
                ...(page ? next.activity : []),
                ...value.page.items.map((item) => activitySchema.parse(item)),
              ],
              activityCursor: cursor,
              activityUnavailable: value.page.capped || (page > 0 && next.activityUnavailable),
            };
          else
            next = {
              ...next,
              checks: [
                ...(page ? next.checks : []),
                ...value.page.items.map((item) => checkSchema.parse(item)),
              ],
              checksCursor: cursor,
              checksUnavailable: value.page.capped || (page > 0 && next.checksUnavailable),
            };
          if (!controller.signal.aborted) setState({ key: stateKey, feed: next, busy: true });
          if (!cursor) break;
        }
      } catch {
        next = { ...next, [section === 'activity' ? 'activityUnavailable' : 'checksUnavailable']: true };
      }
    }
    void Promise.all([read('activity'), read('checks')]).then(() => {
      if (controller.signal.aborted) return;
      cache?.feeds.set(key, next);
      setState({ key: stateKey, feed: next, busy: false });
    });
    return () => controller.abort();
  }, [key, stateKey, provider, host, owner, repo, number, headSha, retry, revision, cache]);
  async function more() {
    if (!feed.activityCursor || busy) return;
    setState({ key: stateKey, feed, busy: true });
    const signal = request.current?.signal;
    try {
      const params = new URLSearchParams({
        ...pull.ref,
        number: String(pull.ref.number),
        section: 'activity',
        revision: pull.headSha,
        cursor: feed.activityCursor,
      });
      const response = await fetch(`/api/pull/activity?${params}`, signal ? { signal } : {});
      if (!response.ok) throw new Error('Activity unavailable');
      const value = feedResponseSchema.parse(await response.json());
      if (value.headSha !== pull.headSha) throw new Error('Activity revision changed');
      if (signal?.aborted) return;
      const next = {
        ...feed,
        activity: [...feed.activity, ...value.page.items.map((item) => activitySchema.parse(item))],
        activityCursor: value.page.cursor,
        activityUnavailable: feed.activityUnavailable || value.page.capped,
      };
      cache?.feeds.set(key, next);
      setState({ key: stateKey, feed: next, busy: false });
    } catch {
      if (signal?.aborted) return;
      setState({ key: stateKey, feed: { ...feed, activityUnavailable: true }, busy: false });
    }
  }
  return { feed, busy, more, retry: () => setRetry((value) => value + 1) };
}
