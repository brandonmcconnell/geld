/**
 * Geld's logo for the terminal, drawn from the brand files' own geometry. Both shapes sit on whole units with
 * 45° cuts, so one unit per pixel loses nothing, and the half blocks (▀ ▄ █) make each character two square
 * pixels: the 14-unit grid mark and the 14-unit-tall wordmark are both 7 lines.
 */

/** Mirrors `assets/brand/geld-logomark-grid.svg` (logo.test.ts checks it). */
export const MARK_PATH = 'M14 0H3L0 3V14H11L14 11V4H5L4 5V10H9L10 9V8H6V6H12V10L10 12H2V4L4 2H14Z';
/** Mirrors the letters of `assets/brand/geld-logo.svg`, which span x 32 to 95 and y 6 to 20 (logo.test.ts checks it). */
export const WORDMARK_PATHS: readonly string[] = [
  'M44 11V8L42 6H34L32 8V18L34 20H42L44 18V13H37V15H42V17L41 18H35L34 17V9L35 8H41L42 9V11Z',
  'M61 6H50V20H61V18H52V14H60V12H52V8H61Z',
  'M67 6V20H77V18H69V6Z',
  'M83 6V20H93L95 18V8L93 6ZM85 8H92L93 9V17L92 18H85Z',
];
interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
const WORDMARK_BOX: Box = { left: 32, top: 6, width: 63, height: 14 };
/** The gap between the mark and the word, in columns. */
const GAP = 3;

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

/** Even-odd fill, as the SVGs render: the holes in the e and the d stay open. */
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

/** One line per two pixel rows, each pixel sampled at its centre. */
export function render(paths: readonly string[], box: Box): string[] {
  const shapes = paths.flatMap(outlines);
  const lines: string[] = [];
  for (let row = 0; row < box.height; row += 2) {
    let line = '';
    for (let column = 0; column < box.width; column++) {
      const x = box.left + column + 0.5;
      const upper = filled(shapes, x, box.top + row + 0.5);
      const lower = row + 1 < box.height && filled(shapes, x, box.top + row + 1.5);
      line += upper && lower ? '█' : upper ? '▀' : lower ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines;
}

export function mark(): string[] {
  return render([MARK_PATH], { left: 0, top: 0, width: 14, height: 14 });
}

export function wordmark(): string[] {
  return render(WORDMARK_PATHS, WORDMARK_BOX);
}

/** The full logo when `columns` has room for it, else the mark with the name beside it. */
export function banner(columns: number, caption: string): string[] {
  const left = mark();
  const word = wordmark();
  const wide = (left[0]?.length ?? 0) + GAP + (word[0]?.length ?? 0);
  if (columns >= wide) return [...left.map((line, at) => `${line}${' '.repeat(GAP)}${word[at] ?? ''}`), '', caption];
  const middle = Math.floor(left.length / 2);
  return left.map((line, at) => (at === middle ? `${line}${' '.repeat(GAP)}${caption}` : line));
}
