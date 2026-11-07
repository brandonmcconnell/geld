import {
  ALL,
  bar,
  box,
  angleLeft,
  chevronLeft,
  level,
  diagonal,
  type DrawContext,
  type GlyphDef,
  hollow,
  MATH_AXIS,
  mirror,
  octagon,
  octagonLeg,
  open,
  p,
  rotate,
  solid,
  stem,
  withPen,
  spanOf,
  INSIDE,
  edgeAt,
  crossbarReach,
} from './draw';
import type { PathPoint, Stroke } from './geometry';

/** Arrows: one right-pointing arrow on the math axis, turned for the other seven directions. */
const ARROW_LENGTH = 12;
const HEAD = 4;

/** The shaft stops inside the head, so nothing shows through the point. */
function arrowRight(heads: { start?: boolean; end?: boolean } = { end: true }): Stroke[] {
  const y = MATH_AXIS;
  const inset = HEAD / 2;
  const out: Stroke[] = [bar(heads.start ? inset : 0, heads.end ? ARROW_LENGTH - inset : ARROW_LENGTH, y)];
  const head = (x: number, dir: 1 | -1) => open(p(x - dir * HEAD, y + HEAD), p(x, y), p(x - dir * HEAD, y - HEAD));
  if (heads.end) out.push(head(ARROW_LENGTH, 1));
  if (heads.start) out.push(head(0, -1));
  return out;
}

const turned = (deg: number, heads?: { start?: boolean; end?: boolean }) => rotate(arrowRight(heads), deg, ARROW_LENGTH / 2, MATH_AXIS);

const arrow = (name: string, unicode: number, deg: number, heads?: { start?: boolean; end?: boolean }): GlyphDef => ({
  name,
  unicode,
  lsb: 1,
  rsb: 1,
  draw: () => turned(deg, heads),
});

/** Geometric shapes sit on the math axis; large ones are 10 units, small ones 5. */
const BIG = 10;
const SMALL = 5.5;

const squarePts = (size: number): PathPoint[] => {
  const r = size / 2;
  return [p(0, MATH_AXIS - r), p(size, MATH_AXIS - r), p(size, MATH_AXIS + r), p(0, MATH_AXIS + r)];
};
const trianglePts = (size: number, deg: number): PathPoint[] => {
  const h = size * 0.9;
  const pts = [p(0, MATH_AXIS - h / 2), p(size, MATH_AXIS - h / 2), p(size / 2, MATH_AXIS + h / 2)];
  const turnedPts = rotate([{ points: pts, closed: true }], deg, size / 2, MATH_AXIS)[0]!.points;
  const minX = Math.min(...turnedPts.map((q) => q.x));
  return turnedPts.map((q) => ({ ...q, x: q.x - minX }));
};
const diamondPts = (w: number, h: number, cut = true): PathPoint[] => [p(w / 2, MATH_AXIS - h / 2, cut), p(w, MATH_AXIS, cut), p(w / 2, MATH_AXIS + h / 2, cut), p(0, MATH_AXIS, cut)];

const shape = (name: string, unicode: number, draw: (g: DrawContext) => Stroke[]): GlyphDef => ({ name, unicode, lsb: 1, rsb: 1, draw });
const wall = (g: DrawContext) => Math.max(g.v, g.h) * 0.85;

const TRIANGLES: [string, number, number, boolean, boolean][] = [
  ['blackuppointingtriangle', 0x25b2, 0, true, true],
  ['whiteuppointingtriangle', 0x25b3, 0, false, true],
  ['blackuppointingsmalltriangle', 0x25b4, 0, true, false],
  ['whiteuppointingsmalltriangle', 0x25b5, 0, false, false],
  ['blackrightpointingtriangle', 0x25b6, -90, true, true],
  ['whiterightpointingtriangle', 0x25b7, -90, false, true],
  ['blackrightpointingsmalltriangle', 0x25b8, -90, true, false],
  ['whiterightpointingsmalltriangle', 0x25b9, -90, false, false],
  ['blackdownpointingtriangle', 0x25bc, 180, true, true],
  ['whitedownpointingtriangle', 0x25bd, 180, false, true],
  ['blackdownpointingsmalltriangle', 0x25be, 180, true, false],
  ['whitedownpointingsmalltriangle', 0x25bf, 180, false, false],
  ['blackleftpointingtriangle', 0x25c0, 90, true, true],
  ['whiteleftpointingtriangle', 0x25c1, 90, false, true],
  ['blackleftpointingsmalltriangle', 0x25c2, 90, true, false],
  ['whiteleftpointingsmalltriangle', 0x25c3, 90, false, false],
];

/**
 * Σ and ∑: the bars, and two diagonals from the bars' left corners, ends level and flush with the
 * bars' outer edges so the corners are solid, meeting in a point on the right.
 */
