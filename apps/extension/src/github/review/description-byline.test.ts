// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { compactDescriptionByline } from './description-byline';

const LOG = '/user_content_edits/show_edit_history_log/PR_kwDOUOpwns8AAAABMN7QBg';

/** The description card's header as github.com renders it (geld#251, Nov 2026), with `extra` after the time. */
function card(extra = ''): string {
  return `<div class="TimelineItem js-comment-container js-command-palette-pull-body">
    <div class="timeline-comment-header clearfix d-flex flex-row flex-items-start">
      <h3 class="f5 text-normal py-2"><div class="d-flex flex-items-center flex-wrap gap-1">
        <span class="d-inline-flex d-md-none"><img class="avatar circle" alt="@brandonmcconnell"></span>
        <strong><a class="author Link--primary text-bold" href="/brandonmcconnell">brandonmcconnell</a></strong>
        commented
        <a href="#issue-6156092287" class="Link--secondary js-timestamp"><relative-time datetime="2026-11-02T04:18:07Z">Nov 2, 2026</relative-time></a>
        ${extra}
        <span class="js-comment-edit-history">
          <span class="d-inline-block color-fg-muted">&#8226;</span>
          <details class="details-overlay details-reset d-inline-block dropdown">
            <summary class="btn-link no-underline color-fg-muted js-notice"><div class="position-relative">
              <span>edited by cursor <span class="Label Label--secondary">Bot</span></span>
              <svg class="octicon octicon-triangle-down"></svg>
            </div></summary>
            <details-menu class="dropdown-menu js-comment-edit-history-menu" src="${LOG}" preload></details-menu>
          </details>
        </span>
      </div></h3>
    </div>
  </div>`;
}

const line = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-geld-desc-byline]');
  if (element === null) throw new Error('no byline');
  return element;
};

describe('compactDescriptionByline', () => {
  afterEach(() => {
    compactDescriptionByline(false);
    document.body.innerHTML = '';
  });

  it('keeps the author, the time and the edit menu, and marks nothing else to show', () => {
    // Signed in, a description posted through an App says so after the time: loose words, then the App's link.
    document.body.innerHTML = card('– with <a class="Link--secondary" href="/apps/cursor">Cursor</a>');
    compactDescriptionByline(true);
    const kept = [...line().children].filter((child) => child.hasAttribute('data-geld-desc-keep')).map((child) => child.tagName.toLowerCase() + (child.className === '' ? '' : `.${child.className.split(' ')[0] ?? ''}`));
    expect(kept).toEqual(['span.d-inline-flex', 'strong', 'a.Link--secondary', 'span.js-comment-edit-history']);
    expect(line().querySelector('a[href="/apps/cursor"]')?.closest('[data-geld-desc-keep]')).toBeNull();
  });

  it("leaves the edit menu's words as GitHub wrote them", () => {
    document.body.innerHTML = card();
    const before = document.querySelector('summary')?.outerHTML;
    compactDescriptionByline(true);
    compactDescriptionByline(true);
    expect(document.querySelector('summary')?.outerHTML).toBe(before);
  });

  it('puts the header back as GitHub rendered it when turned off', () => {
    document.body.innerHTML = card();
    const before = document.body.innerHTML;
    compactDescriptionByline(true);
    compactDescriptionByline(false);
    expect(document.body.innerHTML).toBe(before);
  });
});
