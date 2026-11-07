import type { PathPoint, Stroke } from './geometry';
import { METRICS } from './grid';

/**
 * What a glyph's skeleton is drawn with. x is a centreline coordinate (the left stem sits at 0),
 * y an outline edge: `top(y)` and `bottom(y)` give the centreline of a horizontal whose top or bottom edge is at y.
 */
export interface DrawContext {
  v: number;
  h: number;
  /** A width between stem centres at SemiBold, grown or narrowed with the stem so counters keep their room. */
  wide(n: number): number;
  top(y: number): number;
  bottom(y: number): number;
  cap: number;
  xHeight: number;
}

export interface GlyphDef {
  name: string;
  unicode?: number;
  /** Sidebearings in grid units, measured from the Geld Sans outline. */
  lsb: number;
  rsb: number;
  draw(g: DrawContext): Stroke[];
}

export interface SpaceDef {
  name: string;
  unicode: number;
  /** Advance in grid units. */
  advance: number;
}

const p = (x: number, y: number, cut = false): PathPoint => (cut ? { x, y, cut } : { x, y });
const open = (...points: PathPoint[]): Stroke => ({ points, closed: false });
const closed = (...points: PathPoint[]): Stroke => ({ points, closed: true });

/** The box every round letter is built on: a closed stroke with its corners cut or square. */
function box(x0: number, x1: number, y0: number, y1: number, cuts: [boolean, boolean, boolean, boolean]): Stroke {
  const [bl, br, tr, tl] = cuts;
  return closed(p(x0, y0, bl), p(x1, y0, br), p(x1, y1, tr), p(x0, y1, tl));
}

export const GLYPHS: GlyphDef[] = [
  {
    name: 'H',
    unicode: 0x48,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(9);
      return [open(p(0, 0), p(0, g.cap)), open(p(w, 0), p(w, g.cap)), open(p(0, g.cap / 2), p(w, g.cap / 2))];
    },
  },
  {
    name: 'O',
    unicode: 0x4f,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(10), g.bottom(0), g.top(g.cap), [true, true, true, true])],
  },
  {
    name: 'D',
    unicode: 0x44,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(10), g.bottom(0), g.top(g.cap), [false, true, true, false])],
  },
  {
    name: 'E',
    unicode: 0x45,
    lsb: 1.5,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      const bar = g.cap / 2;
      return [
        open(p(w, g.top(g.cap)), p(0, g.top(g.cap)), p(0, g.bottom(0)), p(w, g.bottom(0))),
        open(p(0, bar), p(g.wide(9), bar)),
      ];
    },
  },
  {
    name: 'L',
    unicode: 0x4c,
    lsb: 1.5,
    rsb: 0.75,
    draw: (g) => [open(p(0, g.cap), p(0, g.bottom(0)), p(g.wide(9), g.bottom(0)))],
  },
  {
    name: 'G',
    unicode: 0x47,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      const bar = g.top(g.cap / 2);
      return [
        open(
          p(w, 9),
          p(w, g.top(g.cap), true),
          p(0, g.top(g.cap), true),
          p(0, g.bottom(0), true),
          p(w, g.bottom(0), true),
          p(w, bar),
          p(w * 0.4, bar),
        ),
      ];
    },
  },
  {
    name: 'n',
    unicode: 0x6e,
    lsb: 1.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      return [open(p(0, 0), p(0, g.top(g.xHeight)), p(w, g.top(g.xHeight), true), p(w, 0))];
    },
  },
  {
    name: 'o',
    unicode: 0x6f,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), [true, true, true, true])],
  },
  {
    name: '.notdef',
    lsb: 1,
    rsb: 1,
    draw: (g) => [box(0, g.wide(7), g.bottom(0), g.top(g.cap), [false, false, false, false])],
  },
];

export const SPACES: SpaceDef[] = [{ name: 'space', unicode: 0x20, advance: 5 }];

/** How far stem centres move apart per unit of stem beyond SemiBold's 2. */
const GROWTH = 0.5;

export function drawContext(v: number, h: number): DrawContext {
  return {
    v,
    h,
    wide: (n) => n + GROWTH * (v - 2),
    top: (y) => y - h / 2,
    bottom: (y) => y + h / 2,
    cap: METRICS.cap,
    xHeight: METRICS.xHeight,
  };
}
