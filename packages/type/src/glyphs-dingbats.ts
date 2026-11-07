import { bar, diagonal, type DrawContext, dot, type GlyphDef, hollow, MATH_AXIS, octagon, octagonLeg, open, p, solid, stem, withPen } from './draw';
import type { PathPoint, Stroke } from './geometry';
import { METRICS } from './grid';

/**
 * Shapes, marks, box drawing and ornaments (3.7). Shapes and marks sit on the math axis and are spaced by their ink;
 * box drawing and blocks fill a fixed 12-unit cell over the whole line box, so lines run on from glyph to glyph.
 */
const BIG = 10;
const at = (x: number, y: number, cut = false) => p(x, MATH_AXIS - BIG / 2 + y, cut);
const def = (name: string, unicode: number | undefined, draw: (g: DrawContext) => Stroke[]): GlyphDef => ({ name, ...(unicode === undefined ? {} : { unicode }), lsb: 1, rsb: 1, draw });
const wall = (g: DrawContext) => Math.max(g.v, g.h) * 0.85;
const fill = (points: PathPoint[]): Stroke => ({ points, closed: true, fill: true, pen: { v: 0, h: 0 } });
const heavy = (g: DrawContext) => ({ v: g.v * 1.7, h: g.h * 1.7 });

/** A circle-octagon of BIG with the half or quarter given filled (◐ ◑ ◒ ◓). */
function halfFilled(g: DrawContext, side: 'left' | 'right' | 'bottom' | 'top'): Stroke[] {
  const leg = octagonLeg(BIG);
  const ring: PathPoint[] = [at(leg, 0), at(BIG - leg, 0), at(BIG, leg), at(BIG, BIG - leg), at(BIG - leg, BIG), at(leg, BIG), at(0, BIG - leg), at(0, leg)];
  const half = {
    left: [at(BIG / 2, 0), at(BIG / 2, BIG), at(leg, BIG), at(0, BIG - leg), at(0, leg), at(leg, 0)],
    right: [at(BIG / 2, 0), at(BIG - leg, 0), at(BIG, leg), at(BIG, BIG - leg), at(BIG - leg, BIG), at(BIG / 2, BIG)],
    bottom: [at(0, BIG / 2), at(0, leg), at(leg, 0), at(BIG - leg, 0), at(BIG, leg), at(BIG, BIG / 2)],
    top: [at(0, BIG / 2), at(BIG, BIG / 2), at(BIG, BIG - leg), at(BIG - leg, BIG), at(leg, BIG), at(0, BIG - leg)],
  }[side];
  return [hollow(ring, wall(g), 0), fill(half)];
}

/** A five-pointed star of radius r about (cx, cy), its inner corners at 0.4 r. */
function starPoints(cx: number, cy: number, r: number): PathPoint[] {
  return Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.4 : r;
    return p(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  });
}

/** ♥ from 45° sides: two square lobes over a point. */
const HEART = [p(5, 0), p(0, 5), p(0, 8.5), p(1.5, 10), p(3.5, 10), p(5, 8.5), p(6.5, 10), p(8.5, 10), p(10, 8.5), p(10, 5)].map((q) => p(q.x, q.y + MATH_AXIS - 5));

