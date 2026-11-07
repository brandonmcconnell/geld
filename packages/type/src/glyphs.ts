import type { Pen, PathPoint, Stroke } from './geometry';
import { CUT_OUTER, CUT_OUTER_LOWER, METRICS } from './grid';

/**
 * What a glyph's skeleton is drawn with. x is a centreline coordinate (a left stem sits at 0),
 * y an outline edge: `top(y)` and `bottom(y)` give the centreline of a horizontal whose top or bottom edge is at y.
 */
export interface DrawContext {
  v: number;
  /** The horizontal stroke of this glyph's case. */
  h: number;
  pen: Pen;
  /** Diagonals, a touch lighter than stems so they look the same weight. */
  diag: Pen;
  /** Side of a square dot (i, j, period, colon, exclamation). */
  dot: number;
  /** The least opening between a terminal and the stroke it faces. */
  aperture: number;
  /** A width between stem centres at SemiBold, grown or narrowed with the stem so counters keep their room. */
  wide(n: number): number;
  top(y: number): number;
  bottom(y: number): number;
  /** How far a diagonal of this run and rise reaches either side of its centre along a level end. */
  foot(dx: number, dy: number): number;
  cap: number;
  xHeight: number;
  ascender: number;
  descender: number;
}

export interface GlyphDef {
  name: string;
  unicode?: number;
  /** Lowercase letters draw with the lighter lowercase horizontals. */
  lower?: boolean;
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
const level = (stroke: Stroke, start = true, end = true): Stroke => ({
  ...stroke,
  ...(start ? { startCap: 'flat' as const } : {}),
  ...(end ? { endCap: 'flat' as const } : {}),
});
const withPen = (stroke: Stroke, pen: Pen): Stroke => ({ ...stroke, pen });

/** A box with each corner cut or square, listed bottom-left, bottom-right, top-right, top-left. */
function box(x0: number, x1: number, y0: number, y1: number, cuts: [boolean, boolean, boolean, boolean]): Stroke {
  const [bl, br, tr, tl] = cuts;
  return closed(p(x0, y0, bl), p(x1, y0, br), p(x1, y1, tr), p(x0, y1, tl));
}
const ALL: [boolean, boolean, boolean, boolean] = [true, true, true, true];
const RIGHT: [boolean, boolean, boolean, boolean] = [false, true, true, false];
const LEFT: [boolean, boolean, boolean, boolean] = [true, false, false, true];

/** A diagonal with level ends, drawn with the diagonal pen. */
function diagonal(g: DrawContext, x0: number, y0: number, x1: number, y1: number, ends: [boolean, boolean] = [true, true]): Stroke {
  return withPen(level(open(p(x0, y0), p(x1, y1)), ends[0], ends[1]), g.diag);
}

/** A square dot standing on y. */
function dot(g: DrawContext, x: number, y: number): Stroke {
  return withPen(open(p(x, y), p(x, y + g.dot)), { v: g.dot, h: g.dot });
}

const stem = (x: number, y0: number, y1: number) => open(p(x, y0), p(x, y1));
const bar = (x0: number, x1: number, y: number) => open(p(x0, y), p(x1, y));

/** Two diagonals meeting at a level point, as in V, the bottom of W and the arms of Y. */
function vee(g: DrawContext, x0: number, x1: number, top: number, bottom: number): Stroke[] {
  const mid = (x0 + x1) / 2;
  return [diagonal(g, x0, top, mid, bottom), diagonal(g, x1, top, mid, bottom)];
}

/** Z and z: two bars and a diagonal whose level ends sit flush inside the bars' corners. */
function zed(g: DrawContext, w: number, height: number): Stroke[] {
  const e = g.foot(w, height);
  return [bar(0, w, g.top(height)), bar(0, w, g.bottom(0)), diagonal(g, w - e, height, e, 0)];
}

/** M's and N's diagonals start flush with the stem's outer edge. */
function fromStemTop(g: DrawContext, x: number, dir: 1 | -1, toX: number, toY: number): Stroke {
  const e = g.foot(Math.abs(toX - x), g.cap - toY);
  return diagonal(g, x - dir * (g.v / 2) + dir * e, g.cap, toX, toY);
}

const UPPER: GlyphDef[] = [
  {
    name: 'A',
    unicode: 0x41,
    lsb: 0.4,
    rsb: 0.4,
    draw: (g) => {
      const w = g.wide(10);
      const y = 5;
      const x = (w / 2) * (y / g.cap);
      return [...vee(g, 0, w, 0, g.cap), bar(x, w - x, y)];
    },
  },
  {
    name: 'B',
    unicode: 0x42,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(9), g.cap / 2, g.top(g.cap), RIGHT), box(0, g.wide(10), g.bottom(0), g.cap / 2, RIGHT)],
  },
  {
    name: 'C',
    unicode: 0x43,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      return [open(p(w, 9), p(w, g.top(g.cap), true), p(0, g.top(g.cap), true), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, 5))];
    },
  },
  {
    name: 'D',
    unicode: 0x44,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(10), g.bottom(0), g.top(g.cap), RIGHT)],
  },
  {
    name: 'E',
    unicode: 0x45,
    lsb: 1.5,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      return [open(p(w, g.top(g.cap)), p(0, g.top(g.cap)), p(0, g.bottom(0)), p(w, g.bottom(0))), bar(0, g.wide(9), g.cap / 2)];
    },
  },
  {
    name: 'F',
    unicode: 0x46,
    lsb: 1.5,
    rsb: 0.75,
    draw: (g) => [open(p(g.wide(10), g.top(g.cap)), p(0, g.top(g.cap)), p(0, 0)), bar(0, g.wide(8.5), g.cap / 2)],
  },
  {
    name: 'G',
    unicode: 0x47,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      const y = g.top(g.cap / 2);
      return [
        open(p(w, 9), p(w, g.top(g.cap), true), p(0, g.top(g.cap), true), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, y), p(w * 0.4, y)),
      ];
    },
  },
  {
    name: 'H',
    unicode: 0x48,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(9);
      return [stem(0, 0, g.cap), stem(w, 0, g.cap), bar(0, w, g.cap / 2)];
    },
  },
  { name: 'I', unicode: 0x49, lsb: 1.5, rsb: 1.5, draw: (g) => [stem(0, 0, g.cap)] },
  {
    name: 'J',
    unicode: 0x4a,
    lsb: 0.75,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      return [open(p(w, g.cap), p(w, g.bottom(0), true), p(0, g.bottom(0), true), p(0, 4))];
    },
  },
  {
    name: 'K',
    unicode: 0x4b,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(9.5);
      const y0 = 4.5;
      const reach = w + g.v / 2 - g.foot(w, g.cap - y0);
      const t = 0.4;
      return [
        stem(0, 0, g.cap),
        withPen(level(open(p(0, y0), p(reach, g.cap)), false, true), g.diag),
        diagonal(g, reach * t, y0 + (g.cap - y0) * t, reach, 0, [false, true]),
      ];
    },
  },
  {
    name: 'L',
    unicode: 0x4c,
    lsb: 1.5,
    rsb: 0.5,
    draw: (g) => [open(p(0, g.cap), p(0, g.bottom(0)), p(g.wide(9), g.bottom(0)))],
  },
  {
    name: 'M',
    unicode: 0x4d,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(11);
      const y = 3.5;
      return [stem(0, 0, g.cap), stem(w, 0, g.cap), fromStemTop(g, 0, 1, w / 2, y), fromStemTop(g, w, -1, w / 2, y)];
    },
  },
  {
    name: 'N',
    unicode: 0x4e,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(9.5);
      const e = g.foot(w, g.cap);
      return [stem(0, 0, g.cap), stem(w, 0, g.cap), diagonal(g, e - g.v / 2, g.cap, w + g.v / 2 - e, 0)];
    },
  },
  {
    name: 'O',
    unicode: 0x4f,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(10), g.bottom(0), g.top(g.cap), ALL)],
  },
  {
    name: 'P',
    unicode: 0x50,
    lsb: 1.5,
    rsb: 1,
    draw: (g) => [stem(0, 0, g.cap), box(0, g.wide(9.5), 6, g.top(g.cap), RIGHT)],
  },
  {
    name: 'Q',
    unicode: 0x51,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      return [box(0, w, g.bottom(0), g.top(g.cap), ALL), diagonal(g, w * 0.55, 3.5, w * 0.55 + 5.5, -2, [false, true])];
    },
  },
  {
    name: 'R',
    unicode: 0x52,
    lsb: 1.5,
    rsb: 0.4,
    draw: (g) => {
      const w = g.wide(9.5);
      const reach = w + g.v / 2 - g.foot(w * 0.6, 6);
      return [stem(0, 0, g.cap), box(0, w, 6, g.top(g.cap), RIGHT), diagonal(g, w * 0.4, 6, reach, 0, [false, true])];
    },
  },
  {
    name: 'S',
    unicode: 0x53,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9.5);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [open(p(w, 10), p(w, t, true), p(0, t, true), p(0, g.cap / 2, true), p(w, g.cap / 2, true), p(w, b, true), p(0, b, true), p(0, 4))];
    },
  },
  {
    name: 'T',
    unicode: 0x54,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(11);
      return [bar(0, w, g.top(g.cap)), stem(w / 2, 0, g.cap)];
    },
  },
  {
    name: 'U',
    unicode: 0x55,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(10);
      return [open(p(0, g.cap), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.cap))];
    },
  },
  { name: 'V', unicode: 0x56, lsb: 0.3, rsb: 0.3, draw: (g) => vee(g, 0, g.wide(11), g.cap, 0) },
  {
    name: 'W',
    unicode: 0x57,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(15);
      return [...vee(g, 0, w / 2, g.cap, 0), ...vee(g, w / 2, w, g.cap, 0)].map((s, i) =>
        i === 1 || i === 2 ? { ...s, points: s.points.map((q) => (q.y === g.cap ? { ...q, y: 10.5 } : q)) } : s,
      );
    },
  },
  {
    name: 'X',
    unicode: 0x58,
    lsb: 0.4,
    rsb: 0.4,
    draw: (g) => {
      const w = g.wide(10);
      return [diagonal(g, 0, g.cap, w, 0), diagonal(g, w, g.cap, 0, 0)];
    },
  },
  {
    name: 'Y',
    unicode: 0x59,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(11);
      return [...vee(g, 0, w, g.cap, 6), stem(w / 2, 0, 6)];
    },
  },
  { name: 'Z', unicode: 0x5a, lsb: 0.75, rsb: 0.75, draw: (g) => zed(g, g.wide(10), g.cap) },
];

