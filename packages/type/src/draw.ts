import { type Pen, type PathPoint, type Stroke, widthAlong } from './geometry';
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
  /** A height on the 14-unit cap, as the same share of this context's cap height. */
  y(n: number): number;
  /**
   * The same pen and grid at another size: superiors, fractions, ™, ordinals and the letters inside © ®
   * are drawn natively at their size, so every join is computed for the stroke they really have.
   */
  sub(size: number, penScale: number, lower?: boolean, breadth?: number): DrawContext;
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
  /** A capital's skeleton drawn to the x-height with the lowercase pen (most Cyrillic lowercase, `smcp` later). Its italic form, if any, is a lowercase drawing. */
  smallcap?: boolean;
  /** Set in the tabular width, centred, rather than spaced by its own outline. */
  tabular?: boolean;
  /** The band its sidebearings are measured over, where that is not its character's (oldstyle figures). */
  zone?: [number, number];
  /** The character an unencoded alternate stands for (a `locl` form), spaced and anchored as that character. */
  stands?: number;
  /** Sidebearings in grid units, measured from the Geld Sans outline. */
  lsb: number;
  rsb: number;
  /** Sidebearings that follow the weight, over lsb and rsb: an arrow piece's negative one, its overlap into the next. */
  sidebearings?(g: DrawContext): { lsb?: number; rsb?: number };
  draw(g: DrawContext): Stroke[];
  /** The italic's own form, where the italic is not the roman slanted. */
  italic?(g: DrawContext): Stroke[];
}

export interface SpaceDef {
  name: string;
  unicode: number;
  /** Advance in grid units, or the width of the tabular figures (figure space) or of another glyph. */
  advance: number | 'tabular' | { like: string };
}

export const p = (x: number, y: number, cut = false): PathPoint => (cut ? { x, y, cut } : { x, y });
export const open = (...points: PathPoint[]): Stroke => ({ points, closed: false });
export const closed = (...points: PathPoint[]): Stroke => ({ points, closed: true });
export const level = (stroke: Stroke, start = true, end = true): Stroke => ({
  ...stroke,
  ...(start ? { startCap: 'flat' as const } : {}),
  ...(end ? { endCap: 'flat' as const } : {}),
});
export const withPen = (stroke: Stroke, pen: Pen): Stroke => ({ ...stroke, pen });

/** A box with each corner cut or square, listed bottom-left, bottom-right, top-right, top-left. */
export function box(x0: number, x1: number, y0: number, y1: number, cuts: [boolean, boolean, boolean, boolean]): Stroke {
  const [bl, br, tr, tl] = cuts;
  return closed(p(x0, y0, bl), p(x1, y0, br), p(x1, y1, tr), p(x0, y1, tl));
}
export const ALL: [boolean, boolean, boolean, boolean] = [true, true, true, true];
export const RIGHT: [boolean, boolean, boolean, boolean] = [false, true, true, false];
export const LEFT: [boolean, boolean, boolean, boolean] = [true, false, false, true];

/** A diagonal with level ends, drawn with the diagonal pen. */
export function diagonal(g: DrawContext, x0: number, y0: number, x1: number, y1: number, ends: [boolean, boolean] = [true, true]): Stroke {
  return withPen(level(open(p(x0, y0), p(x1, y1)), ends[0], ends[1]), g.diag);
}

/** A square dot standing on y. */
export function dot(g: DrawContext, x: number, y: number): Stroke {
  return withPen(open(p(x, y), p(x, y + g.dot)), { v: g.dot, h: g.dot });
}

export const stem = (x: number, y0: number, y1: number) => open(p(x, y0), p(x, y1));
export const bar = (x0: number, x1: number, y: number) => open(p(x0, y), p(x1, y));

/** Two diagonals meeting at a level point, as in V, the bottom of W and the arms of Y. */
export function vee(g: DrawContext, x0: number, x1: number, top: number, bottom: number): Stroke[] {
  return meeting(g, [x0, top], [x1, top], (x0 + x1) / 2, bottom);
}

/**
 * Two diagonals from `a` and `b` meeting at height y around x, each with a level end there. Where
 * their slopes differ their feet differ too, so each is set so the outer corners are the outer
 * arms' and the inner corners lie within the flat they share: no step where they meet.
 */
