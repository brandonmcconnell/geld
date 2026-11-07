import {
  ALL,
  bar,
  box,
  closed,
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
  meeting,
  tildeStroke,
} from './draw';
import type { PathPoint, Stroke } from './geometry';
import { DARK_INSET_RATIO } from './grid';

/** Arrows: one right-pointing arrow on the math axis, turned for the other seven directions. */
const ARROW_LENGTH = 12;
const HEAD = 4;
/** Double arrows are longer, so the white between their bars still shows between two heads at Black. */
const DOUBLE_LENGTH = 14;

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

/**
 * Double arrows (⇒ ⇐ ⇔): the equals sign's two bars and a head grown by their spread, so its arms reach as far past the
 * outer bar as a single arrow's reach past its shaft. Each bar ends on the arm's centre line, inside its ink.
 */
function doubleArrowRight(g: DrawContext, heads: { start?: boolean; end?: boolean } = { end: true }): { strokes: Stroke[]; length: number } {
  const y = MATH_AXIS;
  const spread = g.y(1.75) + g.h / 2;
  const reach = spread + HEAD - 1;
  // Two heads keep a stem's width of white between their arms' ends.
  const length = heads.start && heads.end ? Math.max(DOUBLE_LENGTH, 2 * reach + 2 * g.v) : DOUBLE_LENGTH;
  const from = heads.start ? spread : 0;
  const to = heads.end ? length - spread : length;
  const out: Stroke[] = [bar(from, to, y + spread), bar(from, to, y - spread)];
  const head = (x: number, dir: 1 | -1) => open(p(x - dir * reach, y + reach), p(x, y), p(x - dir * reach, y - reach));
  if (heads.end) out.push(head(length, 1));
  if (heads.start) out.push(head(0, -1));
  return { strokes: out, length };
}

const doubleArrow = (name: string, unicode: number, deg: number, heads?: { start?: boolean; end?: boolean }): GlyphDef => ({
  name,
  unicode,
  lsb: 1,
  rsb: 1,
  draw: (g) => {
    const { strokes, length } = doubleArrowRight(g, heads);
    return rotate(strokes, deg, length / 2, MATH_AXIS);
  },
});

/**
 * Squiggle arrows (⇜ ⇝, which ~~> and <~~ draw as, and the one-wave forms for ~> and <~): the tilde's own wave, 1.75 high on 45° sides, repeated
 * along the shaft, ending in the arrow's head; the last flat runs into the head, as a shaft does.
 */
/** The wave rises and its flats lengthen with the stem, so the waves stay open where a heavier stroke would merge them. */
function squiggleRight(g: DrawContext, waves: number): { strokes: Stroke[]; length: number } {
  // On the half unit at SemiBold, which snaps to it: a wave between half units would lose its 45° sides.
  const rise = Math.max(2, 2 + 0.5 * (g.v - 2));
  const flat = Math.max(1.5, 1.5 + 0.5 * (g.v - 2));
  const period = 2 * rise + 2 * flat;
  const y = MATH_AXIS - rise / 2;
  const points: PathPoint[] = [p(0, y)];
  for (let i = 0; i < waves; i++) {
    const a = i * period;
    // Rise, flat, fall, flat, the flats equal, as the tilde's are.
    points.push(p(a + rise, y + rise), p(a + rise + flat, y + rise), p(a + 2 * rise + flat, y));
  }
  // Back up to the axis, then into the head as a plain arrow's shaft goes, stopping where its does.
  const back = waves * period + rise / 2;
  const length = back + flat + HEAD;
  points.push(p(waves * period, y), p(back, MATH_AXIS), p(length - HEAD / 2, MATH_AXIS));
  const head = open(p(length - HEAD, MATH_AXIS + HEAD), p(length, MATH_AXIS), p(length - HEAD, MATH_AXIS - HEAD));
  return { strokes: [open(...points), head], length };
}
const squiggle = (name: string, unicode: number | undefined, waves: number, left: boolean): GlyphDef => ({
  name,
  ...(unicode === undefined ? {} : { unicode }),
  lsb: 1,
  rsb: 1,
  draw: (g) => {
    const { strokes, length } = squiggleRight(g, waves);
    return left ? mirror(strokes, length / 2) : strokes;
  },
});