const LOWER_DEFS: GlyphDef[] = [
  {
    name: 'a',
    unicode: 0x61,
    lsb: 1,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.xHeight);
      return [open(p(0, t), p(w, t, true), p(w, 0)), box(0, w, g.bottom(0), 5.25, LEFT)];
    },
  },
  {
    name: 'b',
    unicode: 0x62,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [stem(0, 0, g.ascender), box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), RIGHT)],
  },
  {
    name: 'c',
    unicode: 0x63,
    lsb: 1.25,
    rsb: 0.9,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return [open(p(w, 7), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 3))];
    },
  },
  {
    name: 'd',
    unicode: 0x64,
    lsb: 1.25,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      return [stem(w, 0, g.ascender), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT)];
    },
  },
  {
    name: 'e',
    unicode: 0x65,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return [open(p(0, 5.25), p(w, 5.25), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 2.5))];
    },
  },
  {
    name: 'f',
    unicode: 0x66,
    lsb: 0.5,
    rsb: 0.2,
    draw: (g) => {
      const t = g.top(g.ascender);
      return [open(p(0, 0), p(0, t, true), p(g.wide(4), t)), bar(-1.5, g.wide(3.5), g.top(g.xHeight))];
    },
  },
  {
    name: 'g',
    unicode: 0x67,
    lsb: 1.25,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      const d = g.bottom(g.descender);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), LEFT), open(p(w, g.xHeight), p(w, d, true), p(0, d, true), p(0, -1.5))];
    },
  },
  {
    name: 'h',
    unicode: 0x68,
    lsb: 1.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      return [stem(0, 0, g.ascender), open(p(0, t), p(w, t, true), p(w, 0))];
    },
  },
  {
    name: 'i',
    unicode: 0x69,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => [stem(0, 0, g.xHeight), dot(g, 0, g.xHeight + 1.5)],
  },
  {
    name: 'j',
    unicode: 0x6a,
    lsb: 0.5,
    rsb: 1.5,
    draw: (g) => {
      const d = g.bottom(g.descender);
      return [open(p(0, g.xHeight), p(0, d, true), p(-2.5, d)), dot(g, 0, g.xHeight + 1.5)];
    },
  },
  {
    name: 'k',
    unicode: 0x6b,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(7.5);
      const y0 = 3;
      const reach = w + g.v / 2 - g.foot(w, g.xHeight - y0);
      const t = 0.45;
      return [
        stem(0, 0, g.ascender),
        withPen(level(open(p(0, y0), p(reach, g.xHeight)), false, true), g.diag),
        diagonal(g, reach * t, y0 + (g.xHeight - y0) * t, reach, 0, [false, true]),
      ];
    },
  },
  { name: 'l', unicode: 0x6c, lsb: 1.5, rsb: 1.5, draw: (g) => [stem(0, 0, g.ascender)] },
  {
    name: 'm',
    unicode: 0x6d,
    lsb: 1.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(6.5);
      const t = g.top(g.xHeight);
      return [stem(0, 0, g.xHeight), open(p(0, t), p(w, t), p(w, 0)), open(p(w, t), p(2 * w, t, true), p(2 * w, 0))];
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
    draw: (g) => [box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), ALL)],
  },
  {
    name: 'p',
    unicode: 0x70,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [stem(0, g.descender, g.xHeight), box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), RIGHT)],
  },
  {
    name: 'q',
    unicode: 0x71,
    lsb: 1.25,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      return [stem(w, g.descender, g.xHeight), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT)];
    },
  },
  {
    name: 'r',
    unicode: 0x72,
    lsb: 1.5,
    rsb: 0.4,
    draw: (g) => [stem(0, 0, g.xHeight), bar(0, g.wide(5), g.top(g.xHeight))],
  },
  {
    name: 's',
    unicode: 0x73,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return [open(p(w, 7.5), p(w, t, true), p(0, t, true), p(0, 5, true), p(w, 5, true), p(w, b, true), p(0, b, true), p(0, 2.5))];
    },
  },
  {
    name: 't',
    unicode: 0x74,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const b = g.bottom(0);
      return [open(p(0, 13), p(0, b, true), p(g.wide(3.5), b)), bar(-2, g.wide(3.5), g.top(g.xHeight))];
    },
  },
  {
    name: 'u',
    unicode: 0x75,
    lsb: 1.4,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(7);
      return [open(p(0, g.xHeight), p(0, g.bottom(0), true), p(w, g.bottom(0))), stem(w, 0, g.xHeight)];
    },
  },
  { name: 'v', unicode: 0x76, lsb: 0.3, rsb: 0.3, draw: (g) => vee(g, 0, g.wide(8.5), g.xHeight, 0) },
  {
    name: 'w',
    unicode: 0x77,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(12);
      return [...vee(g, 0, w / 2, g.xHeight, 0), ...vee(g, w / 2, w, g.xHeight, 0)].map((s, i) =>
        i === 1 || i === 2 ? { ...s, points: s.points.map((q) => (q.y === g.xHeight ? { ...q, y: 7.5 } : q)) } : s,
      );
    },
  },
  {
    name: 'x',
    unicode: 0x78,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(8);
      return [diagonal(g, 0, g.xHeight, w, 0), diagonal(g, w, g.xHeight, 0, 0)];
    },
  },
  {
    name: 'y',
    unicode: 0x79,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(8.5);
      const tail = (w / 2) * (-g.descender / g.xHeight);
      return [diagonal(g, 0, g.xHeight, w / 2, 0), diagonal(g, w, g.xHeight, w / 2 - tail, g.descender)];
    },
  },
  { name: 'z', unicode: 0x7a, lsb: 0.75, rsb: 0.75, draw: (g) => zed(g, g.wide(7.5), g.xHeight) },
];
const LOWER: GlyphDef[] = LOWER_DEFS.map((def) => ({ ...def, lower: true }));

