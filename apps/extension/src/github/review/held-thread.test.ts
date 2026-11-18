// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '@geld/review';
import { HELD_THREAD_MS, holdThread } from './held-thread';
import type { Batch } from './panel';
import { itemKey } from './panel';

function item(id: string, status: ReviewItem['status']): ReviewItem {
  return { id, status, title: id, rewritten: false, severity: 'suggestion', sources: [{ anchor: `discussion_r${id}`, kind: 'thread', author: 'a' }] };
}
function batch(key: string, items: ReviewItem[]): Batch {
  return { key, index: 1, avatars: [], names: [], items, comments: [], reviews: [], commits: [], commitCount: 0, forcePushes: 0, ciGlyph: null, committers: [], previews: [], time: '', firstAnchor: null };
}

describe('holdThread', () => {
  const open = item('1', 'open');
  const key = itemKey('1');

  it('remembers the open thread and its round while the crawl reads it', () => {
    const result = holdThread([batch('batch:a', [open])], key, null, 100, () => true, 'batch:a');
    expect(result.holding).toBe(false);
    expect(result.held).toEqual({ key, batch: 'batch:a', item: open, seen: 100 });
  });

  it('keeps it in its round while GitHub swaps the thread, so the row never closes', () => {
    const held = holdThread([batch('batch:a', [open])], key, null, 100, () => true, 'batch:a').held;
    const result = holdThread([batch('batch:a', [])], key, held, 2000, () => true, 'batch:a');
    expect(result.holding).toBe(true);
    expect(result.batches[0]?.items.map((entry) => entry.id)).toEqual(['1']);
  });

  it('gives the thread up once its comments left the page or the hold ran out', () => {
    const held = holdThread([batch('batch:a', [open])], key, null, 100, () => true, 'batch:a').held;
    expect(holdThread([batch('batch:a', [])], key, held, 2000, () => false, 'batch:a').holding).toBe(false);
    expect(holdThread([batch('batch:a', [])], key, held, 100 + HELD_THREAD_MS + 1, () => true, 'batch:a').holding).toBe(false);
  });

  it('lets the thread move once the crawl reads it again in its new state', () => {
    const held = holdThread([batch('batch:a', [open])], key, null, 100, () => true, 'batch:a').held;
    const resolved = item('1', 'resolved');
    const result = holdThread([batch('batch:a', [resolved])], key, held, 3000, () => true, 'batch:a');
    expect(result.holding).toBe(false);
    expect(result.batches[0]?.items).toEqual([resolved]);
    expect(result.held?.item).toBe(resolved);
  });
});
