import { describe, expect, it } from 'vitest';
import { applyAddressed } from './addressed';
import type { ReviewItem } from './model';

const item: ReviewItem = {
  id: 'ri_1',
  title: 'Null check',
  rewritten: false,
  severity: 'bug',
  status: 'open',
  path: 'src/diff.ts',
  line: 42,
  sources: [{ anchor: 'discussion_r1', kind: 'thread', author: 'cursor[bot]', bot: 'bugbot' }],
};

describe('applyAddressed', () => {
  it('keeps done-manual from a previous tick', () => {
    expect(applyAddressed(item, { changedPaths: [], manualDoneIds: new Set(['ri_1']), humanReplied: false }).status).toBe(
      'done-manual',
    );
  });

  it('marks addressed when a later commit touches the path', () => {
    const next = applyAddressed(item, { changedPaths: ['src/diff.ts'], manualDoneIds: new Set(), humanReplied: false });
    expect(next.status).toBe('addressed');
    expect(next.addressed?.verdict).toBe('yes');
  });

  it('does not override resolved', () => {
    const resolved = { ...item, status: 'resolved' as const };
    expect(applyAddressed(resolved, { changedPaths: ['src/diff.ts'], manualDoneIds: new Set(), humanReplied: true }).status).toBe(
      'resolved',
    );
  });

  it('lets a semantic "no" reopen an addressed item', () => {
    const addressed = applyAddressed(item, { changedPaths: ['src/diff.ts'], manualDoneIds: new Set(), humanReplied: false });
    const reopened = applyAddressed(addressed, { changedPaths: ['src/diff.ts'], manualDoneIds: new Set(), humanReplied: false }, {
      verdict: 'no',
      evidence: ['still throws'],
    });
    expect(reopened.status).toBe('open');
  });
});