const FIGURES: GlyphDef[] = [
  {
    name: 'zero',
    unicode: 0x30,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(9), g.bottom(0), g.top(g.cap), ALL)],
  },
  {
    name: 'one',
    unicode: 0x31,
    lsb: 1,
    rsb: 1.5,
    draw: (g) => {
      const x = 3;
      return [stem(x, 0, g.cap), withPen(level(open(p(0, g.cap - 3), p(x + g.v / 2 - g.foot(3, 3), g.cap)), false, true), g.diag)];
    },
  },
  {
    name: 'two',
    unicode: 0x32,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const end = g.foot(w, 7.5 - b) - g.v / 2;
      return [level(open(p(0, 10), p(0, t, true), p(w, t, true), p(w, 7.5), p(end, b)), false, true), bar(0, w, b)];
    },
  },
  {
    name: 'three',
    unicode: 0x33,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const m = g.cap / 2;
      return [open(p(0, 10), p(0, t, true), p(w, t, true), p(w, m), p(w * 0.35, m)), open(p(w, m), p(w, b, true), p(0, b, true), p(0, 4))];
    },
  },
  {
    name: 'four',
    unicode: 0x34,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      const x = w * 0.72;
      const y = 4.5;
      return [stem(x, 0, g.cap), bar(0, w, y), diagonal(g, x + g.v / 2 - g.foot(x, g.cap - y), g.cap, g.foot(x, g.cap - y), y)];
    },
  },
  {
    name: 'five',
    unicode: 0x35,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [open(p(w, t), p(0, t), p(0, 8), p(w, 8, true), p(w, b, true), p(0, b, true), p(0, 4))];
    },
  },
  {
    name: 'six',
    unicode: 0x36,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [open(p(w, Math.max(10.5, 8 + g.h / 2 + g.aperture)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 8, true), p(0, 8))];
    },
  },
  {
    name: 'seven',
    unicode: 0x37,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(9);
      return [bar(0, w, g.top(g.cap)), diagonal(g, w - g.foot(w * 0.65, g.cap), g.cap, w * 0.35, 0)];
    },
  },
  {
    name: 'eight',
    unicode: 0x38,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(9.5);
      return [box(0.5, w - 0.5, g.cap / 2, g.top(g.cap), ALL), box(0, w, g.bottom(0), g.cap / 2, ALL)];
    },
  },
  {
    name: 'nine',
    unicode: 0x39,
    lsb: 1,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [open(p(0, Math.min(3.5, 6 - g.h / 2 - g.aperture)), p(0, b, true), p(w, b, true), p(w, t, true), p(0, t, true), p(0, 6, true), p(w, 6))];
    },
  },
];

