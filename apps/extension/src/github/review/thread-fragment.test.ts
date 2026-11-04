// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { threadFragmentOf } from './thread-fragment';

describe('threadFragmentOf', () => {
  it('passes over a shown comment’s lazy ⋯ menu and edit form for the thread’s own fragment', () => {
    document.body.innerHTML = `
      <div class="js-resolvable-timeline-thread-container" data-deferred-content-url="/o/r/pull/1/threads/9">
        <div class="js-comment" id="discussion_r1">
          <details class="details-overlay"><summary>⋯</summary><details-menu src="/menu"><include-fragment id="menu"></include-fragment></details-menu></details>
          <div class="js-comment-edit-form"><include-fragment id="edit" src="/edit"></include-fragment></div>
        </div>
        <include-fragment id="thread" loading="lazy"></include-fragment>
      </div>`;
    const thread = document.querySelector('[data-deferred-content-url]');
    if (thread === null) throw new Error('fixture');
    expect(threadFragmentOf(thread)?.id).toBe('thread');
  });

  it('finds none when the only fragments are a comment’s', () => {
    document.body.innerHTML = `<div id="t"><div class="js-comment"><details-menu><include-fragment></include-fragment></details-menu></div></div>`;
    const thread = document.getElementById('t');
    if (thread === null) throw new Error('fixture');
    expect(threadFragmentOf(thread)).toBeNull();
  });
});
