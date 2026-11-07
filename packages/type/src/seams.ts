import { type Contour, winding } from './geometry';

export interface Seam {
  kind: 'touching' | 'sliver';
  /** The gap in grid units (0 for touching edges). */
  gap: number;
  at: { x: number; y: number };
}

interface Edge {
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Unit direction. */
  d: { x: number; y: number };
  /** Unit normal pointing away from the ink (ink lies to the left of travel). */
  out: { x: number; y: number };
  len: number;
}

function edgesOf(contour: Contour): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i]!;
    const b = contour[(i + 1) % contour.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    out.push({ a, b, d, out: { x: d.y, y: -d.x }, len });
  }
  return out;
}

/**
 * Faults that render as hairlines or slivers: two contours whose edges touch along a line (a seam
 * once anti-aliased), and parallel edges facing each other across a white gap narrower than
 * `sliver` units. Strokes meant to meet must overlap; strokes meant to part must part clearly.
 */
export function findSeams(contours: Contour[], sliver = 0.35, minOverlap = 0.25): Seam[] {
  const seams: Seam[] = [];
  const all = contours.map(edgesOf);
  for (let i = 0; i < all.length; i++)
    for (let j = i; j < all.length; j++)
      for (const e1 of all[i]!)
        for (const e2 of all[j]!) {
          if (e1 === e2) continue;
          if (Math.abs(e1.d.x * e2.d.y - e1.d.y * e2.d.x) > 1e-6) continue;
          if (e1.d.x * e2.d.x + e1.d.y * e2.d.y > -0.999) continue;
          const gap = (e2.a.x - e1.a.x) * e1.out.x + (e2.a.y - e1.a.y) * e1.out.y;
          if (gap < -1e-6 || gap >= sliver) continue;
          const t = (q: { x: number; y: number }) => (q.x - e1.a.x) * e1.d.x + (q.y - e1.a.y) * e1.d.y;
          const lo = Math.max(0, Math.min(t(e2.a), t(e2.b)));
          const hi = Math.min(e1.len, Math.max(t(e2.a), t(e2.b)));
          if (hi - lo < minOverlap) continue;
          const mid = (lo + hi) / 2;
          const base = { x: e1.a.x + e1.d.x * mid, y: e1.a.y + e1.d.y * mid };
          if (gap < 1e-6) {
            if (i === j) continue;
            const outside = { x: base.x + e1.out.x * 0.02, y: base.y + e1.out.y * 0.02 };
            const inside = { x: base.x - e1.out.x * 0.02, y: base.y - e1.out.y * 0.02 };
            if (winding(contours, outside) !== 0 && winding(contours, inside) !== 0) {
              const others = contours.filter((_, k) => k !== i && k !== j);
              const covered = winding(others, outside) !== 0 && winding(others, inside) !== 0;
              if (!covered) seams.push({ kind: 'touching', gap: 0, at: base });
            }
            continue;
          }
          const probe = { x: base.x + e1.out.x * (gap / 2), y: base.y + e1.out.y * (gap / 2) };
          if (winding(contours, probe) === 0) seams.push({ kind: 'sliver', gap, at: probe });
        }
  return seams;
}