/** Math sits on this centre line, the hyphen and strikeout on the x-height's middle. */
const MATH_AXIS = 6;
const DASH_AXIS = METRICS.xHeight / 2;

const PUNCTUATION: GlyphDef[] = [
  { name: 'period', unicode: 0x2e, lsb: 1.25, rsb: 1.25, draw: (g) => [dot(g, 0, 0)] },
  {
    name: 'comma',
    unicode: 0x2c,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [withPen(level(open(p(0.6, g.dot), p(-0.6, -2.5))), { v: g.dot * 0.9, h: g.dot * 0.9 })],
  },
  { name: 'colon', unicode: 0x3a, lsb: 1.25, rsb: 1.25, draw: (g) => [dot(g, 0, 0), dot(g, 0, g.xHeight - g.dot)] },
  {
    name: 'semicolon',
    unicode: 0x3b,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [withPen(level(open(p(0.6, g.dot), p(-0.6, -2.5))), { v: g.dot * 0.9, h: g.dot * 0.9 }), dot(g, 0.6, g.xHeight - g.dot)],
  },
  { name: 'exclam', unicode: 0x21, lsb: 1.5, rsb: 1.5, draw: (g) => [stem(0, g.dot + 1.5, g.cap), dot(g, 0, 0)] },
  {
    name: 'question',
    unicode: 0x3f,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.cap);
      const x = w / 2;
      const arm = Math.min(8.5, g.cap - g.h * 1.5 - g.aperture);
      return [open(p(0, 10.5), p(0, t, true), p(w, t, true), p(w, arm, true), p(x, arm, true), p(x, g.dot + 1.5)), dot(g, x, 0)];
    },
  },
  { name: 'hyphen', unicode: 0x2d, lsb: 1, rsb: 1, draw: (g) => [bar(0, g.wide(4.5), DASH_AXIS)] },
  { name: 'endash', unicode: 0x2013, lsb: 0.5, rsb: 0.5, draw: () => [bar(0, 9, DASH_AXIS)] },
  { name: 'emdash', unicode: 0x2014, lsb: 1, rsb: 1, draw: () => [bar(0, 18, DASH_AXIS)] },
  { name: 'quotesingle', unicode: 0x27, lsb: 1.25, rsb: 1.25, draw: (g) => [stem(0, g.cap - 4, g.cap)] },
  {
    name: 'quotedbl',
    unicode: 0x22,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [stem(0, g.cap - 4, g.cap), stem(g.v + 1.5, g.cap - 4, g.cap)],
  },
  {
    name: 'parenleft',
    unicode: 0x28,
    lsb: 1.5,
    rsb: 0.75,
    draw: () => {
      const w = 3.5;
      return [level(open(p(w, 15.5), p(0, 15.5 - w), p(0, -3.5 + w), p(w, -3.5)))];
    },
  },
  {
    name: 'parenright',
    unicode: 0x29,
    lsb: 0.75,
    rsb: 1.5,
    draw: () => {
      const w = 3.5;
      return [level(open(p(0, 15.5), p(w, 15.5 - w), p(w, -3.5 + w), p(0, -3.5)))];
    },
  },
  {
    name: 'bracketleft',
    unicode: 0x5b,
    lsb: 1.5,
    rsb: 0.75,
    draw: (g) => [open(p(g.wide(4), g.top(15.5)), p(0, g.top(15.5)), p(0, g.bottom(-3.5)), p(g.wide(4), g.bottom(-3.5)))],
  },
  {
    name: 'bracketright',
    unicode: 0x5d,
    lsb: 0.75,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(4);
      return [open(p(0, g.top(15.5)), p(w, g.top(15.5)), p(w, g.bottom(-3.5)), p(0, g.bottom(-3.5)))];
    },
  },
  { name: 'slash', unicode: 0x2f, lsb: 0.25, rsb: 0.25, draw: (g) => [diagonal(g, 0, -3.5, 7, 15.5)] },
  { name: 'underscore', unicode: 0x5f, lsb: 0, rsb: 0, draw: (g) => [bar(0, 10, g.top(-2))] },
  {
    name: 'plus',
    unicode: 0x2b,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      return [bar(0, w, MATH_AXIS), stem(w / 2, MATH_AXIS - w / 2, MATH_AXIS + w / 2)];
    },
  },
  {
    name: 'equal',
    unicode: 0x3d,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const gap = 1.75 + g.h / 2;
      return [bar(0, w, MATH_AXIS + gap), bar(0, w, MATH_AXIS - gap)];
    },
  },
];