export const DINGBATS: GlyphDef[] = [
  def('blackrectangle', 0x25ac, () => [fill([at(-1, 2.5), at(BIG + 1, 2.5), at(BIG + 1, 7.5), at(-1, 7.5)])]),
  def('fisheye', 0x25c9, (g) => [hollow(octagon(BIG / 2, MATH_AXIS, BIG), Math.min(wall(g), 1.8), octagonLeg(BIG)), solid(octagon(BIG / 2, MATH_AXIS, 4), octagonLeg(4))]),
  def('circlelefthalfblack', 0x25d0, (g) => halfFilled(g, 'left')),
  def('circlerighthalfblack', 0x25d1, (g) => halfFilled(g, 'right')),
  def('circlebottomhalfblack', 0x25d2, (g) => halfFilled(g, 'bottom')),
  def('circletophalfblack', 0x25d3, (g) => halfFilled(g, 'top')),
  def('blacklowerrighttriangle', 0x25e2, () => [fill([at(0, 0), at(BIG, 0), at(BIG, BIG)])]),
  def('blacklowerlefttriangle', 0x25e3, () => [fill([at(0, 0), at(BIG, 0), at(0, BIG)])]),
  def('blackupperlefttriangle', 0x25e4, () => [fill([at(0, 0), at(BIG, BIG), at(0, BIG)])]),
  def('blackupperrighttriangle', 0x25e5, () => [fill([at(BIG, 0), at(BIG, BIG), at(0, BIG)])]),

  def('checkmark', 0x2713, () => [open(at(0, 4.5), at(3, 1.5), at(BIG + 1, 9.5))]),
  def('heavycheckmark', 0x2714, (g) => [withPen(open(at(0, 4.5), at(3, 1.5), at(BIG + 1, 9.5)), heavy(g))]),
  def('ballotx', 0x2717, (g) => [diagonal(g, 0, MATH_AXIS - 5, BIG, MATH_AXIS + 5), diagonal(g, 0.75, MATH_AXIS + 5, BIG - 0.75, MATH_AXIS - 5)]),
  def('heavyballotx', 0x2718, (g) => [withPen(diagonal(g, 0, MATH_AXIS - 5, BIG, MATH_AXIS + 5), heavy(g)), withPen(diagonal(g, 0.75, MATH_AXIS + 5, BIG - 0.75, MATH_AXIS - 5), heavy(g))]),
  def('multiplicationx', 0x2715, (g) => [diagonal(g, 0, MATH_AXIS - 4, 8, MATH_AXIS + 4), diagonal(g, 0, MATH_AXIS + 4, 8, MATH_AXIS - 4)]),
  def('heavymultiplicationx', 0x2716, (g) => [withPen(diagonal(g, 0, MATH_AXIS - 4, 8, MATH_AXIS + 4), heavy(g)), withPen(diagonal(g, 0, MATH_AXIS + 4, 8, MATH_AXIS - 4), heavy(g))]),
  def('blackstar', 0x2605, () => [fill(starPoints(6, MATH_AXIS, 6.5))]),
  // The outline stroked, its pen capped: an inset of the concave star leaves steps at its inner corners.
  def('whitestar', 0x2606, (g) => {
    const t = Math.min(wall(g), 1.4);
    return [withPen({ points: starPoints(6, MATH_AXIS, 6.5 - t), closed: true }, { v: t, h: t })];
  }),
  def('blackheartsuit', 0x2665, () => [fill(HEART)]),
  def('blackflag', 0x2691, () => [stem(0, 0, METRICS.cap), fill([p(0, 8), p(8, 8), p(8, METRICS.cap), p(0, METRICS.cap)])]),
  def('warningsign', 0x26a0, (g) => {
    const pen = { v: Math.min(g.v, 2), h: Math.min(g.h, 2) };
    // The exclamation stays low in the triangle, where it is wide, clear of the walls at every weight.
    return [hollow([p(0, 0), p(16, 0), p(8, 14)], Math.min(wall(g), 1.7), 0), withPen(stem(8, 5.6, 7.75), pen), withPen(dot({ ...g, dot: pen.v * 1.1 + 0.2 }, 8, 2.4), pen)];
  }),
];

