import { describe, expect, it } from 'vitest';
import { revisionIndexAt, sameRunAnchor } from './revisions';
import type { Revision } from './revisions';

// Greptile on mintlify/server#8382: created and filled in on Sep 25, rewritten for a re-run on Sep 26 and again on Oct 2.
const greptile: Revision[] = [
  { at: '2026-09-25T20:39:49Z', url: '/user_content_edits/created' },
  { at: '2026-09-25T20:40:06Z', url: '/user_content_edits/filled-in' },
  { at: '2026-09-26T10:33:44Z', url: '/user_content_edits/rerun-1a' },
  { at: '2026-09-26T10:33:50Z', url: '/user_content_edits/rerun-1b' },
  { at: '2026-10-02T18:45:11Z', url: '/user_content_edits/rerun-2a' },
  { at: '2026-10-02T18:45:22Z', url: '/user_content_edits/rerun-2b' },
];
const settle = 5 * 60 * 1000;

describe('revisionIndexAt', () => {
  it('takes the revision filled in moments after the thread was posted, not the stub before it', () => {
    // The review's thread landed at 20:39:52, between the summary's creation and the edit that wrote the review in.
    expect(revisionIndexAt(greptile, Date.parse('2026-09-25T20:39:52Z'), settle)).toBe(1);
  });

  it('stops before a later run rewrote the summary', () => {
    expect(revisionIndexAt(greptile, Date.parse('2026-09-26T10:40:00Z'), settle)).toBe(3);
    expect(revisionIndexAt(greptile, Date.parse('2026-09-28T00:00:00Z'), settle)).toBe(3);
  });

  it('is the last revision for a thread from the latest run (the page shows that reading)', () => {
    expect(revisionIndexAt(greptile, Date.parse('2026-10-02T18:45:15Z'), settle)).toBe(greptile.length - 1);
  });

  it('falls back to the first revision for a thread older than the comment', () => {
    expect(revisionIndexAt(greptile, Date.parse('2026-09-25T20:00:00Z'), settle)).toBe(0);
  });
});

describe('sameRunAnchor', () => {
  const before = 2 * 60 * 1000;
  const summary = { anchor: 'issuecomment-1', times: greptile.map((revision) => revision.at) };

  it('links a thread to the summary posted moments before it', () => {
    expect(sameRunAnchor([summary], Date.parse('2026-09-25T20:39:52Z'), before, settle)).toBe('issuecomment-1');
  });

  it('links a later run\'s thread to the summary rewritten for that run, not only to its first post', () => {
    expect(sameRunAnchor([summary], Date.parse('2026-10-02T18:45:00Z'), before, settle)).toBe('issuecomment-1');
  });

  it('links nothing when the summary was neither posted nor rewritten near the thread', () => {
    // geld#349: a summary posted at 06:30 and rewritten at 08:13 is no head for a thread at 06:50.
    const coderabbit = { anchor: 'issuecomment-2', times: ['2026-11-03T06:30:45Z', '2026-11-03T08:13:49Z'] };
    expect(sameRunAnchor([coderabbit], Date.parse('2026-11-03T06:50:37Z'), before, settle)).toBeNull();
  });

  it('takes the nearest of two summaries in the window', () => {
    const early = { anchor: 'issuecomment-3', times: ['2026-10-02T18:43:30Z'] };
    const near = { anchor: 'issuecomment-4', times: ['2026-10-02T18:45:20Z'] };
    expect(sameRunAnchor([early, near], Date.parse('2026-10-02T18:45:11Z'), before, settle)).toBe('issuecomment-4');
  });

  it('links nothing without a thread time', () => {
    expect(sameRunAnchor([summary], Number.NaN, before, settle)).toBeNull();
  });
});
