// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { commentFixScopes } from './chat';

describe('a comment’s Fix choices', () => {
  it('offers only what there is: This comment, Threads, or all three with Both', () => {
    expect(commentFixScopes({ comment: true, threads: 2 })).toEqual(['comment', 'threads', 'both']);
    expect(commentFixScopes({ comment: true, threads: 0 })).toEqual(['comment']);
    expect(commentFixScopes({ comment: false, threads: 1 })).toEqual(['threads']);
    expect(commentFixScopes({ comment: false, threads: 0 })).toEqual([]);
  });
});