export function meeting(g: DrawContext, a: [number, number], b: [number, number], x: number, y: number): Stroke[] {
  const ea = spanOf(g.diag, x - a[0], a[1] - y);
  const eb = spanOf(g.diag, b[0] - x, b[1] - y);
  const e = Math.max(ea, eb);
  return [diagonal(g, a[0], a[1], x - e + ea, y), diagonal(g, b[0], b[1], x + e - eb, y)];
}

/**
 * Y's arms meeting a stem: the arms end square at the stem's centre, their corners inside it (level
 * feet would stick out past its sides), and the stem runs up until its corners meet their inner edges.
 */
export function yArms(g: DrawContext, w: number, top: number, join: number, foot = 0): Stroke[] {
  const c = w / 2;
  return [diagonal(g, 0, top, c, join, [true, false]), diagonal(g, w, top, c, join, [true, false]), stem(c, foot, yStemTop(g, w, top, join))];
}

/** Where Y's stem ends: its top corners land on the arms' inner edges (just inside them), so the arms run into the stem with no step. */
export function yStemTop(g: DrawContext, w: number, top: number, join: number): number {
  const c = w / 2;
  return top - (c - g.v / 2 + INSIDE - edgeAt(g.diag, 0, top, c, join, top, 1)) / (c / (top - join));
}

/** Z and z: two bars and a diagonal whose level ends sit flush inside the bars' corners. */
/** Half the horizontal span of a stroke running (dx, dy) in this pen: how far a level end reaches either side of its centre. */
export const spanOf = (pen: { v: number; h: number }, dx: number, dy: number) => Math.hypot(pen.v * dy, pen.h * dx) / (2 * Math.abs(dy));

/** The level-ended foot of a diagonal spanning `width` across `height`, so its outer corners land on 0 and `width`. */
export function footFor(pen: { v: number; h: number }, width: number, height: number): number {
  let e = spanOf(pen, width, height);
  for (let i = 0; i < 6; i++) e = spanOf(pen, width - 2 * e, height);
  return e;
}

/** How far a stroke's corner reaches into the stroke it meets, so the corner is inside it rather than exactly on its edge, where rounding leaves a sliver. */
export const INSIDE = 0.05;

/** Where a straight stroke from (x0, y0) to (x1, y1) has its left (-1) or right (1) edge at height y. */
export function edgeAt(pen: { v: number; h: number }, x0: number, y0: number, x1: number, y1: number, y: number, side: -1 | 1): number {
  return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0) + side * spanOf(pen, x1 - x0, y1 - y0);
}

/**
 * A top bar turning down into a diagonal at its right end (Z, 7, Ʒ, ζ): the diagonal's level top
 * makes the corner at x = w, and the bar stops just inside the diagonal's right edge at the bar's
 * lower edge. The diagonal runs to `end`, with a level end there unless `endCap` is false.
 */
export function barIntoDiagonal(g: DrawContext, x0: number, w: number, top: number, end: [number, number], endCap = true): Stroke[] {
  let xt = w - spanOf(g.diag, w - end[0], top - end[1]);
  for (let i = 0; i < 6; i++) xt = w - spanOf(g.diag, xt - end[0], top - end[1]);
  const stop = edgeAt(g.diag, xt, top, end[0], end[1], top - g.h, 1) - INSIDE;
  return [bar(x0, stop, g.top(top)), diagonal(g, xt, top, end[0], end[1], [true, endCap])];
}

/**
 * A diagonal from `from` down onto a bar centred at y (2, Ʒ's waist, ẞ): the diagonal ends level on
 * the bar's lower edge with its foot centred at x, and the bar runs from just inside the diagonal's
 * left edge at its upper edge, so the foot's outer corner is the glyph's.
 */
export function diagonalOntoBar(g: DrawContext, from: [number, number], x: number, y: number, pen = g.diag): { diagonal: Stroke; start: number } {
  const low = y - g.h / 2;
  return {
    diagonal: withPen(level(open(p(from[0], from[1]), p(x, low)), false, true), pen),
    start: edgeAt(pen, from[0], from[1], x, low, y + g.h / 2, -1) + INSIDE,
  };
}

