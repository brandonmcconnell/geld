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
  const mid = (x0 + x1) / 2;
  return [diagonal(g, x0, top, mid, bottom), diagonal(g, x1, top, mid, bottom)];
}

/**
 * Y's arms meeting a stem: the stem runs up into the arms' overlap (not just to their level feet,
 * which would touch along a line and part in Geld Dark Sans), stopping short of the crotch.
 */
export function yArms(g: DrawContext, w: number, top: number, join: number, foot = 0): Stroke[] {
  const c = w / 2;
  const e = g.foot(c, top - join);
  const slope = c / (top - join);
  const into = (e / slope) * 0.95;
  return [...vee(g, 0, w, top, join), stem(c, foot, join + into)];
}

/** Z and z: two bars and a diagonal whose level ends sit flush inside the bars' corners. */
export function zed(g: DrawContext, w: number, height: number): Stroke[] {
  const e = g.foot(w, height);
  return [bar(0, w, g.top(height)), bar(0, w, g.bottom(0)), diagonal(g, w - e, height, e, 0)];
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
  return [solid([p(x - a, y + s), p(x + a, y + s), p(x + a, y), p(x - a, y - tail)], 0.001)];
}

/** How far t's and f's crossbar reaches left of the stem's edge: the same visible step at every weight. */
export const crossbarReach = (g: DrawContext) => g.v / 2 + 1.25;

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
