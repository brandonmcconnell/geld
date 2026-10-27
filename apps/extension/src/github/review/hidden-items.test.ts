// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { hiddenTimelineItems } from './deeplink';

describe('hiddenTimelineItems', () => {
  it('reads the count GitHub puts beside "Load more", once per form', () => {
    document.body.innerHTML = `<form class="ajax-pagination-form js-ajax-pagination"><div class="Box"><button type="submit" class="color-fg-muted ajax-pagination-btn"> 1,169 hidden items </button><button type="submit" class="ajax-pagination-btn" data-disable-with="Loading…"> Load more… </button></div></form>`;
    expect(hiddenTimelineItems()).toBe(1169);
  });

  it('is nothing with no "Load more" on the page', () => {
    document.body.innerHTML = '<div class="js-discussion"></div>';
    expect(hiddenTimelineItems()).toBe(0);
  });
});