export function sigma(g: DrawContext, w: number): Stroke[] {
  const t = g.top(g.cap);
  const b = g.bottom(0);
  const tip = w * 0.55;
  const half = g.cap / 2;
  let e = spanOf(g.diag, tip, half);
  for (let i = 0; i < 6; i++) e = spanOf(g.diag, tip - e, half);
  const topStart = edgeAt(g.diag, e, g.cap, tip, half, g.cap - g.h, -1) + INSIDE;
  const bottomStart = edgeAt(g.diag, e, 0, tip, half, g.h, -1) + INSIDE;
  return [bar(topStart, w, t), bar(bottomStart, w, b), withPen(level(open(p(e, g.cap), p(tip, half), p(e, 0))), g.diag)];
}

export const PLUS: GlyphDef[] = [
  arrow('arrowleft', 0x2190, 180),
  arrow('arrowup', 0x2191, 90),
  arrow('arrowright', 0x2192, 0),
  arrow('arrowdown', 0x2193, -90),
  arrow('arrowboth', 0x2194, 0, { start: true, end: true }),
  arrow('arrowupdn', 0x2195, 90, { start: true, end: true }),
  arrow('arrowupleft', 0x2196, 135),
  arrow('arrowupright', 0x2197, 45),
  arrow('arrowdownright', 0x2198, -45),
  arrow('arrowdownleft', 0x2199, -135),

  shape('filledbox', 0x25a0, () => [solid(squarePts(BIG))]),
  shape('whitesquare', 0x25a1, (g) => [hollow(squarePts(BIG), wall(g))]),
  shape('blacksmallsquare', 0x25aa, () => [solid(squarePts(SMALL), 0.75)]),
  shape('whitesmallsquare', 0x25ab, (g) => [hollow(squarePts(SMALL), wall(g) * 0.8, 0.75)]),
  ...TRIANGLES.map(([name, unicode, deg, filled, big]) =>
    shape(name, unicode, (g) => {
      const pts = trianglePts(big ? BIG : SMALL + 1, deg);
      return [filled ? solid(pts) : hollow(pts, wall(g) * (big ? 1 : 0.8))];
    }),
  ),
  shape('blackdiamond', 0x25c6, () => [solid(diamondPts(BIG, BIG), 1.5)]),
  shape('whitediamond', 0x25c7, (g) => [hollow(diamondPts(BIG, BIG), wall(g), 1.5)]),
  shape('lozenge', 0x25ca, (g) => [hollow(diamondPts(7, 12, false), wall(g))]),
  shape('whitecircle', 0x25cb, (g) => [hollow(octagon(BIG / 2, MATH_AXIS, BIG), wall(g), octagonLeg(BIG))]),
  shape('blackcircle', 0x25cf, () => [solid(octagon(BIG / 2, MATH_AXIS, BIG), octagonLeg(BIG))]),
  shape('whitebullet', 0x25e6, (g) => [hollow(octagon(SMALL / 2, MATH_AXIS, SMALL), wall(g) * 0.8, octagonLeg(SMALL))]),
  shape('dottedcircle', 0x25cc, (g) => {
    const size = Math.min(g.dot, 2);
    const r = BIG / 2 - size / 2;
    return Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      const x = BIG / 2 + r * Math.cos(a);
      const y = MATH_AXIS + r * Math.sin(a) - size / 2;
      return withPen(open(p(x, y), p(x, y + size)), { v: size, h: size });
    });
  }),

  {
    name: 'partialdiff',
    unicode: 0x2202,
    lsb: 1,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return mirror([open(p(w, 10.5), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 8, true), p(0, 8))], w / 2);
    },
  },
  {
    name: 'emptyset',
    unicode: 0x2205,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      return [box(0, w, MATH_AXIS - 5 + g.h / 2, MATH_AXIS + 5 - g.h / 2, ALL), diagonal(g, -0.5, MATH_AXIS - 6.5, w + 0.5, MATH_AXIS + 6.5)];
    },
  },
  {
    name: 'increment',
    unicode: 0x2206,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(11);
      return [diagonal(g, 0, 0, w / 2, g.cap), diagonal(g, w, 0, w / 2, g.cap), bar(g.foot(w / 2, g.cap) - 0.5, w - g.foot(w / 2, g.cap) + 0.5, g.bottom(0))];
    },
  },
  {
    name: 'product',
    unicode: 0x220f,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      return [bar(-crossbarReach(g), w + crossbarReach(g), g.top(g.cap)), stem(0, 0, g.cap), stem(w, 0, g.cap)];
    },
  },
  {
    name: 'summation',
    unicode: 0x2211,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      return sigma(g, w);
    },
  },
  {
    name: 'radical',
    unicode: 0x221a,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(11);
      const t = g.top(g.cap + 1);
      const x = 4.5;
      return [
        withPen(open(p(0, 6), p(x, 0)), g.diag),
        withPen({ points: [p(x, 0), p(w * 0.65, t)], closed: false, startCap: 'flat' }, g.diag),
        bar(w * 0.65 - g.foot(w * 0.65 - x, t), w, t),
      ];
    },
  },
  {
    name: 'infinity',
    unicode: 0x221e,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const size = Math.max(4.5, Math.max(g.v, g.h) + 2.5);
      const y0 = MATH_AXIS - size / 2;
      return [box(0, size, y0, y0 + size, ALL), box(size, 2 * size, y0, y0 + size, ALL)];
    },
  },
  {
    name: 'integral',
    unicode: 0x222b,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const t = g.top(g.cap);
      const b = g.bottom(-2);
      return [open(p(-2.5, b), p(0, b, true), p(0, t, true), p(2.5, t))];
    },
  },
  {
    name: 'approxequal',
    unicode: 0x2248,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const s = 2.25 + Math.max(0, g.v - 2) * 0.6;
      const pen = { ...g.pen, cut: Math.min(g.pen.cut ?? 2, s * 0.45) };
      const tilde = (y: number) => withPen(open(p(0, y), p(s, y + s, true), p(2 * s, y, true), p(3 * s, y + s)), pen);
      const low = MATH_AXIS - (2 * s + 1.5 * g.v + 1.6) / 2;
      return [tilde(low + s + 1.5 * g.v + 1.6), tilde(low)];
    },
  },
  {
    name: 'notequal',
    unicode: 0x2260,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const gap = 1.75 + g.h / 2;
      return [bar(0, w, MATH_AXIS + gap), bar(0, w, MATH_AXIS - gap), withPen(open(p(w * 0.3, MATH_AXIS - 5.5), p(w * 0.7, MATH_AXIS + 5.5)), g.diag)];
    },
  },
  {
    name: 'lessequal',
    unicode: 0x2264,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const s = 4;
      return [...chevronLeft(g, s, MATH_AXIS + 1.5), bar(-g.v * 0.7, s + g.v * 0.35, g.bottom(0))];
    },
  },
  {
    name: 'greaterequal',
    unicode: 0x2265,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const s = 4;
      return [...mirror(chevronLeft(g, s, MATH_AXIS + 1.5), s / 2), bar(-g.v * 0.35, s + g.v * 0.7, g.bottom(0))];
    },
  },
  {
    name: 'angleleft',
    unicode: 0x27e8,
    lsb: 1.25,
    rsb: 0.75,
    draw: (g) => angleLeft(g, 4, 6, 9.5),
  },
  {
    name: 'angleright',
    unicode: 0x27e9,
    lsb: 0.75,
    rsb: 1.25,
    draw: (g) => mirror(angleLeft(g, 4, 6, 9.5), 2),
  },
  {
    name: 'dagger',
    unicode: 0x2020,
    lsb: 1,
    rsb: 1,
    draw: (g) => [stem(3, -3, g.cap), bar(0, 6, 9.5)],
  },
  {
    name: 'daggerdbl',
    unicode: 0x2021,
    lsb: 1,
    rsb: 1,
    draw: (g) => [stem(3, -3, g.cap), bar(0, 6, 9.5), bar(0, 6, 1.5)],
  },
  { name: 'dblverticalbar', unicode: 0x2016, lsb: 1.5, rsb: 1.5, draw: (g) => [stem(0, -3.5, 15.5), stem(g.v + 1.75, -3.5, 15.5)] },
  {
    name: 'minute',
    unicode: 0x2032,
    lsb: 1,
    rsb: 1,
    draw: (g) => [diagonal(g, 0, g.cap - 4.5, 1.25, g.cap)],
  },
  {
    name: 'second',
    unicode: 0x2033,
    lsb: 1,
    rsb: 1,
    draw: (g) => [diagonal(g, 0, g.cap - 4.5, 1.25, g.cap), diagonal(g, g.v + 1.5, g.cap - 4.5, g.v + 2.75, g.cap)],
  },
  {
    name: 'perthousand',
    unicode: 0x2030,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(12);
      const size = Math.max(g.v, g.h) + Math.max(1.6, 4.4 - Math.max(g.v, g.h));
      const e = g.foot(w, g.cap);
      const ring = (x: number, y: number) => box(x, x + size, y + g.h / 2, y + g.h / 2 + size, ALL);
      return [ring(0, g.cap - size - g.h), ring(w - size, 0), ring(w + g.v + 1.4, 0), diagonal(g, w - e, g.cap, e, 0)];
    },
  },
];

