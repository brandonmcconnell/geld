import { CUT_INNER_MIN, CUT_OUTER } from './grid';

export interface Vec {
  x: number;
  y: number;
}

/** A closed polygon of straight segments, in PostScript direction: ink lies to the left of travel. */
export type Contour = Vec[];

export interface PathPoint extends Vec {
  /**
   * Cut this corner at 45°. Only corners between perpendicular segments can be cut. `'keep'` is a cut the square style
   * keeps too, where the cut tells the glyph apart from another (D from O) or draws a shape (an octagon for a circle).
   */
  cut?: boolean | 'keep';
}

/** The two corner styles: Geld Sans Cut's 45° cuts, and Geld Sans's square corners on the same grid. */
export type Corners = 'cut' | 'square';
let corners: Corners = 'cut';
/** Draws with the given corner style; a master is built synchronously inside one call. */
export function withCorners<T>(style: Corners, draw: () => T): T {
  const before = corners;
  corners = style;
  try {
    return draw();
  } finally {
    corners = before;
  }
}
const cuts = (p: PathPoint) => (corners === 'cut' ? p.cut !== undefined && p.cut !== false : p.cut === 'keep');

/**
 * How an open stroke ends at its first or last point, which always lies on the outline:
 * `butt` square to the stroke, `flat` level (a diagonal's foot on the baseline, an apex at the cap height),
 * `upright` vertical (the tip of a chevron, where two diagonals meet).
 */
export type Cap = 'butt' | 'flat' | 'upright';

/**
 * A stroke's centreline. An open stroke ends at its first and last points, so those points sit on
 * the outline; a closed stroke draws an outer and an inner contour.
 */
export interface Stroke {
  points: PathPoint[];
  closed: boolean;
  /** A pen of its own, for thinner lowercase horizontals, dots and diagonals. */
  pen?: Pen;
  /**
   * A closed stroke that is a solid shape: the points are its outline (cuts included), not a
   * centreline. With `hole`, the shape is hollow, its wall that thick (□ △ ○).
   */
  fill?: boolean;
  hole?: number;
  startCap?: Cap;
  endCap?: Cap;
}

export interface Pen {
  /** Vertical stem. */
  v: number;
  /** Horizontal stroke. */
  h: number;
  /** The outer leg this pen's cuts aim for, when not the caps' CUT_OUTER. */
  cut?: number;
}

const EPS = 1e-9;

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
const length = (a: Vec): number => Math.hypot(a.x, a.y);

function unit(a: Vec): Vec {
  const len = length(a);
  if (len < EPS) throw new Error('A stroke has two points in the same place');
  return scale(a, 1 / len);
}

/** Left-hand normal of a direction. */
const left = (u: Vec): Vec => ({ x: -u.y, y: u.x });

/** Width of a stroke running in direction `u`: the vertical stem upright, the horizontal flat, between them on a slant. */
export function widthAlong(u: Vec, pen: Pen): number {
  return Math.hypot(pen.v * u.y, pen.h * u.x);
}

/**
 * The centreline leg of a 45° cut. Offset by half the stroke, a leg `L` becomes `L + k` on the
 * outer corner and `L - k` on the inner one, with `k = (w / 2)(2 - √2)`. The outer leg aims for
 * CUT_OUTER, and grows instead when the inner leg would otherwise drop below CUT_INNER_MIN.
 */
export function cutLeg(wIn: number, wOut: number, outer = CUT_OUTER): number {
  const k = ((wIn + wOut) / 4) * (2 - Math.SQRT2);
  return Math.max(outer - k, CUT_INNER_MIN + k);
}

function lineIntersection(p1: Vec, d1: Vec, p2: Vec, d2: Vec): Vec {
  const c = cross(d1, d2);
  if (Math.abs(c) < EPS) return p2;
  const t = cross(sub(p2, p1), d2) / c;
  return add(p1, scale(d1, t));
}

