// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAST_FOR_MS, pollTriggerReactions, REACTION_FAST_POLL_MS, REACTION_POLL_MS, resetTriggerReactions, withFetchedReactions } from './trigger-reactions';

const T0 = 1_000_000;
const waiting = [{ anchor: 'issuecomment-1', at: T0 }];

const PARTIAL = '/acme/widgets/comments/IC_kwDO/partials/timeline_issue_comment';

/** GitHub's markup for a top-level comment, trimmed to what matters here: the container's `data-url` and the reaction tooltips. */
function comment(reactors: readonly string[]): string {
  const tips = reactors.map((login, index) => `<button id="r${index}"></button><tool-tip for="r${index}">${login} reacted with thumbs up emoji</tool-tip>`).join('');
  return `<div class="TimelineItem js-comment-container" data-url="${PARTIAL}"><div class="timeline-comment-group" id="issuecomment-1"><div class="js-comment">@greptileai</div><div class="comment-reactions js-reactions-container has-reactions"><form class="js-pick-reaction"><div class="js-comment-reactions-options">${tips}</div></form></div></div></div>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetTriggerReactions();
  document.body.innerHTML = '';
});

describe('pollTriggerReactions', () => {
  it('reads the reaction GitHub never pushed from the comment’s own partial', async () => {
    document.body.innerHTML = comment([]);
    const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response(comment(['greptile-apps[bot]']), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const landed = vi.fn();
    expect(pollTriggerReactions(waiting, T0 + 1_000, landed)).toBe(T0 + 1_000 + REACTION_FAST_POLL_MS);
    await vi.waitFor(() => expect(landed).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0]?.[0])).toContain(PARTIAL);
    expect(withFetchedReactions('issuecomment-1', undefined)).toEqual([{ login: 'greptile-apps[bot]', emoji: 'thumbs up' }]);
  });

  it('asks often while the request is young, then every interval, and stays quiet while nothing changes', async () => {
    document.body.innerHTML = comment([]);
    const fetch = vi.fn(async () => new Response(comment([]), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const landed = vi.fn();
    const settle = async (calls: number): Promise<void> => {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(calls));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    pollTriggerReactions(waiting, T0, landed);
    await settle(1);
    pollTriggerReactions(waiting, T0 + REACTION_FAST_POLL_MS - 1, landed);
    expect(fetch).toHaveBeenCalledTimes(1);
    pollTriggerReactions(waiting, T0 + REACTION_FAST_POLL_MS, landed);
    await settle(2);
    const old = T0 + FAST_FOR_MS;
    expect(pollTriggerReactions(waiting, old, landed)).toBe(old + REACTION_POLL_MS);
    await settle(3);
    pollTriggerReactions(waiting, old + REACTION_POLL_MS - 1, landed);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(landed).not.toHaveBeenCalled();
  });

  it('keeps the page’s reactions when the partial cannot be read, and waits for nothing without a trigger', async () => {
    document.body.innerHTML = comment([]);
    const fetch = vi.fn(async () => new Response('Not Found', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    pollTriggerReactions(waiting, T0, vi.fn());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const page = [{ login: 'alice', emoji: 'heart' }];
    expect(withFetchedReactions('issuecomment-1', page)).toBe(page);
    expect(pollTriggerReactions([], T0, vi.fn())).toBeNull();
  });
});