/** The pipe ligatures' triangle (|> <|): the greater-than sign's 45° sides closed by an upright, grown with the stem so the counter stays open at Black. */
const pipeTriangle = (name: string, left: boolean): GlyphDef => ({
  name,
  lsb: 1,
  rsb: 1,
  draw: (g) => {
    const size = Math.max(4.5, 4.5 + 0.8 * (g.v - 2));
    const strokes = [closed(p(0, MATH_AXIS + size), p(size, MATH_AXIS), p(0, MATH_AXIS - size))];
    return left ? mirror(strokes, size / 2) : strokes;
  },
});

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
const BALLOT = 12;
const ballotWall = (g: DrawContext) => Math.min(Math.max(g.v, g.h) * 0.85, 2);
/** The pen for a ballot box's mark and where its centre line may run: a margin of white inside the walls. */
const ballotRoom = (g: DrawContext) => {
  const pen = { v: Math.min(g.v, 2), h: Math.min(g.h, 2) };
  const clear = ballotWall(g) + 0.9 + pen.v / 2;
  return { pen, x0: clear, x1: BALLOT - clear, y0: MATH_AXIS - BALLOT / 2 + clear, y1: MATH_AXIS + BALLOT / 2 - clear };
};

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

/**
 * Arrow ligature pieces (D12): `->` stays two glyphs, a shaft for the hyphen and a head for the greater-than sign, drawn
 * from the arrow itself and together exactly as wide as →, so the arrow is compact and each character keeps its own
 * glyph for the caret and selection. A piece's shaft runs past its side into its neighbour's, by more than Geld Dark
 * Sans's inset and on the half unit SemiBold snaps to, so no seam shows: the overlap is a negative sidebearing.
 */
const SPLIT = 5;
const MIDDLE = 4;
type Piece = 'start' | 'middle' | 'end' | 'head' | 'tail' | 'inner' | 'innertail';
export const ARROW_PIECES: { name: string; piece: Piece; double: boolean }[] = [
  { name: 'hyphen.arrow_start', piece: 'start', double: false },
  { name: 'hyphen.arrow_middle', piece: 'middle', double: false },
  { name: 'hyphen.arrow_end', piece: 'end', double: false },
  { name: 'greater.arrow_head', piece: 'head', double: false },
  { name: 'less.arrow_head', piece: 'tail', double: false },
  { name: 'greater.arrow_inner', piece: 'inner', double: false },
  { name: 'less.arrow_inner', piece: 'innertail', double: false },
  { name: 'equal.arrow_start', piece: 'start', double: true },
  { name: 'equal.arrow_middle', piece: 'middle', double: true },
  { name: 'equal.arrow_end', piece: 'end', double: true },
  { name: 'greater.arrow_dblhead', piece: 'head', double: true },
  { name: 'less.arrow_dblhead', piece: 'tail', double: true },
  { name: 'greater.arrow_dblinner', piece: 'inner', double: true },
];

function arrowPiece(name: string, piece: Piece, double: boolean): GlyphDef {
  const into = (g: DrawContext) => Math.ceil((0.25 + g.v * DARK_INSET_RATIO) * 2) / 2;
  const spread = (g: DrawContext) => g.y(1.75) + g.h / 2;
  const shaft = (g: DrawContext, from: number, to: number): Stroke[] =>
    double ? [bar(from, to, MATH_AXIS + spread(g)), bar(from, to, MATH_AXIS - spread(g))] : [bar(from, to, MATH_AXIS)];
  // The head piece: the arrow's own head, and its shaft from the split to where the arrow's stops inside the head.
  const head = (g: DrawContext): { strokes: Stroke[]; length: number } => {
    const { strokes, length } = double ? doubleArrowRight(g) : { strokes: arrowRight(), length: ARROW_LENGTH };
    const end = length - (double ? spread(g) : HEAD / 2);
    return { strokes: [...shaft(g, SPLIT - into(g), end), ...strokes.slice(double ? 2 : 1)], length };
  };
  const joint = (g: DrawContext) => -into(g);
  // The head behind the last one (->>): the shaft runs through its piece, and the tip stands back from the joint by
  // part of a stem, so the two heads keep their white between them at every weight.
  // As wide as the head and its set-back, so its arms start a unit before the piece, never past the shaft they sit on.
  const reachOf = (g: DrawContext) => (double ? spread(g) + HEAD - 1 : HEAD);
  const innerWidth = (g: DrawContext) => Math.max(MIDDLE, reachOf(g) + 0.75 * g.v - 1);
  const inner = (g: DrawContext): Stroke[] => {
    const reach = reachOf(g);
    const tip = innerWidth(g) - 0.75 * g.v;
    // The shaft starts behind the arms' ends, inside the piece before, so an arm never ends on the shaft's end.
    return [...shaft(g, Math.min(-into(g), tip - reach - g.v), innerWidth(g) + into(g)), open(p(tip - reach, MATH_AXIS + reach), p(tip, MATH_AXIS), p(tip - reach, MATH_AXIS - reach))];
  };
  const framed = (g: DrawContext) => ({ origin: 0, advance: innerWidth(g) });
  switch (piece) {
    case 'start':
      return { name, lsb: 1, rsb: 0, sidebearings: (g) => ({ rsb: joint(g) }), draw: (g) => shaft(g, 0, SPLIT + into(g)) };
    case 'middle':
      return { name, lsb: 0, rsb: 0, sidebearings: (g) => ({ lsb: joint(g), rsb: joint(g) }), draw: (g) => shaft(g, 0, MIDDLE + 2 * into(g)) };
    case 'end':
      return { name, lsb: 0, rsb: 1, sidebearings: (g) => ({ lsb: joint(g) }), draw: (g) => shaft(g, 0, SPLIT + into(g)) };
    case 'head':
      return { name, lsb: 0, rsb: 1, sidebearings: (g) => ({ lsb: joint(g) }), draw: (g) => head(g).strokes };
    case 'inner':
      return { name, lsb: 0, rsb: 0, frame: framed, draw: inner };
    case 'innertail':
      return { name, lsb: 0, rsb: 0, frame: framed, draw: (g) => rotate(inner(g), 180, innerWidth(g) / 2, MATH_AXIS) };
    case 'tail':
      return {
        name,
        lsb: 1,
        rsb: 0,
        sidebearings: (g) => ({ rsb: joint(g) }),
        draw: (g) => {
          const { strokes, length } = head(g);
          return rotate(strokes, 180, length / 2, MATH_AXIS);
        },
      };
  }
}

