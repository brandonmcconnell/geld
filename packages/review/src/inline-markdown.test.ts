import { describe, expect, it } from 'vitest';

import { parseInlineMarkdown, stripInlineMarkdown } from './inline-markdown';

describe('parseInlineMarkdown', () => {
  it('leaves plain text alone', () => {
    expect(parseInlineMarkdown('left one question')).toEqual([{ text: 'left one question', marks: [] }]);
  });

  it('finds code, bold, italic and strikethrough', () => {
    expect(parseInlineMarkdown('iiuc `for="humans"` is **the** point, *mostly*, ~~not~~')).toEqual([
      { text: 'iiuc ', marks: [] },
      { text: 'for="humans"', marks: ['code'] },
      { text: ' is ', marks: [] },
      { text: 'the', marks: ['strong'] },
      { text: ' point, ', marks: [] },
      { text: 'mostly', marks: ['em'] },
      { text: ', ', marks: [] },
      { text: 'not', marks: ['del'] },
    ]);
  });

  it('keeps marks out of code and nests emphasis', () => {
    expect(parseInlineMarkdown('`a**b**c` and **bold *and italic* here**')).toEqual([
      { text: 'a**b**c', marks: ['code'] },
      { text: ' and ', marks: [] },
      { text: 'bold ', marks: ['strong'] },
      { text: 'and italic', marks: ['strong', 'em'] },
      { text: ' here', marks: ['strong'] },
    ]);
  });

  it('treats underscores inside words and unmatched markers as text', () => {
    expect(parseInlineMarkdown('use snake_case_names and 2 * 3 * 4, _really_')).toEqual([
      { text: 'use snake_case_names and 2 * 3 * 4, ', marks: [] },
      { text: 'really', marks: ['em'] },
    ]);
    expect(parseInlineMarkdown('an unclosed `tick and **bold')).toEqual([{ text: 'an unclosed `tick and **bold', marks: [] }]);
  });

  it('handles double backticks and padded code', () => {
    expect(parseInlineMarkdown('`` a`b `` and ` x `')).toEqual([
      { text: 'a`b', marks: ['code'] },
      { text: ' and ', marks: [] },
      { text: 'x', marks: ['code'] },
    ]);
  });

  it('strips to plain text', () => {
    expect(stripInlineMarkdown('iiuc `for="humans"` is **the** point')).toBe('iiuc for="humans" is the point');
  });
});
