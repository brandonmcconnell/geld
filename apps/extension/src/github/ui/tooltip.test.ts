// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { lineIndex, mergeLineRects } from './tooltip';

const rect = (x: number, y: number, w: number, h: number): DOMRect => new DOMRect(x, y, w, h);

describe('a tooltip under the line the pointer is on', () => {
  // A commit message link wrapped over two lines, with an inline child (a <code>) giving the first line two rects.
  const lines = mergeLineRects([rect(74, 426, 300, 22), rect(374, 426, 112, 22), rect(74, 450, 124, 22), rect(0, 0, 0, 0)]);

  it('folds client rects into one per line and drops empty ones', () => {
    expect(lines.map((line) => [line.left, line.top, line.width, line.height])).toEqual([
      [74, 426, 412, 22],
      [74, 450, 124, 22],
    ]);
  });

  it('picks the line under the pointer, the nearest when it is between lines, the first with no pointer', () => {
    expect(lineIndex(lines, 437)).toBe(0);
    expect(lineIndex(lines, 461)).toBe(1);
    // In the leading between the lines: the nearer one.
    expect(lineIndex(lines, 449.6)).toBe(1);
    expect(lineIndex(lines, 448.2)).toBe(0);
    expect(lineIndex(lines, null)).toBe(0);
    // One line: always it, pointer or not.
    expect(lineIndex(lines.slice(0, 1), 900)).toBe(0);
  });
});