/**
 * A 45° stroke struck through a stem at x around height y (Ł ł ƛ): level ends clearing the stem by
 * 1.25 at their nearest corner, so the stroke reads as crossing rather than as a stub.
 */
export function strikeThrough(g: DrawContext, x: number, y: number, slope = 1): Stroke {
  const reach = strikeReach(g, slope);
  const ends: [number, number, number, number] = [x - reach, y - reach * slope, x + reach, y + reach * slope];
  // Shallower than 45° a level end would be a spike: the ends are square to the stroke instead.
  return slope >= 1 ? diagonal(g, ...ends) : withPen(open(p(ends[0], ends[1]), p(ends[2], ends[3])), g.diag);
}

/** How far a strikeThrough's ends reach from its centre, across (and `slope` times that up), measured so its nearest end corner clears the stem by 1.25. */
export const strikeReach = (g: DrawContext, slope = 1) => {
  const corner = slope >= 1 ? spanOf(g.diag, 1, slope) : (widthAlong({ x: 1, y: slope }, g.diag) / 2) * (slope / Math.hypot(1, slope));
  return g.v / 2 + 1.25 + corner;
};

/**
 * A tilde from x0 to x1 resting at y: up at 45°, a flat top, down, a flat bottom, up. Every corner is
 * obtuse, so none needs a cut that could close it, and it stands only `s` plus a bar tall at any weight.
 */
export function tildeStroke(x0: number, x1: number, y: number, s: number): Stroke {
  const m = (x0 + x1) / 2;
  return open(p(x0, y), p(x0 + s, y + s), p(m - s / 2, y + s), p(m + s / 2, y), p(x1 - s, y), p(x1, y + s));
}

/**
 * A bar across a stem under a bowl whose lower edge is at `bowl` (₽ Ᵽ Ɍ): at `wanted` where it clears
 * the bowl by 1.5 and the baseline by 1.25, else centred between them and as heavy as leaves 1.45 either side.
 */
export function underBowl(g: DrawContext, from: number, to: number, bowl: number, wanted: number): Stroke {
  const y = Math.min(wanted, bowl - 1.5 - g.h / 2);
  if (y - g.h / 2 >= 1.25) return bar(from, to, y);
  return withPen(bar(from, to, bowl / 2), { ...g.pen, h: Math.min(g.h, bowl - 2.9) });
}

/** Where the line through a and b crosses the line through c and d. */
export function crossing(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): [number, number] {
  const [rx, ry] = [b[0] - a[0], b[1] - a[1]];
  const [sx, sy] = [d[0] - c[0], d[1] - c[1]];
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / (rx * sy - ry * sx);
  return [a[0] + t * rx, a[1] + t * ry];
}

/** How far the bottom bar runs past a stroke to carry a tail: a stem's width, so the tail stands against the stroke, but never less than reads as a foot at light weights. */
export const tailReach = (g: DrawContext) => Math.max(g.v, 1.5);
/** Ц's tail: the bottom bar runs on from `from` past the stroke at x, and the tail hangs from that end, its outer edge flush with the bar's. */
export const tailAfter = (g: DrawContext, x: number, from: number): Stroke[] => {
  const end = x + g.v / 2 + tailReach(g);
  return [bar(from, end, g.bottom(0)), stem(end - g.v / 2, -2.75, g.h)];
};
/** The same tail after a diagonal leg whose level foot is centred on x and spans `e` either side: the bar starts at the foot's inner corner. */
export const tailAfterLeg = (g: DrawContext, x: number, e: number): Stroke[] => {
  const end = x + e + tailReach(g);
  return [bar(x - e, end, g.bottom(0)), stem(end - g.v / 2, -2.75, g.h)];
};

/** K with a tail after its leg (Қ Ϗ): the leg's foot carries a bar to the tail. */
export function kaWithTail(g: DrawContext, k: Stroke[]): Stroke[] {
  const w = g.wide(9.5);
  const y0 = g.y(4.5);
  const reach = w + g.v / 2 - g.foot(w, g.cap - y0);
  return [...k, ...tailAfterLeg(g, reach, spanOf(g.diag, reach * 0.6, y0 + (g.cap - y0) * 0.4))];
}

