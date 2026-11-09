/**
 * Geld's logo for the terminal: the mark beside the word, 7 lines by 46 columns.
 *
 * A terminal cell is about twice as tall as it is wide, and every diagonal a font can draw runs corner to corner
 * of a cell, so a true 45° cut cannot be drawn in text. The mark keeps its cuts smooth instead: it is the brand's
 * grid mark with each cut moved onto a cell diagonal (all of them still parallel), drawn cell by cell with
 * whichever of █ ▀ ▄ and the four cell triangles matches. The word is a small pixel rendering of the wordmark,
 * three lines tall with one-pixel strokes, so its letters stand to the mark about as they do in the logo.
 *
 * A triangle meets the blocks only where the terminal draws it to the cell itself, which no font can promise:
 * `TriangleGlyphs` names the code points a terminal draws, and with none the mark is stepped half blocks, which
 * every terminal fits to the cell.
 */

/**
 * Which triangles a terminal draws to the cell itself: the Powerline ones (U+E0B8 to U+E0BF; xterm.js in VS Code
 * and Cursor, Ghostty, kitty, WezTerm), the Geometric Shapes ones (U+25E2 to U+25E5; VTE terminals such as GNOME
 * Terminal and xfce4-terminal, and kitty), or none (macOS Terminal, iTerm2 by default, the Windows consoles).
 */
export type TriangleGlyphs = 'powerline' | 'geometric' | null;

/** In the order ◢ ◣ ◤ ◥: lower right, lower left, upper left, upper right. */
const TRIANGLES: Readonly<Record<'powerline' | 'geometric', readonly [string, string, string, string]>> = {
  powerline: ['\u{E0BA}', '\u{E0B8}', '\u{E0BC}', '\u{E0BE}'],
  geometric: ['◢', '◣', '◤', '◥'],
};

/** Mirrors `assets/brand/geld-logomark-grid.svg` (logo.test.ts checks it): change `CELL_MARK_PATH` with it. */
export const MARK_PATH = 'M14 0H3L0 3V14H11L14 11V4H5L4 5V10H9L10 9V8H6V6H12V10L10 12H2V4L4 2H14Z';
/** `MARK_PATH` with every cut running one unit across per two units down, the diagonal of a cell. */
export const CELL_MARK_PATH = 'M14 0H2L0 4V14H12L14 10V4H5L4 6V10H9L10 8H6V6H12V10L11 12H2V4L3 2H14Z';

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

/** Samples across one cell, one unit wide and two tall, at which each glyph is compared with the shape. */
const SAMPLES = 8;
/** Where each glyph is ink, in cell coordinates (x 0 to 1, y 0 to 1 downwards). */
const GLYPHS: readonly (readonly [string, (x: number, y: number) => boolean])[] = [
  [' ', () => false],
  ['█', () => true],
  ['▀', (_x, y) => y < 0.5],
  ['▄', (_x, y) => y >= 0.5],
  ['◢', (x, y) => y > 1 - x],
  ['◣', (x, y) => y > x],
  ['◤', (x, y) => y < 1 - x],
  ['◥', (x, y) => y < x],
];

/** Each cell as the glyph whose ink differs from the shape at the fewest samples. */
export function cells(path: string, width: number, height: number): string[] {
  const shapes = outlines(path);
  const lines: string[] = [];
  for (let row = 0; row < height / 2; row++) {
    let line = '';
    for (let column = 0; column < width; column++) {
      let best = ' ';
      let fewest = Number.POSITIVE_INFINITY;
      for (const [glyph, ink] of GLYPHS) {
        let misses = 0;
        for (let j = 0; j < SAMPLES; j++) {
          for (let i = 0; i < SAMPLES; i++) {
            const x = (i + 0.5) / SAMPLES;
            const y = (j + 0.5) / SAMPLES;
            if (ink(x, y) !== filled(shapes, column + x, row * 2 + y * 2)) misses++;
          }
        }
        if (misses < fewest) {
          best = glyph;
          fewest = misses;
        }
      }
      line += best;
    }
    lines.push(line);
  }
  return lines;
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

/** The mark with smooth cuts in the triangles the terminal draws itself, else in half blocks, stepped. */
export function mark(triangles: TriangleGlyphs = 'geometric'): string[] {
  if (triangles !== null) {
    const [lowerRight, lowerLeft, upperLeft, upperRight] = TRIANGLES[triangles];
    const swap: Readonly<Record<string, string>> = { '◢': lowerRight, '◣': lowerLeft, '◤': upperLeft, '◥': upperRight };
    return cells(CELL_MARK_PATH, 14, 14).map((line) => [...line].map((glyph) => swap[glyph] ?? glyph).join(''));
  }
  const rows = Array.from({ length: 14 }, (_, y) =>
    Array.from({ length: 14 }, (_, x) => (filled(outlines(MARK_PATH), x + 0.5, y + 0.5) ? '#' : '.')).join(''),
  );
  return halfBlocks(rows);
}

export function word(): string[] {
  const rows = Array.from({ length: 6 }, (_, row) => LETTERS.map((letter) => letter[row] ?? '').join('.'.repeat(LETTER_GAP)));
  return halfBlocks(rows);
}

/** The mark with the word beside it, centred on it, and the caption under both; the mark and caption alone where the word does not fit. */
export function banner(columns: number, caption: string, triangles: TriangleGlyphs = 'geometric'): string[] {
  const left = mark(triangles);
  const right = word();
  const width = (left[0]?.length ?? 0) + MARK_GAP + (right[0]?.length ?? 0);
  const top = Math.floor((left.length - right.length) / 2);
  const lines = left.map((line, at) => {
    const beside = columns >= width ? right[at - top] : undefined;
    return beside === undefined ? line.trimEnd() : `${line}${' '.repeat(MARK_GAP)}${beside}`.trimEnd();
  });
  return [...lines, '', caption];
}
