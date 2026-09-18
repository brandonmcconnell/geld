import { describe, expect, it } from 'vitest';
import { clusterComments, firstSentence, guessSeverity, isBotOnly, suggestionOf } from './cluster';
import type { RawComment } from './cluster';

function comment(overrides: Partial<RawComment> & Pick<RawComment, 'anchor' | 'author' | 'body'>): RawComment {
  return {
    kind: 'thread',
    createdAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

describe('clusterComments', () => {
  it('keeps a human thread as one item with the human title', () => {
    const items = clusterComments([
      comment({
        anchor: 'discussion_r1',
        author: 'alice',
        body: 'Why drop the cache on rename?\n\nThis looks unused.',
        path: 'src/cache.ts',
        line: 18,
        threadAnchors: [
          { anchor: 'discussion_r1', kind: 'thread', author: 'alice', body: 'Why drop the cache on rename?' },
          { anchor: 'discussion_r2', kind: 'thread', author: 'bob', body: 'Good question.' },
        ],
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toMatch(/Why drop the cache/);
    expect(items[0]?.sources.map((source) => source.anchor)).toEqual(['discussion_r1', 'discussion_r2']);
    const first = items[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(isBotOnly(first)).toBe(false);
  });

  it('merges two bot comments on nearby lines of the same file', () => {
    const items = clusterComments([
      comment({
        anchor: 'discussion_r10',
        author: 'greptile-apps[bot]',
        body: 'Null check missing in parseDiff.',
        path: 'src/diff.ts',
        line: 42,
      }),
      comment({
        anchor: 'discussion_r11',
        author: 'cursor[bot]',
        body: 'parseDiff can throw on null input.',
        path: 'src/diff.ts',
        line: 44,
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.sources).toHaveLength(2);
    const first = items[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(isBotOnly(first)).toBe(true);
  });

  it('merges identical suggestion blocks', () => {
    const body = 'Please use const.\n```suggestion\nconst x = 1;\n```';
    const items = clusterComments([
      comment({ anchor: 'discussion_r20', author: 'coderabbitai[bot]', body, path: 'a.ts', line: 1 }),
      comment({ anchor: 'discussion_r21', author: 'copilot[bot]', body, path: 'b.ts', line: 99 }),
    ]);
    expect(items).toHaveLength(1);
    expect(suggestionOf(body)).toBe('const x = 1;');
  });

  it('marks resolved threads resolved', () => {
    const items = clusterComments([
      comment({ anchor: 'discussion_r3', author: 'alice', body: 'Fixed.', isResolved: true }),
    ]);
    expect(items[0]?.status).toBe('resolved');
  });
});

describe('firstSentence / severity', () => {
  it('strips headings and code fences', () => {
    expect(firstSentence('## Bug\n\nNull check missing in `parseDiff`.\n```ts\nx\n```')).toBe('Null check missing in parseDiff.');
  });

  it('classifies blocking vs nit vs question', () => {
    expect(guessSeverity('CRITICAL security hole', true, false)).toBe('blocking');
    expect(guessSeverity('nit: extra space', false, false)).toBe('nit');
    expect(guessSeverity('Why is this optional?', false, true)).toBe('question');
  });
});
