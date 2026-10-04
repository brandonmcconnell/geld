import { describe, expect, it } from 'vitest';
import { revisionIndexAt } from './revisions';
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
