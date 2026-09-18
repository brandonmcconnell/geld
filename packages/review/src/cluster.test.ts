import { describe, expect, it } from 'vitest';
import { clusterComments, firstSentence, guessSeverity, isBotOnly, suggestionOf } from './cluster';
import { isTriggerComment } from './bots';
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

  it('titles a bot-led thread by the bot concern, not the human reply, and skips bot run summaries', () => {
    const items = clusterComments([
      comment({
        anchor: 'discussion_r30',
        author: 'cursor[bot]',
        body: 'Null check missing in parseDiff.',
        path: 'src/diff.ts',
        line: 42,
        threadAnchors: [
          { anchor: 'discussion_r30', kind: 'thread', author: 'cursor[bot]', body: 'Null check missing in parseDiff.' },
          { anchor: 'discussion_r31', kind: 'thread', author: 'alice', body: 'Will fix.' },
        ],
      }),
      comment({ anchor: 'issuecomment-88', kind: 'comment', author: 'greptile-apps[bot]', body: 'Greptile Summary\nScore 4/5.' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Null check missing in parseDiff.');
  });

  it('lists only review threads: top-level comments and trigger comments are not items', () => {
    const items = clusterComments([
      comment({ anchor: 'issuecomment-1', kind: 'comment', author: 'alice', body: 'Looks good overall, one question below.' }),
      comment({ anchor: 'pullrequestreview-2', kind: 'review', author: 'alice', body: 'Requesting changes.' }),
      comment({ anchor: 'discussion_r3', author: 'alice', body: '@greptileai', path: 'a.ts', line: 1 }),
      comment({ anchor: 'discussion_r4', author: 'alice', body: 'Why is this optional?', path: 'a.ts', line: 9 }),
    ]);
    expect(items.map((item) => item.sources[0]?.anchor)).toEqual(['discussion_r4']);
  });

  it('recognises bot trigger comments', () => {
    for (const body of ['@greptileai', 'bugbot run', 'Bugbot run.', '/devin review', '@cursor review', '@coderabbitai full review', '`@codex review`']) {
      expect(isTriggerComment(body), body).toBe(true);
    }
    for (const body of ['@alice can you look?', 'Why drop the cache on rename?', '@greptileai said this was fine but I disagree', 'run']) {
      expect(isTriggerComment(body), body).toBe(false);
    }
    expect(isTriggerComment('@acme-reviewer review', ['acme-reviewer[bot]'])).toBe(true);
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
