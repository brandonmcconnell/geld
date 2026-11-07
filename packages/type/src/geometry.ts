import { CUT_INNER_MIN, CUT_OUTER } from './grid';

export interface Vec {
  x: number;
  y: number;
}

/** A closed polygon of straight segments, in PostScript direction: ink lies to the left of travel. */
export type Contour = Vec[];

export interface PathPoint extends Vec {
  /** Cut this corner at 45°. Only corners between perpendicular segments can be cut. */
  cut?: boolean;
}

/**
 * A stroke's centreline. An open stroke ends square at its first and last points,
 * so those points sit on the outline; a closed stroke draws an outer and an inner contour.
 */
export interface Stroke {
  points: PathPoint[];
  closed: boolean;
}

export interface Pen {
  /** Vertical stem. */
  v: number;
  /** Horizontal stroke. */
  h: number;
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
export function cutLeg(wIn: number, wOut: number): number {
  const k = ((wIn + wOut) / 4) * (2 - Math.SQRT2);
  return Math.max(CUT_OUTER - k, CUT_INNER_MIN + k);
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

/** Replaces every cut corner with the two ends of its 45° cut. */
export function insertCuts(stroke: Stroke, pen: Pen): Vec[] {
  const { points, closed } = stroke;
  const out: Vec[] = [];
  points.forEach((p, i) => {
    if (!p.cut) {
      out.push({ x: p.x, y: p.y });
      return;
    }
    const prev = points[i - 1] ?? (closed ? points[points.length - 1] : undefined);
    const next = points[i + 1] ?? (closed ? points[0] : undefined);
    if (!prev || !next) throw new Error('An end of an open stroke cannot be cut');
    const a = unit(sub(p, prev));
    const b = unit(sub(next, p));
    if (Math.abs(a.x * b.x + a.y * b.y) > 1e-6) throw new Error('Only a right-angled corner can be cut');
    const leg = cutLeg(widthAlong(a, pen), widthAlong(b, pen));
    out.push(sub(p, scale(a, leg)), add(p, scale(b, leg)));
  });
  return out;
}

/** Offsets a centreline by half its width on each side, joining segments at the intersection of their edges. */
export function expandStroke(stroke: Stroke, pen: Pen): Contour[] {
  let points = insertCuts(stroke, pen);
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
  const right: Vec[] = [shifted(0, -1)];
  for (let i = 1; i < n - 1; i++) right.push(corner(i, -1));
  right.push(add(points[n - 1]!, scale(left(dirs[segments - 1]!), -half[segments - 1]!)));
  const leftSide: Vec[] = [add(points[n - 1]!, scale(left(dirs[segments - 1]!), half[segments - 1]!))];
  for (let i = n - 2; i >= 1; i--) leftSide.push(corner(i, 1));
  leftSide.push(shifted(0, 1));
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
