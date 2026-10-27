// @vitest-environment happy-dom
import { liveCatchUpDue, liveRegionMessages, QUIET_AFTER_MS, STAGGER_MS } from './live-regions';

const region = (url: string, extra = ''): string => `<div class="js-socket-channel js-updatable-content" data-channel="ch:${url}" data-url="${url}" ${extra}></div>`;

describe('liveCatchUpDue', () => {
  it('asks only once GitHub has stopped listening, at its 30s', () => {
    expect(liveCatchUpDue(QUIET_AFTER_MS - 1)).toBe(false);
    expect(liveCatchUpDue(QUIET_AFTER_MS)).toBe(true);
    expect(QUIET_AFTER_MS).toBe(30_000);
  });
});

describe('liveRegionMessages', () => {
  it('messages each live region, spaced out, naming every region’s event, and leaves the description, the marker and the checks rollup alone', () => {
    document.body.innerHTML = [
      region('/o/r/pull/7/partials/body', 'data-channel-event-name="body_updated"'),
      region('/o/r/pull/7/partials/reviews/1'),
      `<div class="js-timeline-marker">${region('/o/r/pull/7/partials/unread_timeline?since=x', 'data-channel-event-name="timeline_updated"')}</div>`,
      region('/o/r/commit/abc/rollup', 'data-batched="10000"'),
      region('/o/r/issues/7/show_partial?partial=issues%2Fsidebar', 'data-channel-event-name="sidebar_updated"'),
      region('/o/r/pull/7/partials/reviews/2'),
      '<div class="js-updatable-content" data-url="/o/r/pull/7/partials/not-live"></div>',
      '<div class="js-socket-channel js-updatable-content"></div>',
    ].join('');
    const messages = liveRegionMessages(document);
    expect(messages.map((message) => message.region.getAttribute('data-url'))).toEqual(['/o/r/pull/7/partials/reviews/1', '/o/r/issues/7/show_partial?partial=issues%2Fsidebar', '/o/r/pull/7/partials/reviews/2']);
    expect(messages.map((message) => message.detail.data.wait)).toEqual([0, STAGGER_MS, 2 * STAGGER_MS]);
    for (const message of messages) expect(message.detail.data.event_updates).toEqual({ sidebar_updated: true });
    expect(messages[0]?.detail.name).toBe('ch:/o/r/pull/7/partials/reviews/1');
  });

  it('has nothing to send on a page without live regions', () => {
    document.body.innerHTML = '<div class="js-updatable-content" data-url="/x"></div>';
    expect(liveRegionMessages(document)).toEqual([]);
  });
});
