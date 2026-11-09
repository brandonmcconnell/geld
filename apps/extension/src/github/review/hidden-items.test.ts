// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ATTR_LOAD_PREVIOUS, clickLoadMore, hasLoadMore, hiddenTimelineItems, loadMorePendingUntil, loadMoreStalled, loadMoreStanding } from './deeplink';

describe('hiddenTimelineItems', () => {
  it('reads the count GitHub puts beside "Load more", once per form', () => {
    document.body.innerHTML = `<form class="ajax-pagination-form js-ajax-pagination"><div class="Box"><button type="submit" class="color-fg-muted ajax-pagination-btn"> 1,169 hidden items </button><button type="submit" class="ajax-pagination-btn" data-disable-with="Loading…"> Load more… </button></div></form>`;
    expect(hiddenTimelineItems()).toBe(1169);
  });

  it('reads a count grouped for another locale', () => {
    document.body.innerHTML = `<form class="ajax-pagination-form js-ajax-pagination"><button type="submit" class="ajax-pagination-btn"> 1.169 hidden items </button></form>`;
    expect(hiddenTimelineItems()).toBe(1169);
  });

  it('is nothing with no "Load more" on the page', () => {
    document.body.innerHTML = '<div class="js-discussion"></div>';
    expect(hiddenTimelineItems()).toBe(0);
  });
});

/** The Overview's Comments section as GitHub renders it (next.js#52514, Nov 2026), its control idle or loading. */
function overviewComments(loading: boolean): string {
  const counter = loading ? '' : '<span data-component="trailingVisual"><span aria-hidden="true" data-component="CounterLabel">237</span><span class="prc-VisuallyHidden">&nbsp;(237)</span></span>';
  return `<section><h2 id="overview-comments">Comments</h2><div data-component="Stack"><button data-component="Button" type="button" data-loading="${loading}"${loading ? ' aria-disabled="true"' : ''}><span data-component="buttonContent"><span data-component="text">Load previous comments</span>${counter}</span></button><div data-testid="timeline-item"></div></div></section>`;
}

describe("the Overview's Load previous comments", () => {
  beforeEach(() => {
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' });
  });

  it('reads the count in its counter label, and none while a page loads', () => {
    document.body.innerHTML = overviewComments(false);
    expect(hiddenTimelineItems()).toBe(237);
    expect(hasLoadMore()).toBe(true);
    document.body.innerHTML = overviewComments(true);
    expect(hiddenTimelineItems()).toBe(0);
    expect(hasLoadMore()).toBe(false);
  });

  it('is pressed once per page, pending until GitHub has loaded it', () => {
    document.body.innerHTML = overviewComments(false);
    const button = document.querySelector('button');
    const presses: number[] = [];
    button?.addEventListener('click', () => presses.push(1));
    expect(clickLoadMore(document, 10_000)).toBe(true);
    expect(button?.hasAttribute(ATTR_LOAD_PREVIOUS)).toBe(true);
    // Before GitHub has marked it loading, a second pass does not press again.
    expect(clickLoadMore(document, 10_200)).toBe(false);
    expect(loadMorePendingUntil(10_200)).toBe(11_000);
    button?.setAttribute('data-loading', 'true');
    expect(clickLoadMore(document, 11_500)).toBe(false);
    expect(loadMorePendingUntil(11_500)).toBe(25_000);
    expect(loadMoreStalled(11_500)).toBe(false);
    // Its page landed: the next one may be asked for.
    button?.setAttribute('data-loading', 'false');
    expect(loadMorePendingUntil(12_000)).toBeNull();
    expect(clickLoadMore(document, 12_000)).toBe(true);
    expect(presses).toHaveLength(2);
  });

  it('counts as stalled when it is still loading long after the press, and still stands: the timeline is not complete', () => {
    document.body.innerHTML = overviewComments(false);
    expect(clickLoadMore(document, 50_000)).toBe(true);
    document.querySelector('button')?.setAttribute('data-loading', 'true');
    expect(loadMoreStalled(66_000)).toBe(true);
    expect(hasLoadMore()).toBe(false);
    expect(loadMoreStanding()).toBe(true);
    document.body.innerHTML = '<section><h2 id="overview-comments">Comments</h2><div data-testid="timeline-item"></div></section>';
    expect(loadMoreStanding()).toBe(false);
  });

  it('takes a page that landed between two passes as done, so the next press need not wait out the grace', () => {
    document.body.innerHTML = overviewComments(false);
    expect(clickLoadMore(document, 80_000)).toBe(true);
    expect(clickLoadMore(document, 80_300)).toBe(false);
    // Loading and back within the grace, unseen by any pass: only the count says the page came.
    const counter = document.querySelector('[data-component="CounterLabel"]');
    if (counter !== null) counter.textContent = '215';
    expect(loadMorePendingUntil(80_400)).toBeNull();
    expect(clickLoadMore(document, 80_400)).toBe(true);
  });
});
