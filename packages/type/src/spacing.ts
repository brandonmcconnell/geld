import type { Contour } from './geometry';

/**
 * Measured spacing, after the area method of HT Letterspacer: across a zone (the x-height for
 * lowercase, the cap height for capitals and figures) the white between the glyph's bounding edge and
 * its ink is measured row by row, each row's depth capped so open shapes (C, L, V) do not draw
 * their neighbours in, and the sidebearing is whatever brings the average white plus the sidebearing
 * to the same target on every side. A straight stem has no white of its own, so the target is its
 * sidebearing; rounds and diagonals get less, by exactly the white they carry.
 */
export interface SpacingZone {
  bottom: number;
  top: number;
  /** The side space of a straight stem in this zone. */
  target: number;
  /** The most a row's white counts for. */
  depth: number;
  /** The least sidebearing, for diagonals whose white reaches the cap. */
  min: number;
}

function crossings(contours: Contour[], y: number): number[] {
  const xs: number[] = [];
  for (const c of contours)
    for (let i = 0; i < c.length; i++) {
      const a = c[i]!;
      const b = c[(i + 1) % c.length]!;
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  return xs;
}

/** The average white on each side of a glyph across a zone, rows without ink counting as the full depth. */
export function sideWhite(contours: Contour[], minX: number, maxX: number, zone: SpacingZone): { left: number; right: number } {
  const rows = 80;
  let left = 0;
  let right = 0;
  for (let i = 0; i < rows; i++) {
    const y = zone.bottom + ((i + 0.5) / rows) * (zone.top - zone.bottom);
    const xs = crossings(contours, y);
    if (!xs.length) {
      left += zone.depth;
      right += zone.depth;
      continue;
    }
    left += Math.min(zone.depth, Math.min(...xs) - minX);
    right += Math.min(zone.depth, maxX - Math.max(...xs));
  }
  return { left: left / rows, right: right / rows };
}

export function measuredSidebearings(contours: Contour[], minX: number, maxX: number, zone: SpacingZone): { lsb: number; rsb: number } {
  const white = sideWhite(contours, minX, maxX, zone);
  return {
    lsb: Math.max(zone.min, zone.target - white.left),
    rsb: Math.max(zone.min, zone.target - white.right),
  };
}
