// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { editLogUrlOf, nodeIdOf } from './edit-times';

const REPOSITORY = 1357541534;

function page(html: string): void {
  document.head.innerHTML = `<meta name="octolytics-dimension-repository_id" content="${REPOSITORY}">`;
  document.body.innerHTML = html;
}

describe('editLogUrlOf', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  const minimizedLog = `/user_content_edits/show_edit_history_log/${nodeIdOf('issuecomment-6559233642', REPOSITORY) ?? ''}`;

  it("reads a minimized comment's log by its node id when the wrapper holds the details", () => {
    page(`<div id="issuecomment-6559233642" class="timeline-comment-group"><div class="minimized-comment js-comment"><details><summary>This comment has been minimized.</summary></details></div></div>`);
    expect(editLogUrlOf('issuecomment-6559233642')).toBe(minimizedLog);
  });

  it('reads it too when GitHub puts the class on the details itself', () => {
    page(`<div id="issuecomment-6559233642" class="timeline-comment-group"><details class="minimized-comment js-comment"><summary>This comment has been minimized.</summary></details></div>`);
    expect(editLogUrlOf('issuecomment-6559233642')).toBe(minimizedLog);
  });

  it("does not take a review card's class and its own menus for a minimized comment", () => {
    page(`<div id="pullrequestreview-42" class="timeline-comment minimized-comment js-comment"><div class="timeline-comment-actions"><details class="details-overlay"><summary>⋯</summary></details></div><div class="comment-body">Looks good.</div></div>`);
    expect(editLogUrlOf('pullrequestreview-42')).toBeNull();
  });

  it("does not read a review as minimized because one of its thread's comments is", () => {
    page(`<div id="pullrequestreview-42" class="timeline-comment"><div id="discussion_r7"><div class="minimized-comment js-comment"><details><summary>This comment has been minimized.</summary></details></div></div></div>`);
    expect(editLogUrlOf('pullrequestreview-42')).toBeNull();
    expect(editLogUrlOf('discussion_r7')).toBe(`/user_content_edits/show_edit_history_log/${nodeIdOf('discussion_r7', REPOSITORY) ?? ''}`);
  });

  it("prefers the comment's own edited menu", () => {
    page(`<div id="issuecomment-6559233642"><details-menu src="/user_content_edits/show_edit_history_log/IC_listed"></details-menu></div>`);
    expect(editLogUrlOf('issuecomment-6559233642')).toBe('/user_content_edits/show_edit_history_log/IC_listed');
  });
});

describe('nodeIdOf', () => {
  it('builds the node ids GitHub serves edit logs under, from the anchor and the repository id', () => {
    // Read from geld#146's own "edited" menus (Nov 2026).
    expect(nodeIdOf('issuecomment-6559233642', 1357541534)).toBe('IC_kwDOUOpwns8AAAABhvX2ag');
    expect(nodeIdOf('discussion_r4436018770', 1357541534)).toBe('PRRC_kwDOUOpwns8AAAABCGhGUg');
  });

  it('packs small numbers in their shortest form', () => {
    // [0, 300, 42]: 0x93 0x00 0xcd 0x01 0x2c 0x2a.
    expect(nodeIdOf('pullrequestreview-42', 300)).toBe(`PRR_${btoa(String.fromCharCode(0x93, 0x00, 0xcd, 0x01, 0x2c, 0x2a)).replace(/=+$/, '')}`);
  });

  it('has no id for an anchor that is not a comment, or without a repository', () => {
    expect(nodeIdOf('event-123', 1357541534)).toBeNull();
    expect(nodeIdOf('issuecomment-1', Number.NaN)).toBeNull();
  });
});