const NOTDEF: GlyphDef = {
  name: '.notdef',
  lsb: 1,
  rsb: 1,
  draw: (g) => [box(0, g.wide(7), g.bottom(0), g.top(g.cap), [false, false, false, false])],
};

export const GLYPHS: GlyphDef[] = [NOTDEF, ...UPPER, ...LOWER, ...FIGURES, ...PUNCTUATION];

export const SPACES: SpaceDef[] = [{ name: 'space', unicode: 0x20, advance: 5 }];

/** How far stem centres move apart per unit of stem beyond SemiBold's 2. */
const GROWTH = 0.5;
/** Diagonals are drawn this much lighter than stems, so they look as heavy. */
const DIAGONAL_WEIGHT = 0.92;

/** The least opening between a terminal and the stroke it turns toward, as in 6, 9 and ?. */
const APERTURE = 1.6;

export function drawContext(v: number, hc: number, lower = false): DrawContext {
  const cut = lower ? CUT_OUTER_LOWER : CUT_OUTER;
  const diag = { v: v * DIAGONAL_WEIGHT, h: hc * DIAGONAL_WEIGHT };
  return {
    v,
    h: hc,
    pen: { v, h: hc, cut },
    diag,
    dot: v * 1.1 + 0.2,
    aperture: APERTURE,
    wide: (n) => n + GROWTH * (v - 2),
    top: (y) => y - hc / 2,
    bottom: (y) => y + hc / 2,
    foot: (dx, dy) => Math.hypot(diag.v * dy, diag.h * dx) / (2 * Math.abs(dy)),
    cap: METRICS.cap,
    xHeight: METRICS.xHeight,
    ascender: METRICS.ascender,
    descender: METRICS.descender,
  };
}