export const PLUS: GlyphDef[] = [
  ...ARROW_PIECES.map(({ name, piece, double }) => arrowPiece(name, piece, double)),
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
  pipeTriangle('pipe.right', false),
  pipeTriangle('pipe.left', true),
  squiggle('leftsquigglearrow', 0x21dc, 2, true),
  squiggle('rightsquigglearrow', 0x21dd, 2, false),
  squiggle('leftsquigglearrow.short', undefined, 1, true),
  squiggle('rightsquigglearrow.short', undefined, 1, false),
  doubleArrow('arrowdblleft', 0x21d0, 180),
  doubleArrow('arrowdblup', 0x21d1, 90),
  doubleArrow('arrowdblright', 0x21d2, 0),
  doubleArrow('arrowdbldown', 0x21d3, -90),
  doubleArrow('arrowdblboth', 0x21d4, 0, { start: true, end: true }),
  doubleArrow('arrowdblupdn', 0x21d5, 90, { start: true, end: true }),

  shape('filledbox', 0x25a0, () => [solid(squarePts(BIG))]),
  shape('whitesquare', 0x25a1, (g) => [hollow(squarePts(BIG), wall(g))]),
  // Ballot boxes ([ ] and [x] under dlig): a box larger than the white square, its walls and marks capped so the
  // check or X keeps a clear margin inside at Black.
  shape('ballotbox', 0x2610, (g) => [hollow(squarePts(BALLOT), ballotWall(g))]),
  shape('ballotboxcheck', 0x2611, (g) => {
    const { pen, x0, x1, y0, y1 } = ballotRoom(g);
    const w = x1 - x0;
    const down = Math.min(w * 0.4, y1 - y0);
    const up = Math.min(w - down, y1 - y0);
    const top = y0 + up;
    const start = (top + y0) / 2 + down / 2;
    return [
      hollow(squarePts(BALLOT), ballotWall(g)),
      withPen(open(p(x0, start), p(x0 + down, start - down), p(x0 + down + up, start - down + up)), pen),
    ];
  }),
  shape('ballotboxx', 0x2612, (g) => {
    const { pen, x0, x1, y0, y1 } = ballotRoom(g);
    const size = Math.min(x1 - x0, y1 - y0);
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const r = size / 2;
    return [
      hollow(squarePts(BALLOT), ballotWall(g)),
      withPen(open(p(cx - r, cy - r), p(cx + r, cy + r)), pen),
      withPen(open(p(cx - r, cy + r), p(cx + r, cy - r)), pen),
    ];
  }),
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
      const start = edgeAt(g.diag, 0, 0, w / 2, g.cap, g.h, -1) + INSIDE;
      return [diagonal(g, 0, 0, w / 2, g.cap), diagonal(g, w, 0, w / 2, g.cap), bar(start, w - start, g.bottom(0))];
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
      const top = g.cap + 1;
      const [tick, long] = meeting(g, [0, 6], [w * 0.65, top], x, 0);
      const foot = long!.points[0]!;
      return [tick!, long!, bar(edgeAt(g.diag, foot.x, 0, w * 0.65, top, top - g.h, 1) - INSIDE, w, t)];
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
      const w = g.wide(8);
      const s = 1.75;
      const rise = s + g.h + 1.6;
      const low = MATH_AXIS - (rise + s) / 2;
      return [tildeStroke(0, w, low + rise, s), tildeStroke(0, w, low, s)];
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
      return [bar(0, w, MATH_AXIS + gap), bar(0, w, MATH_AXIS - gap), diagonal(g, w * 0.3, MATH_AXIS - gap - g.h / 2 - 1.5, w * 0.7, MATH_AXIS + gap + g.h / 2 + 1.5)];
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

