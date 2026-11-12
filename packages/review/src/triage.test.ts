import { describe, expect, it } from 'vitest';
import type { SuggestInputItem } from './triage';
import { codeSpans, diffCounts, lineDiff, numberedLines, parseSuggestOutput, suggestionReplyBody, textLines } from './triage';

const item = (id: string, text: string): SuggestInputItem => ({ id, title: 't', path: 'src/a.ts', excerpts: [], target: { start: 10, end: 10, text }, around: '' });

describe('parseSuggestOutput', () => {
  const items = [item('discussion_r1', 'const x = a.b;'), item('discussion_r2', 'return y;'), item('discussion_r3', 'z();')];

  it('keeps known ids, one entry per id, and answers the ids the model skipped', () => {
    const text = JSON.stringify({
      suggestions: [
        { ids: ['discussion_r1', 'discussion_r9', 'discussion_r2'], summary: 'Guard `a`.', replacement: 'const x = a?.b;\n' },
        { ids: ['discussion_r2'], summary: 'dup', replacement: 'x' },
      ],
    });
    expect(parseSuggestOutput(text, items)).toEqual([
      { ids: ['discussion_r1', 'discussion_r2'], summary: 'Guard `a`.', replacement: ['const x = a?.b;'] },
      { ids: ['discussion_r3'], summary: '', replacement: null },
    ]);
  });

  it('drops a replacement that changes nothing, and refuses what is not the schema', () => {
    expect(parseSuggestOutput(JSON.stringify({ suggestions: [{ ids: ['discussion_r3'], summary: 's', replacement: 'z();' }] }), [items[2] ?? item('x', '')])).toEqual([{ ids: ['discussion_r3'], summary: 's', replacement: null }]);
    expect(parseSuggestOutput('not json', items)).toBeNull();
    expect(parseSuggestOutput(JSON.stringify({ items: [] }), items)).toBeNull();
  });
});

describe('lineDiff', () => {
  it('numbers context, deleted and added lines from the target start', () => {
    const diff = lineDiff(['a', 'b', 'c'], ['a', 'B', 'c', 'd'], 40);
    expect(diff).toEqual([
      { kind: 'context', text: 'a', before: 40, after: 40 },
      { kind: 'del', text: 'b', before: 41 },
      { kind: 'add', text: 'B', after: 41 },
      { kind: 'context', text: 'c', before: 42, after: 42 },
      { kind: 'add', text: 'd', after: 43 },
    ]);
    expect(diffCounts(diff)).toEqual({ added: 2, removed: 1 });
  });

  it('keeps unchanged lines in the middle as context', () => {
    expect(lineDiff(['x', 'keep', 'y'], ['X', 'keep', 'Y']).map((line) => line.kind)).toEqual(['del', 'add', 'context', 'del', 'add']);
  });
});

describe('codeSpans', () => {
  it('puts bare file names and paths in code spans, leaving existing spans and longer words alone', () => {
    const paths = ['apps/extension/src/github/attachment-lightbox.ts', 'apps/extension/src/github/attachment-viewer.tsx'];
    expect(codeSpans('One in attachment-lightbox.ts and one in `attachment-viewer.tsx`.', paths)).toBe('One in `attachment-lightbox.ts` and one in `attachment-viewer.tsx`.');
    expect(codeSpans('See apps/extension/src/github/attachment-viewer.tsx, then attachment-viewer.tsx.', paths)).toBe('See `apps/extension/src/github/attachment-viewer.tsx`, then `attachment-viewer.tsx`.');
    expect(codeSpans('my-attachment-lightbox.ts.bak stays', paths)).toBe('my-attachment-lightbox.ts.bak stays');
  });
});

describe('suggestion text', () => {
  it('fences the replacement as a GitHub suggestion, longer than any backticks inside it', () => {
    expect(suggestionReplyBody(['const a = 1;'], 'Use `const`.')).toBe('Suggested fix from Geld triage: Use `const`.\n\n```suggestion\nconst a = 1;\n```');
    expect(suggestionReplyBody(['const s = ```x```;'], '')).toContain('````suggestion');
  });

  it('reads lines without the model trailing newline, and numbers the target', () => {
    expect(textLines('a\r\nb\n')).toEqual(['a', 'b']);
    expect(numberedLines(['one', 'two', 'three', 'four'], 2, 3, 1)).toBe('1  one\n2> two\n3> three\n4  four');
  });
});
