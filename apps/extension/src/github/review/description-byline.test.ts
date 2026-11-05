// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactDescriptionByline, editsWords } from './description-byline';
import { editCountIn, resetEditTimes } from './edit-times';

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

const logPage = (header: string): string => `<div class="dropdown-header">${header}</div><ul>
  <li><button data-edit-history-url="/user_content_edits/UCE_b"><span>edited <relative-time datetime="2026-11-03T02:22:02Z"></relative-time> (most recent)</span></button></li>
  <li><button data-edit-history-url="/user_content_edits/UCE_a"><span>created <relative-time datetime="2026-11-02T04:18:07Z"></relative-time></span></button></li>
</ul>`;

const line = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-geld-desc-byline]');
  if (element === null) throw new Error('no byline');
  return element;
};

describe('compactDescriptionByline', () => {
  afterEach(() => {
    compactDescriptionByline(false);
    resetEditTimes();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps the author, the time and the edit menu, and marks nothing else to show', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    // Signed in, a description posted through an App says so after the time: loose words, then the App's link.
    document.body.innerHTML = card('– with <a class="Link--secondary" href="/apps/cursor">Cursor</a>');
    compactDescriptionByline(true);
    const kept = [...line().children].filter((child) => child.hasAttribute('data-geld-desc-keep')).map((child) => child.tagName.toLowerCase() + (child.className === '' ? '' : `.${child.className.split(' ')[0] ?? ''}`));
    expect(kept).toEqual(['span.d-inline-flex', 'strong', 'a.Link--secondary', 'span.js-comment-edit-history']);
    expect(line().querySelector('a[href="/apps/cursor"]')?.closest('[data-geld-desc-keep]')).toBeNull();
  });

  it('reads "N edits" from the edit log once it lands, in place of who edited last', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(logPage('Edited 5 times')))));
    document.body.innerHTML = card();
    const reapply = (): void => compactDescriptionByline(true, reapply);
    compactDescriptionByline(true, reapply);
    const summary = document.querySelector('summary');
    expect(summary?.hasAttribute('data-geld-desc-edits')).toBe(true);
    expect(summary?.querySelector('.geld-desc-edits')?.textContent).toBe('edited');
    await vi.waitFor(() => expect(summary?.querySelector('.geld-desc-edits')?.textContent).toBe('5 edits'));
    expect(summary?.querySelectorAll('.geld-desc-edits')).toHaveLength(1);
  });

  it('puts the header back as GitHub rendered it when turned off', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    document.body.innerHTML = card();
    const before = document.body.innerHTML;
    compactDescriptionByline(true);
    compactDescriptionByline(false);
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('editsWords', () => {
  it('counts edits with a numeral', () => {
    expect(editsWords(1)).toBe('1 edit');
    expect(editsWords(4)).toBe('4 edits');
    expect(editsWords(null)).toBe('edited');
  });
});

describe('editCountIn', () => {
  const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

  it("takes the log header's count", () => {
    expect(editCountIn(parse(logPage('Edited 5 times')), 2)).toBe(5);
    expect(editCountIn(parse(logPage('Edited 1 time')), 2)).toBe(1);
  });

  it('counts the revisions but the post when the header says nothing', () => {
    expect(editCountIn(parse('<ul></ul>'), 3)).toBe(2);
    expect(editCountIn(parse('<ul></ul>'), 0)).toBeNull();
  });
});
