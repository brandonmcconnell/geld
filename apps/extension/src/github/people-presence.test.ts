// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { applyPeoplePresence, removePeoplePresence } from './people-presence';

/** An issue page as GitHub's React view draws it (Nov 2026), names made up. */
const ISSUE = `
  <div data-testid="comment-viewer-outer-box-0"><div data-testid="issue-body"><a data-testid="avatar-link" href="/hidden-one">hidden-one</a><p>The issue itself</p></div></div>
  <div data-testid="comment-viewer-outer-box-1" id="issuecomment-1"><a data-testid="avatar-link" href="/hidden-one">hidden-one</a><p>A comment of theirs</p></div>
  <div data-testid="comment-viewer-outer-box-2" id="issuecomment-2"><a data-testid="avatar-link" href="/someone">someone</a><p>Someone else's</p></div>`;

/** A discussion page (classic markup): the opening post, then comments, each with nested replies. */
const DISCUSSION = `
  <div id="discussion-1" class="timeline-comment"><a class="author" href="/hidden-one">hidden-one</a><p>The opening post</p></div>
  <div id="discussioncomment-10" class="timeline-comment"><a class="author" href="/someone">someone</a><p>A comment</p>
    <div id="discussioncomment-11" class="timeline-comment nested-discussion-timeline-comment"><a class="author" href="/hidden-one">hidden-one</a><p>Their reply</p></div>
  </div>
  <div id="discussioncomment-12" class="timeline-comment"><a class="author" href="/hidden-one">hidden-one</a><p>Their comment</p></div>`;

function apply(noun: string): void {
  applyPeoplePresence({ enabled: true, noun, hiddenAuthors: ['hidden-one'], schedule: () => undefined });
}

const folded = (selector: string): boolean => document.querySelector(selector)?.hasAttribute('data-geld-person-fold') ?? false;

afterEach(() => {
  removePeoplePresence();
  document.body.innerHTML = '';
});

describe('applyPeoplePresence on an issue', () => {
  it('folds a hidden person’s comment and never the issue they opened', () => {
    document.body.innerHTML = ISSUE;
    apply('issue');
    expect(folded('[data-testid="comment-viewer-outer-box-0"]')).toBe(false);
    expect(folded('#issuecomment-1')).toBe(true);
    expect(folded('#issuecomment-2')).toBe(false);
    expect(document.querySelector('#issuecomment-1')?.previousElementSibling?.textContent).toContain('someone on your hidden list in Geld');
  });

  it('keeps a comment the reader opened open after GitHub replaces its card', () => {
    document.body.innerHTML = ISSUE;
    apply('issue');
    const line = document.querySelector('#issuecomment-1')?.previousElementSibling;
    line?.querySelector('button')?.click();
    expect(document.querySelector('#issuecomment-1')?.hasAttribute('data-geld-person-fold-open')).toBe(true);
    const card = document.querySelector('#issuecomment-1');
    const fresh = card?.cloneNode(true);
    if (!(fresh instanceof Element)) throw new Error('no card');
    fresh.removeAttribute('data-geld-person-fold');
    fresh.removeAttribute('data-geld-person-fold-open');
    card?.replaceWith(fresh);
    apply('issue');
    expect(document.querySelector('#issuecomment-1')?.hasAttribute('data-geld-person-fold-open')).toBe(true);
    // The line stays across the swap, and its button acts on the card GitHub put in its place.
    document.querySelector('#issuecomment-1')?.previousElementSibling?.querySelector('button')?.click();
    expect(document.querySelector('#issuecomment-1')?.hasAttribute('data-geld-person-fold-open')).toBe(false);
    expect(document.querySelector('#issuecomment-1')?.previousElementSibling?.querySelector('button')?.textContent).toBe('Show comment');
  });
});

describe('applyPeoplePresence on a discussion', () => {
  it('leaves the opening post, and folds their comments and nested replies each on its own', () => {
    document.body.innerHTML = DISCUSSION;
    apply('discussion');
    expect(folded('#discussion-1')).toBe(false);
    expect(folded('#discussioncomment-10')).toBe(false);
    expect(folded('#discussioncomment-11')).toBe(true);
    expect(folded('#discussioncomment-12')).toBe(true);
  });

  it('puts the page back when turned off', () => {
    document.body.innerHTML = DISCUSSION;
    apply('discussion');
    applyPeoplePresence({ enabled: false, noun: 'discussion', hiddenAuthors: ['hidden-one'], schedule: () => undefined });
    expect(document.querySelector('[data-geld-person-fold], [data-geld-person-line]')).toBeNull();
  });
});