/**
 * Z's shape: bars that run into a diagonal end where the diagonal's edge crosses the bar's far
 * edge, so the bar's corner lies on that edge and the diagonal's level end makes the glyph's
 * corner. A bar run under the whole diagonal leaves a shelf where the two miss each other.
 */
export function zed(g: DrawContext, w: number, height: number): Stroke[] {
  const e = footFor(g.diag, w, height);
  const [x0, x1] = [w - e, e];
  const topEnd = edgeAt(g.diag, x0, height, x1, 0, height - g.h, 1) - INSIDE;
  const bottomStart = edgeAt(g.diag, x0, height, x1, 0, g.h, -1) + INSIDE;
  return [bar(0, topEnd, g.top(height)), bar(bottomStart, w, g.bottom(0)), diagonal(g, x0, height, x1, 0)];
}

/** M's and N's diagonals start flush with the stem's outer edge. */
export function fromStemTop(g: DrawContext, x: number, dir: 1 | -1, toX: number, toY: number): Stroke {
  const e = g.foot(Math.abs(toX - x), g.cap - toY);
  return diagonal(g, x - dir * (g.v / 2) + dir * e, g.cap, toX, toY);
}

const mapPoints = (strokes: Stroke[], f: (q: PathPoint) => PathPoint): Stroke[] =>
  strokes.map((s) => ({ ...s, points: s.points.map(f) }));

export const shift = (strokes: Stroke[], dx: number, dy: number): Stroke[] =>
  mapPoints(strokes, (q) => ({ ...q, x: q.x + dx, y: q.y + dy }));

/** Turns strokes half a turn about (cx, cy): ‘ from ’, ¿ from ?. */
export const rotate180 = (strokes: Stroke[], cx: number, cy: number): Stroke[] =>
  mapPoints(strokes, (q) => ({ ...q, x: 2 * cx - q.x, y: 2 * cy - q.y }));

/** Mirrors strokes across the vertical line x = axis. */
export const mirror = (strokes: Stroke[], axis: number): Stroke[] =>
  mapPoints(strokes, (q) => ({ ...q, x: 2 * axis - q.x }));

/** A small cut box (°, %, ring) whose counter stays open however heavy the stroke: at least 0.8 units inside. */
export function ring(g: DrawContext, x0: number, y0: number, inner = 0.8): Stroke {
  const size = Math.max(g.v, g.h) + inner;
  return box(x0, x0 + size, y0 + g.h / 2, y0 + g.h / 2 + size, ALL);
}

/**
 * A comma as one solid shape: the square dot, its right side slanting down and left into the tail,
 * so dot and tail can never come apart. Turned, it is ‘; as it stands, ’ and ,.
 */
export function comma(g: DrawContext, x: number, y: number, scale = 1): Stroke[] {
  const s = g.dot * scale;
  const a = s / 2;
  const tail = (1.4 + s * 0.45) * Math.max(scale, 0.6);
  // A blunt tip where the tail would come to a spike sharper than 32° (light weights); a hair of it elsewhere, so every weight has the same points.
  const tip = Math.max(0.15, tail * Math.tan((32 * Math.PI) / 180) - s);
  return [solid([p(x - a, y + s), p(x + a, y + s), p(x + a, y), p(x - a + tip, y - tail), p(x - a, y - tail)], 0.001)];
}

/** How far a bar overhangs the stroke it crosses: the same visible step at every weight, and a half unit, so the grid weight's snap keeps it. */
export const OVERHANG = 1.5;

/** How far t's and f's crossbar reaches left of the stem's centre: OVERHANG past its edge. */
export const crossbarReach = (g: DrawContext) => g.v / 2 + OVERHANG;

/** A solid shape from its outline, corners cut where `p(…, true)` asks, with cuts of `leg` units. */
export const solid = (points: PathPoint[], leg = 1.25): Stroke => ({ points, closed: true, fill: true, pen: { v: 0, h: 0, cut: leg } });

/** The same shape hollow, its wall `wall` units thick. */
export const hollow = (points: PathPoint[], wall: number, leg = 1.25): Stroke => ({ ...solid(points, leg), hole: wall });

