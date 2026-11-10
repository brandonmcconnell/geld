import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCache, queueData, updateQueuePages } from './workspace-cache';
import type { QueueData } from './contracts';
afterEach(() => vi.useRealTimers());
const page = (nextCursor: string | null): QueueData => ({ pulls: [], repositories: [], nextCursor });
describe('workspace memory cache', () => {
  it('bounds entries, expires stale data, and clears account data', () => {
    vi.useFakeTimers();
    const cache = new MemoryCache<string>(2, 1000);
    cache.set('alice:repo-a', 'a'); cache.set('alice:repo-b', 'b'); cache.set('bob:repo-a', 'c');
    expect(cache.get('alice:repo-a')).toBeUndefined();
    expect(cache.get('bob:repo-a')).toBe('c');
    vi.advanceTimersByTime(1001);
    expect(cache.get('alice:repo-b')).toBeUndefined();
    cache.set('bob:repo-a', 'new'); cache.clear();
    expect(cache.get('bob:repo-a')).toBeUndefined();
  });
  it('retains the terminal cursor when an earlier page is revalidated', () => {
    const initial = updateQueuePages(undefined, [{ cursor: '1', data: page('2') }]);
    const loaded = updateQueuePages(initial, [{ cursor: '2', data: page(null) }]);
    const refreshed = updateQueuePages(loaded, [{ cursor: '1', data: page('2') }]);
    expect(refreshed.pages.map(p => p.cursor)).toEqual(['1', '2']);
    expect(queueData(refreshed).nextCursor).toBeNull();
  });
});
