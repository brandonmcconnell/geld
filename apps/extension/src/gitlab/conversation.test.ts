// @vitest-environment happy-dom
import { gitLabConversationRoots, gitLabDescriptionHost } from './conversation';

beforeEach(() => { document.body.innerHTML = ''; });

it('identifies observed per-note roots without collapsing discussion composers or their wrappers', () => {
  // Reduced from the public !266882 Overview capture, November 1, 2026.
  document.body.innerHTML = '<section class="issuable-discussion"><div data-testid="discussion-content"><ul><li id="note_4135317512" data-testid="noteable-note-container"><div class="note-body">Review</div></li><li data-testid="reply-wrapper"><textarea data-testid="reply-field"></textarea></li></ul></div><li class="js-timeline-entry system-note" id="note_693531ed6dcbff3233a1a16e2584ede43f9b8ec2"><span data-testid="system-note-content">changed milestone</span></li></section>';
  const roots = gitLabConversationRoots(document);
  expect(roots.map(({ anchors, kind }) => ({ anchors, kind }))).toEqual([
    { anchors: ['note_4135317512'], kind: 'comment' },
    { anchors: ['note_693531ed6dcbff3233a1a16e2584ede43f9b8ec2'], kind: 'activity' },
  ]);
  expect(roots.every(({ root }) => root.querySelector('textarea') === null)).toBe(true);
});

it('leaves active editors, malformed ids, nested comments and Geld renderings visible', () => {
  document.body.innerHTML = '<section class="issuable-discussion"><li id="note_1" data-testid="noteable-note-container"><form><textarea></textarea></form></li><li id="note_unknown" data-testid="noteable-note-container"></li><div data-geld-ui><li id="note_2" data-testid="noteable-note-container"></li></div><li id="note_3" data-testid="noteable-note-container"><ul><li id="note_4" data-testid="noteable-note-container"></li></ul></li></section>';
  expect(gitLabConversationRoots(document).map(({ anchors }) => anchors)).toEqual([['note_4']]);
});

it('returns only the native rendered description body, preserving title, digest host and editor', () => {
  document.body.innerHTML = '<section class="issuable-discussion"><div class="detail-page-description"><h1>MR title</h1><section data-geld-ui>Digest</section><div data-testid="description-content"><div class="md">Description</div></div><form><textarea></textarea></form></div></section>';
  expect(gitLabDescriptionHost(document)?.textContent).toBe('Description');
  document.querySelector('[data-testid="description-content"]')?.setAttribute('data-geld-ui', '');
  expect(gitLabDescriptionHost(document)).toBeNull();
});
