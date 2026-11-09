// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { crawlLeftovers } from './crawler';

/** A resolved thread as GitHub first sends it: the header, with the comments behind the deferred URL (from geld#383). */
const DEFERRED = `<div class="TimelineItem">
  <div class="TimelineItem-body"><turbo-frame id="review-thread-or-comment-id-3011793470">
    <review-thread-collapsible class="review-thread-component js-comment-container js-resolvable-timeline-thread-container" data-resolved="true" data-deferred-content-url="/o/r/pull/1/threads/3011793470?rendering_on_files_tab=false" data-hidden-comment-ids="4465501969">
      <div class="js-toggle-outdated-comments">apps/extension/src/github/review/flow.ts Resolved</div>
      <include-fragment loading="lazy"></include-fragment>
    </review-thread-collapsible>
  </turbo-frame></div>
</div>`;

function timeline(rows: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'js-discussion';
  root.innerHTML = rows;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('crawlLeftovers', () => {
  it('folds a resolved thread whose comments are on their way instead of listing it as another item', () => {
    timeline(DEFERRED);
    expect(crawlLeftovers(new Set(), () => true).map((entry) => entry.kind)).toEqual(['pending']);
  });

  it('keeps listing a resolved thread whose comments will not load, the only way left to reach it', () => {
    timeline(DEFERRED);
    expect(crawlLeftovers(new Set(), () => false).map((entry) => entry.kind)).toEqual(['other']);
  });

  it('asks about the thread container', () => {
    timeline(DEFERRED);
    const asked: string[] = [];
    crawlLeftovers(new Set(), (thread) => {
      asked.push(thread.getAttribute('data-deferred-content-url') ?? '');
      return true;
    });
    expect(asked).toEqual(['/o/r/pull/1/threads/3011793470?rendering_on_files_tab=false']);
  });

  it('leaves a row with an unknown shape as another item', () => {
    timeline('<div class="TimelineItem"><div class="TimelineItem-body">Something GitHub added</div></div>');
    expect(crawlLeftovers(new Set(), () => true).map((entry) => entry.kind)).toEqual(['other']);
  });
});
