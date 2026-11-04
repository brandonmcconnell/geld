// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crawlCheckRuns } from './crawler';
import { expireHeadChecks, headChecks, nextCheckRefresh, resetHeadChecks } from './check-source';

/**
 * Two rows of `/wxt-dev/wxt/commit/<sha>/status-details?popover=true` as
 * GitHub served it on 2026-10-16 (trimmed): a passed Actions job and a
 * running check. The description is loose text beside the name, not in a
 * `.status-meta` cell as the classic merge box writes it.
 */
const PARTIAL = `
<div class="merge-status-list hide-closed-list js-updatable-content-preserve-scroll-position">
  <div class="merge-status-item d-flex flex-items-baseline">
    <div class="merge-status-icon flex-self-center">
      <svg data-component="Octicon" class="octicon octicon-check mx-auto d-block color-fg-success" viewBox="0 0 16 16"></svg>
    </div>
    <a href="/apps/cursor" class="d-inline-block tooltipped tooltipped-e Link--muted mr-2 rounded-2" aria-label="@cursor generated this status."><img class="avatar" src="https://avatars.githubusercontent.com/in/1210556?s=40&amp;v=4" width="20" height="20" alt="@cursor" /></a>
    <div class="color-fg-muted col-10 css-truncate css-truncate-target">
      <strong class="text-emphasized mr-2">
        Cursor Bugbot
      </strong>
      Successful in 4m — No issues found
    </div>
    <div class="d-flex col-2 flex-shrink-0">
      <a class="status-actions" href="/wxt-dev/wxt/runs/51234?check_suite_focus=true" aria-label="Details for Cursor Bugbot.">Details</a>
    </div>
  </div>
  <div class="merge-status-item d-flex flex-items-baseline">
    <div class="merge-status-icon flex-self-center">
      <svg data-component="Octicon" class="octicon octicon-dot-fill mx-auto d-block color-fg-attention anim-pulse" viewBox="0 0 16 16"></svg>
    </div>
    <div class="color-fg-muted col-10 css-truncate css-truncate-target">
      <strong class="text-emphasized mr-2">
        Greptile
      </strong>
      In progress — Reviewing
    </div>
    <div class="d-flex col-2 flex-shrink-0">
      <a class="status-actions" href="/wxt-dev/wxt/runs/51235?check_suite_focus=true" aria-label="Details for Greptile.">Details</a>
    </div>
  </div>
</div>`;

const subject = { origin: 'https://github.com', owner: 'wxt-dev', repo: 'wxt' };
const sha = '1a0b7c22e822c5d2de5ab8fab76b94f41185d66a';

function respond(body: string, ok = true): typeof fetch {
  return vi.fn(async () => new Response(body, { status: ok ? 200 : 404, headers: { 'content-type': 'text/html' } }));
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  resetHeadChecks();
  vi.unstubAllGlobals();
});

describe('crawlCheckRuns on the commit status partial', () => {
  it('reads each row: name, state from the glyph, the Details link and the loose description', () => {
    const parsed = new DOMParser().parseFromString(PARTIAL, 'text/html');
    const checks = crawlCheckRuns(parsed, sha);
    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatchObject({ name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha, description: 'Successful in 4m — No issues found' });
    expect(checks[0]?.detailsUrl).toContain('/wxt-dev/wxt/runs/51234');
    expect(checks[1]).toMatchObject({ name: 'Greptile', status: 'in_progress', conclusion: null, description: 'In progress — Reviewing' });
  });
});

describe('headChecks', () => {
  it('fetches the partial once per head, reports the landing, and keeps the reading', async () => {
    const fetchMock = respond(PARTIAL);
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();
    expect(headChecks(subject, sha, 'box', onChange)).toEqual([]);
    await settled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(fetchMock).mock.calls[0]?.[0]);
    expect(url).toBe(`https://github.com/wxt-dev/wxt/commit/${sha}/status-details?popover=true`);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(nextCheckRefresh(subject, sha)).not.toBeNull();
    const checks = headChecks(subject, sha, 'box', onChange);
    expect(checks.map((check) => check.name)).toEqual(['Cursor Bugbot', 'Greptile']);
    // Same head, same merge box words, read a moment ago: no second fetch.
    await settled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A bot's check is running: the next read is on the short clock.
    const next = nextCheckRefresh(subject, sha);
    expect(next).not.toBeNull();
    expect((next ?? 0) - Date.now()).toBeLessThanOrEqual(20_000);
  });

  it('reads again at once after the tab was away, keeping the last reading meanwhile', async () => {
    const fetchMock = respond(PARTIAL);
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();
    headChecks(subject, sha, 'box', onChange);
    await settled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expireHeadChecks();
    expect(headChecks(subject, sha, 'box', onChange)).toHaveLength(2);
    await settled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads again when the merge box words change, and stays quiet when the partial says the same', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = respond(PARTIAL);
      vi.stubGlobal('fetch', fetchMock);
      const onChange = vi.fn();
      headChecks(subject, sha, 'box', onChange);
      // While the read is in flight there is no deadline: the landing makes the pass that asks again.
      expect(nextCheckRefresh(subject, sha)).toBeNull();
      await vi.runAllTimersAsync();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(3_000);
      headChecks(subject, sha, 'box with one more passed', onChange);
      await vi.runAllTimersAsync();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Every landing is a pass, so the clock can be re-armed from the new fetchedAt.
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the last reading when the partial cannot be read', async () => {
    vi.stubGlobal('fetch', respond(PARTIAL));
    const onChange = vi.fn();
    headChecks(subject, sha, 'box', onChange);
    await settled();
    expect(headChecks(subject, sha, 'box', onChange)).toHaveLength(2);
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', respond('', false));
      vi.advanceTimersByTime(21_000);
      headChecks(subject, sha, 'box', onChange);
      await vi.runAllTimersAsync();
      expect(headChecks(subject, sha, 'box', onChange)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