/** Box drawing (a basic set in Sans; the full set is Mono's) and block elements. */
const CELL = 12;
const [LOW, HIGH] = [METRICS.lineDescender, METRICS.lineAscender];
const MID = (LOW + HIGH) / 2;
const cell = (name: string, unicode: number, draw: (g: DrawContext) => Stroke[]): GlyphDef => ({
  name,
  unicode,
  lsb: 0,
  rsb: 0,
  frame: () => ({ origin: 0, advance: CELL }),
  draw,
});
type Arm = 'l' | 'r' | 'u' | 'd';
/** A light or heavy line from the cell's middle to each edge named. */
function lines(arms: Arm[], weight: 'light' | 'heavy') {
  return (g: DrawContext) => {
    const pen = weight === 'heavy' ? heavy(g) : { v: g.v, h: g.h };
    const c = CELL / 2;
    const strokes: Stroke[] = [];
    // Each line runs a pen's width past the middle, so the arms meet at a solid crossing.
    for (const arm of arms) {
      if (arm === 'l' || arm === 'r') strokes.push(withPen(bar(arm === 'l' ? 0 : c - pen.v / 2, arm === 'l' ? c + pen.v / 2 : CELL, MID), pen));
      else strokes.push(withPen(stem(c, arm === 'd' ? LOW : MID - pen.h / 2, arm === 'd' ? MID + pen.h / 2 : HIGH), pen));
    }
    return strokes;
  };
}
const BOX: [string, number, Arm[]][] = [
  ['uni2500', 0x2500, ['l', 'r']],
  ['uni2502', 0x2502, ['u', 'd']],
  ['uni250C', 0x250c, ['r', 'd']],
  ['uni2510', 0x2510, ['l', 'd']],
  ['uni2514', 0x2514, ['r', 'u']],
  ['uni2518', 0x2518, ['l', 'u']],
  ['uni251C', 0x251c, ['u', 'd', 'r']],
  ['uni2524', 0x2524, ['u', 'd', 'l']],
  ['uni252C', 0x252c, ['l', 'r', 'd']],
  ['uni2534', 0x2534, ['l', 'r', 'u']],
  ['uni253C', 0x253c, ['l', 'r', 'u', 'd']],
];
const HEAVY_BOX: [string, number, Arm[]][] = [
  ['uni2501', 0x2501, ['l', 'r']],
  ['uni2503', 0x2503, ['u', 'd']],
  ['uni250F', 0x250f, ['r', 'd']],
  ['uni2513', 0x2513, ['l', 'd']],
  ['uni2517', 0x2517, ['r', 'u']],
  ['uni251B', 0x251b, ['l', 'u']],
  ['uni2523', 0x2523, ['u', 'd', 'r']],
  ['uni252B', 0x252b, ['u', 'd', 'l']],
  ['uni2533', 0x2533, ['l', 'r', 'd']],
  ['uni253B', 0x253b, ['l', 'r', 'u']],
  ['uni254B', 0x254b, ['l', 'r', 'u', 'd']],
];
const rect = (x0: number, y0: number, x1: number, y1: number) => fill([p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]);
/** Shades as grids of squares a quarter, half and three quarters filled. */
function shade(share: 0.25 | 0.5 | 0.75): Stroke[] {
  if (share === 0.75) {
    // Full bands with every other square of the band between: squares that dense would leave hairline gaps.
    const out: Stroke[] = [];
    for (let y = LOW; y < HIGH - 1e-9; y += 2) {
      out.push(rect(0, y, CELL, Math.min(HIGH, y + 1)));
      // Overlapping the bands by half a unit, on the grid SemiBold snaps to, so they never merely touch.
      if (y + 1 < HIGH) for (let x = 0; x < CELL - 1e-9; x += 2) out.push(rect(x, y + 0.5, x + 1, Math.min(HIGH, y + 2.5)));
    }
    return out;
  }
  const step = 2;
  const side = share === 0.25 ? 1 : share === 0.5 ? Math.SQRT2 : Math.sqrt(3);
  const out: Stroke[] = [];
  for (let y = LOW; y < HIGH - 1e-9; y += step)
    for (let x = 0; x < CELL - 1e-9; x += step) {
      const off = share === 0.5 && Math.round((y - LOW) / step) % 2 ? step / 2 : 0;
      const x0 = x + off + (step - side) / 2;
      out.push(rect(x0, y + (step - side) / 2, Math.min(CELL, x0 + side), y + (step + side) / 2));
    }
  return out;
}

export const BOX_DRAWING: GlyphDef[] = [
  ...BOX.map(([name, u, arms]) => cell(name, u, lines(arms, 'light'))),
  ...HEAVY_BOX.map(([name, u, arms]) => cell(name, u, lines(arms, 'heavy'))),
  cell('uni2588', 0x2588, () => [rect(0, LOW, CELL, HIGH)]),
  cell('uni2580', 0x2580, () => [rect(0, MID, CELL, HIGH)]),
  cell('uni2584', 0x2584, () => [rect(0, LOW, CELL, MID)]),
  cell('uni258C', 0x258c, () => [rect(0, LOW, CELL / 2, HIGH)]),
  cell('uni2590', 0x2590, () => [rect(CELL / 2, LOW, CELL, HIGH)]),
  cell('uni2591', 0x2591, () => shade(0.25)),
  cell('uni2592', 0x2592, () => shade(0.5)),
  cell('uni2593', 0x2593, () => shade(0.75)),
];

/** Ornaments (ornm, from the bullet): a cut-corner frame, a double frame, cut-square and diamond bullets and a grid. */
export const ORNAMENTS: GlyphDef[] = [
  def('ornm01', undefined, (g) => [hollow(octagon(6, MATH_AXIS, 12), wall(g), 2.5)]),
  def('ornm02', undefined, (g) => [hollow(octagon(6, MATH_AXIS, 12), Math.min(wall(g), 1.2), 2.5), hollow(octagon(6, MATH_AXIS, 7), Math.min(wall(g), 1.2), 1.5)]),
  def('ornm03', undefined, () => [solid(octagon(3, MATH_AXIS, 6), 1.5)]),
  def('ornm04', undefined, () => [fill([p(3.5, MATH_AXIS - 3.5), p(7, MATH_AXIS), p(3.5, MATH_AXIS + 3.5), p(0, MATH_AXIS)])]),
  def('ornm05', undefined, () => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => solid(octagon(1.5 + i * 4, MATH_AXIS - 4 + j * 4, 3), 0.75)))),
];
