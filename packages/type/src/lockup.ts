import { readFileSync } from 'node:fs';
import type { Contour } from './geometry';
import type { Anchor } from './master';

/**
 * The Geld wordmark as one glyph, for "Geld" under dlig: the logo itself, read from assets/brand, the same at every
 * weight and upright in italic, since a brand mark that thins or slants is no longer the mark. Geld Dark Sans takes
 * the dark logo, whose 0.2 inset is its own at SemiBold, the weight the logo's letters are drawn in.
 */
export const LOCKUP = { name: 'G_e_l_d', letters: ['G', 'e', 'l', 'd'] } as const;

/** The logo's letters stand on its y = 20, so the mark reaches 5 units below the baseline and 6 above the caps. */
const BASELINE = 20;
/** The sidebearings of the mark's straight left side and D's round right side at SemiBold. */
const LEFT = 1.6;
const RIGHT = 1.3;
/** Where the caret goes between the letters typed: after G (the mark and G), E and L. */
const CARETS = [47, 64, 80];

function pathContours(svg: string): Contour[] {
  const contours: Contour[] = [];
  for (const [, d] of svg.matchAll(/<path d="([^"]+)"/g)) {
    let current: Contour = [];
    let x = 0;
    let y = 0;
    for (const [, op, args] of d!.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
      const n = args!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (op === 'Z') {
        contours.push(current);
        current = [];
        continue;
      }
      if (op === 'M' || op === 'L') [x, y] = [n[0]!, n[1]!];
      else if (op === 'H') x = n[0]!;
      else y = n[0]!;
      const last = current[current.length - 1];
      const point = { x: LEFT + x, y: BASELINE - y };
      if (!last || last.x !== point.x || last.y !== point.y) current.push(point);
    }
  }
  return contours;
}

export function lockupGlyph(dark: boolean): { contours: Contour[]; advance: number; anchors: Anchor[] } {
  const file = new URL(`../../../assets/brand/${dark ? 'geld-logo-white' : 'geld-logo'}.svg`, import.meta.url);
  const svg = readFileSync(file, 'utf8');
  const width = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)![1]);
  return {
    contours: pathContours(svg),
    advance: LEFT + width + RIGHT,
    anchors: CARETS.map((x, i) => ({ name: `caret_${i + 1}`, x: LEFT + x, y: 0 })),
  };
}
