// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { threadHeadOf } from './thread-head';

const at = (anchor: string): Element => {
  const node = document.getElementById(anchor);
  if (node === null) throw new Error(`fixture: #${anchor}`);
  return node;
};

describe('threadHeadOf', () => {
  describe('a bot review with words of its own (geld#349, round 4)', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="issuecomment-6597073842" class="timeline-comment"><div class="comment-body">Walkthrough</div></div>
        <div id="issuecomment-6598543458" class="timeline-comment"><div class="comment-body">You're right, thanks for the fix.</div></div>
        <div id="pullrequestreview-5748936184">
          <div class="timeline-comment"><div class="comment-body">Actionable comments posted: 2</div></div>
          <div class="js-resolvable-timeline-thread-container"><div id="discussion_r4452256962" class="timeline-comment"><div class="comment-body">Split line 470.</div></div></div>
          <div class="js-resolvable-timeline-thread-container"><div id="discussion_r4452256965" class="timeline-comment"><div class="comment-body">Keep the gap.</div></div></div>
        </div>`;
    });

    // The summary and the reply were both written in the same minutes as the threads, so a time-based link would claim them.
    const summaries = [
      { anchor: 'issuecomment-6597073842', times: ['2026-11-03T06:30:45Z', '2026-11-03T08:13:49Z'] },
      { anchor: 'issuecomment-6598543458', times: ['2026-11-03T08:06:49Z', '2026-11-03T08:13:55Z'] },
    ];
    const threadAt = Date.parse('2026-11-03T08:13:43Z');

    it('puts both threads under the review that holds them', () => {
      for (const thread of ['discussion_r4452256962', 'discussion_r4452256965']) {
        const head = threadHeadOf(at(thread), threadAt, summaries);
        expect(head?.anchor).toBe('pullrequestreview-5748936184');
        expect(head?.review?.textContent).toBe('Actionable comments posted: 2');
      }
    });

    it('never puts them under the bot\'s summary or its reply', () => {
      const heads = ['discussion_r4452256962', 'discussion_r4452256965'].map((thread) => threadHeadOf(at(thread), threadAt, summaries)?.anchor);
      expect(heads).not.toContain('issuecomment-6597073842');
      expect(heads).not.toContain('issuecomment-6598543458');
    });
  });

  describe('a bot review with no words (Greptile)', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="issuecomment-1" class="timeline-comment"><div class="comment-body">Confidence Score: 4/5</div></div>
        <div id="pullrequestreview-2">
          <div class="js-resolvable-timeline-thread-container"><div id="discussion_r3" class="timeline-comment"><div class="comment-body">A finding.</div></div></div>
        </div>`;
    });

    it('puts the thread under the summary rewritten for the same run', () => {
      const summaries = [{ anchor: 'issuecomment-1', times: ['2026-09-25T20:39:49Z', '2026-10-02T18:45:22Z'] }];
      expect(threadHeadOf(at('discussion_r3'), Date.parse('2026-10-02T18:45:11Z'), summaries)).toEqual({ anchor: 'issuecomment-1', review: null });
    });

    it('puts it under nothing when the summary was neither posted nor rewritten near the thread', () => {
      const summaries = [{ anchor: 'issuecomment-1', times: ['2026-09-25T20:39:49Z'] }];
      expect(threadHeadOf(at('discussion_r3'), Date.parse('2026-10-02T18:45:11Z'), summaries)).toBeNull();
    });

    it('puts a person\'s thread under nothing', () => {
      expect(threadHeadOf(at('discussion_r3'), Date.parse('2026-10-02T18:45:11Z'), null)).toBeNull();
    });
  });
});