/** An octagon standing in for a circle (○ ● ◦ ∅): a square of side `size` with regular-octagon cuts. */
export const octagon = (cx: number, cy: number, size: number): PathPoint[] => {
  const r = size / 2;
  return [p(cx - r, cy - r, true), p(cx + r, cy - r, true), p(cx + r, cy + r, true), p(cx - r, cy + r, true)];
};
export const octagonLeg = (size: number) => size * (1 - Math.SQRT1_2);

/** Turns strokes by `deg` degrees anticlockwise about (cx, cy): arrows in eight directions from one. */
export const rotate = (strokes: Stroke[], deg: number, cx: number, cy: number): Stroke[] => {
  const a = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(a) * 1e12) / 1e12;
  const s = Math.round(Math.sin(a) * 1e12) / 1e12;
  return mapPoints(strokes, (q) => ({ ...q, x: cx + (q.x - cx) * c - (q.y - cy) * s, y: cy + (q.x - cx) * s + (q.y - cy) * c }));
};

/** A chevron pointing left: arms at 45° on the grid meeting in a right-angled point, ends level (< ‹ « ≤). */
export function chevronLeft(g: DrawContext, size: number, y: number): Stroke[] {
  return [withPen(level(open(p(size, y + size), p(0, y), p(size, y - size))), g.pen)];
}

/** A tall narrow chevron (⟨ ⟩): too steep for a clean point, so its two diagonals meet in a small upright tip. */
export function angleLeft(g: DrawContext, w: number, y: number, spread: number): Stroke[] {
  const arm = (x1: number, y1: number): Stroke => withPen({ points: [p(0, y), p(x1, y1)], closed: false, startCap: 'upright', endCap: 'flat' }, g.diag);
  return [arm(w, y + spread), arm(w, y - spread)];
}

/** Math sits on this centre line, the hyphen and strikeout on the x-height's middle. */
export const MATH_AXIS = 6;
export const DASH_AXIS = METRICS.xHeight / 2;

/** How far stem centres move apart per unit of stem beyond SemiBold's 2. */
const GROWTH = 0.5;
/** Diagonals are drawn this much lighter than stems, so they look as heavy. */
const DIAGONAL_WEIGHT = 0.92;

/** The least opening between a terminal and the stroke it turns toward, as in 6, 9 and ?. */
const APERTURE = 1.6;

/** Small capitals stand on the x-height and keep more of the capital's width than its height. */
export const SMALL_CAP_BREADTH = 0.82;

export function smallCapContext(v: number, hc: number): DrawContext {
  const g = drawContext(v, hc, true, METRICS.xHeight);
  const k = METRICS.xHeight / METRICS.cap;
  return { ...g, pen: { ...g.pen, cut: CUT_OUTER_LOWER }, aperture: APERTURE, wide: (n) => n * SMALL_CAP_BREADTH + GROWTH * (v - 2 * k) };
}

/** `breadth` scales widths apart from heights: small capitals and oldstyle figures keep more of their width than their height. */
export function drawContext(v: number, hc: number, lower = false, size: number = METRICS.cap, breadth = size / METRICS.cap): DrawContext {
  const k = size / METRICS.cap;
  const cut = (lower ? CUT_OUTER_LOWER : CUT_OUTER) * Math.min(1, k);
  const diag = { v: v * DIAGONAL_WEIGHT, h: hc * DIAGONAL_WEIGHT };
  return {
    v,
    h: hc,
    pen: { v, h: hc, cut },
    diag,
    dot: v * 1.1 + 0.2 * k,
    aperture: APERTURE * k,
    wide: (n) => n * breadth + GROWTH * (v - 2 * k),
    top: (y) => y - hc / 2,
    bottom: (y) => y + hc / 2,
    foot: (dx, dy) => Math.hypot(diag.v * dy, diag.h * dx) / (2 * Math.abs(dy)),
    y: (n) => n * k,
    sub: (s, penScale, subLower = lower, subBreadth) => drawContext(v * penScale, hc * penScale, subLower, s, subBreadth),
    cap: size,
    xHeight: METRICS.xHeight * k,
    ascender: METRICS.ascender * k,
    descender: METRICS.descender * k,
  };
}

/** Strokes drawn in another context keep that context's pen when they join a glyph drawn in this one. */
export const inPen = (g: DrawContext, strokes: Stroke[]): Stroke[] => strokes.map((s) => (s.pen ? s : { ...s, pen: g.pen }));
