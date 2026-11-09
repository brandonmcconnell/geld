/**
 * Geld's logo for the terminal: the mark beside the word, 7 lines by 46 columns, in half blocks (▀ ▄ █) only.
 *
 * Block elements are the one kind of glyph every terminal fits to the cell, drawing them itself or from fonts made
 * to fill it. Diagonal glyphs are not: whether a triangle meets the blocks beside it depends on the terminal, so
 * the mark's 45° cuts are even steps of square pixels rather than a line that is only straight in some terminals.
 * The mark is the brand grid mark at one unit per pixel, and the word a small pixel rendering of the wordmark,
 * three lines tall with one-pixel strokes, so its letters stand to the mark about as they do in the logo.
 */

/** Mirrors `assets/brand/geld-logomark-grid.svg` (logo.test.ts checks it). */
export const MARK_PATH = 'M14 0H3L0 3V14H11L14 11V4H5L4 5V10H9L10 9V8H6V6H12V10L10 12H2V4L4 2H14Z';

/** The wordmark six pixels tall: each letter's rows, `#` filled, in the logo's widths (G 5, E 5, L 4, D 5). */
const LETTERS: readonly (readonly string[])[] = [
  ['.###.', '#...#', '#....', '#.###', '#...#', '.###.'],
  ['#####', '#....', '#....', '####.', '#....', '#####'],
  ['#...', '#...', '#...', '#...', '#...', '####'],
  ['####.', '#...#', '#...#', '#...#', '#...#', '####.'],
];
const LETTER_GAP = 3;
const MARK_GAP = 4;

type Point = readonly [number, number];

/** The outlines of a path made of M, L, H, V and Z commands only, which is all Geld's brand files use. */
export function outlines(path: string): Point[][] {
  const tokens = path.match(/[MLHVZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const shapes: Point[][] = [];
  let shape: Point[] = [];
  let x = 0;
  let y = 0;
  const number = (at: number): number => Number(tokens[at]);
  for (let at = 0; at < tokens.length; ) {
    const command = tokens[at++];
    if (command === 'M' || command === 'L') {
      if (command === 'M' && shape.length > 0) shapes.push(shape);
      if (command === 'M') shape = [];
      x = number(at++);
      y = number(at++);
      shape.push([x, y]);
    } else if (command === 'H') {
      x = number(at++);
      shape.push([x, y]);
    } else if (command === 'V') {
      y = number(at++);
      shape.push([x, y]);
    } else if (command === 'Z') {
      if (shape.length > 0) shapes.push(shape);
      shape = [];
    } else {
      throw new Error(`Unsupported path command ${String(command)}`);
    }
  }
  if (shape.length > 0) shapes.push(shape);
  return shapes;
}

/** Even-odd fill, as the SVGs render. */
function filled(shapes: readonly (readonly Point[])[], px: number, py: number): boolean {
  let inside = false;
  for (const shape of shapes) {
    for (let at = 0; at < shape.length; at++) {
      const [x1, y1] = shape[at] ?? [0, 0];
      const [x2, y2] = shape[(at + 1) % shape.length] ?? [0, 0];
      if (y1 > py !== y2 > py && px < x1 + ((py - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
    }
  }
  return inside;
}

/** Pixel rows in half blocks: one line per two rows. */
export function halfBlocks(rows: readonly string[]): string[] {
  const lines: string[] = [];
  for (let at = 0; at < rows.length; at += 2) {
    const upper = rows[at] ?? '';
    const lower = rows[at + 1] ?? '';
    let line = '';
    for (let column = 0; column < Math.max(upper.length, lower.length); column++) {
      const top = upper[column] === '#';
      const bottom = lower[column] === '#';
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines;
}

/** The brand grid mark, each unit a square pixel sampled at its centre. */
export function mark(): string[] {
  const shapes = outlines(MARK_PATH);
  const rows = Array.from({ length: 14 }, (_, y) => Array.from({ length: 14 }, (_, x) => (filled(shapes, x + 0.5, y + 0.5) ? '#' : '.')).join(''));
  return halfBlocks(rows);
}

export function word(): string[] {
  const rows = Array.from({ length: 6 }, (_, row) => LETTERS.map((letter) => letter[row] ?? '').join('.'.repeat(LETTER_GAP)));
  return halfBlocks(rows);
}

/** The mark with the word beside it, centred on it, and the caption under both; the mark and caption alone where the word does not fit. */
export function banner(columns: number, caption: string): string[] {
  const left = mark();
  const right = word();
  const width = (left[0]?.length ?? 0) + MARK_GAP + (right[0]?.length ?? 0);
  const top = Math.floor((left.length - right.length) / 2);
  const lines = left.map((line, at) => {
    const beside = columns >= width ? right[at - top] : undefined;
    return beside === undefined ? line.trimEnd() : `${line}${' '.repeat(MARK_GAP)}${beside}`.trimEnd();
  });
  return [...lines, '', caption];
}