function signedArea(points: Vec[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * How much to lengthen or shorten a cut so its edge keeps its length once the glyph is slanted:
 * the slant stretches the cuts on two corners of a box and shrinks the other two, so the sharp
 * and blunt corners would otherwise read as different cuts. Applied to the outer leg, the
 * silhouette's cuts come out equal; the inner ones, a fraction of a unit at heavy weights, nearly so.
 */
export function slantedCutFactor(a: Vec, b: Vec, slope: number): number {
  const cx = a.x + b.x;
  const cy = a.y + b.y;
  return Math.hypot(cx, cy) / Math.hypot(cx + slope * cy, cy);
}

/** Replaces every cut corner with the two ends of its 45° cut. */
export function insertCuts(stroke: Stroke, pen: Pen, slope = 0): Vec[] {
  const { points, closed } = stroke;
  const out: Vec[] = [];
  points.forEach((p, i) => {
    if (!cuts(p)) {
      out.push({ x: p.x, y: p.y });
      return;
    }
    const prev = points[i - 1] ?? (closed ? points[points.length - 1] : undefined);
    const next = points[i + 1] ?? (closed ? points[0] : undefined);
    if (!prev || !next) throw new Error('An end of an open stroke cannot be cut');
    const a = unit(sub(p, prev));
    const b = unit(sub(next, p));
    if (Math.abs(a.x * b.x + a.y * b.y) > 1e-6) throw new Error('Only a right-angled corner can be cut');
    const roomBefore = length(sub(p, prev)) * (cuts(prev) ? 0.49 : 0.98);
    const roomAfter = length(sub(next, p)) * (cuts(next) ? 0.49 : 0.98);
    const wIn = widthAlong(a, pen);
    const wOut = widthAlong(b, pen);
    const k = ((wIn + wOut) / 4) * (2 - Math.SQRT2);
    const outer = (cutLeg(wIn, wOut, pen.cut) + k) * slantedCutFactor(a, b, slope);
    const leg = Math.min(outer - k, roomBefore, roomAfter);
    out.push(sub(p, scale(a, leg)), add(p, scale(b, leg)));
  });
  return out;
}

/**
 * How far past the stroke it turns from a terminal reaches at least in the square style: the cut style's cut
 * makes up a short terminal's length, and squared it was a nub (0.37 units on e at Black).
 */
export const SQUARE_STUB = 0.6;

/** In the square style, lengthens an open stroke's end that turns at a dropped cut, to SQUARE_STUB past the stroke before it. */
function squareStubs(stroke: Stroke, pen: Pen): Stroke {
  const { points } = stroke;
  if (corners !== 'square' || stroke.closed || stroke.fill || points.length < 3) return stroke;
  const out = [...points];
  const reach = (end: number, corner: number, before: number) => {
    const q = out[corner]!;
    if (q.cut !== true) return;
    const stub = sub(out[end]!, q);
    const need = widthAlong(unit(sub(q, out[before]!)), pen) / 2 + SQUARE_STUB;
    if (length(stub) < need) out[end] = { ...out[end]!, ...add(q, scale(unit(stub), need)) };
  };
  reach(out.length - 1, out.length - 2, out.length - 3);
  reach(0, 1, 2);
  return { ...stroke, points: out };
}

/** Offsets a centreline by half its width on each side; `slope` is the italic's, so cuts come out even once slanted. */
export function expandStroke(drawn: Stroke, masterPen: Pen, slope = 0): Contour[] {
  const stroke = squareStubs(drawn, drawn.pen ?? masterPen);
  const pen = stroke.pen ?? masterPen;
  if (stroke.fill) {
    let shape = insertCuts(stroke, { v: 0, h: 0, ...(pen.cut === undefined ? {} : { cut: pen.cut }) }, slope);
    if (signedArea(shape) < 0) shape = shape.reverse();
    return stroke.hole ? [shape, insetContour(shape, stroke.hole).reverse()] : [shape];
  }
  let points = insertCuts(stroke, pen, slope);
  if (stroke.closed && signedArea(points) < 0) points = points.reverse();
  const n = points.length;
  const segments = stroke.closed ? n : n - 1;
  const dirs: Vec[] = [];
  const half: number[] = [];
  for (let i = 0; i < segments; i++) {
    const u = unit(sub(points[(i + 1) % n]!, points[i]!));
    dirs.push(u);
    half.push(widthAlong(u, pen) / 2);
  }
  const shifted = (seg: number, side: 1 | -1): Vec =>
    add(points[seg]!, scale(left(dirs[seg]!), side * half[seg]!));
  const corner = (i: number, side: 1 | -1): Vec => {
    const before = (i - 1 + segments) % segments;
    return lineIntersection(shifted(before, side), dirs[before]!, shifted(i, side), dirs[i]!);
  };

  if (stroke.closed) {
    const outer = points.map((_, i) => corner(i, -1));
    const inner = points.map((_, i) => corner(i, 1)).reverse();
    return [outer, inner];
  }
  const last = segments - 1;
  const end = (seg: number, at: Vec, side: 1 | -1, cap: Cap | undefined): Vec => {
    const edge = add(at, scale(left(dirs[seg]!), side * half[seg]!));
    if (cap === 'flat' && Math.abs(dirs[seg]!.y) > EPS) return lineIntersection(at, { x: 1, y: 0 }, edge, dirs[seg]!);
    if (cap === 'upright' && Math.abs(dirs[seg]!.x) > EPS) return lineIntersection(at, { x: 0, y: 1 }, edge, dirs[seg]!);
    return edge;
  };
  const right: Vec[] = [end(0, points[0]!, -1, stroke.startCap)];
  for (let i = 1; i < n - 1; i++) right.push(corner(i, -1));
  right.push(end(last, points[n - 1]!, -1, stroke.endCap));
  const leftSide: Vec[] = [end(last, points[n - 1]!, 1, stroke.endCap)];
  for (let i = n - 2; i >= 1; i--) leftSide.push(corner(i, 1));
  leftSide.push(end(0, points[0]!, 1, stroke.startCap));
  return [[...right, ...leftSide]];
}

/** Moves every edge toward the ink by `d`, the way the dark logo was made from the light one. */
export function insetContour(contour: Contour, d: number): Contour {
  const n = contour.length;
  const dirOf = (i: number): Vec | null => {
    const v = sub(contour[(i + 1) % n]!, contour[i]!);
    return length(v) < EPS ? null : unit(v);
  };
  const edges = contour.map((_, i) => dirOf(i));
  const nearest = (from: number, step: 1 | -1): number => {
    for (let k = 0, i = from; k < n; k++, i = (i + step + n) % n) if (edges[i]) return i;
    throw new Error('A contour has no length');
  };
  return contour.map((_, i) => {
    const after = nearest(i, 1);
    const before = nearest((i - 1 + n) % n, -1);
    const da = edges[after]!;
    const db = edges[before]!;
    const pa = add(contour[after]!, scale(left(da), d));
    const pb = add(contour[before]!, scale(left(db), d));
    return lineIntersection(pb, db, pa, da);
  });
}

export function shear(contour: Contour, slope: number): Contour {
  return contour.map((p) => ({ x: p.x + p.y * slope, y: p.y }));
}

export function translate(contour: Contour, dx: number, dy = 0): Contour {
  return contour.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function snap(contour: Contour, step: number): Contour {
  const r = (n: number) => Math.round(n / step) * step;
  return contour.map((p) => ({ x: r(p.x), y: r(p.y) }));
}

/**
 * A glyph's contours snapped to the grid, except a point that lies inside another of its strokes
 * and would land outside it: joins place a stroke's corner just inside the stroke it meets, and
 * moved out it leaves a step or a sliver where the two should merge.
 */
export function snapJoined(contours: Contour[], step: number): Contour[] {
  const snapped = contours.map((c) => snap(c, step));
  return snapped.map((c, i) => {
    const others = contours.filter((_, j) => j !== i);
    const snappedOthers = snapped.filter((_, j) => j !== i);
    return c.map((q, k) => {
      const o = contours[i]![k]!;
      return winding(others, o) !== 0 && winding(snappedOthers, q) === 0 ? o : q;
    });
  });
}

export function bounds(contours: Contour[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of contours)
    for (const p of c) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  return { minX, maxX, minY, maxY };
}

/** Nonzero winding number of a point against contours, for tests and checks. */
export function winding(contours: Contour[], p: Vec): number {
  let w = 0;
  for (const c of contours)
    for (let i = 0; i < c.length; i++) {
      const a = c[i]!;
      const b = c[(i + 1) % c.length]!;
      if (a.y <= p.y) {
        if (b.y > p.y && cross(sub(b, a), sub(p, a)) > 0) w++;
      } else if (b.y <= p.y && cross(sub(b, a), sub(p, a)) < 0) w--;
    }
  return w;
}
