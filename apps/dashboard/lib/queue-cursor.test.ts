import { describe, expect, it } from 'vitest';
import { readQueueCursor, nextQueueCursor, writeQueueCursor } from './queue-cursor';
describe('complete provider queue pagination', () => {
  it('finishes PR pages in the current repository batch before advancing repositories', () => {
    const first = readQueueCursor('1', 'personal');
    if (!first) throw new Error('No initial page');
    const second = nextQueueCursor(first, true, true);
    expect(readQueueCursor(second, 'personal')).toEqual({
      mode: 'personal',
      batch: 0,
      pullPage: 2,
    });
    const nextBatch = nextQueueCursor({ mode: 'personal', batch: 0, pullPage: 2 }, false, true);
    expect(readQueueCursor(nextBatch, 'personal')).toEqual({
      mode: 'personal',
      batch: 1,
      pullPage: 1,
    });
    expect(nextQueueCursor({ mode: 'personal', batch: 1, pullPage: 1 }, false, false)).toBeNull();
  });
  it('keeps team and personal cursors separate and rejects malformed or excessive work', () => {
    expect(readQueueCursor(writeQueueCursor({ mode: 'team', batch: 0, pullPage: 2 }), 'personal')).toBeNull();
    expect(readQueueCursor('q.invalid', 'personal')).toBeNull();
    expect(readQueueCursor('99999', 'team')).toBeNull();
    expect(readQueueCursor('2', 'team')).toEqual({
      mode: 'team',
      batch: 1,
      pullPage: 1,
    });
  });
});
