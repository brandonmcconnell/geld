import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bounds, type Contour, translate, winding } from './geometry';
import { buildMaster } from './master';

const brand = (file: string) => readFileSync(fileURLToPath(new URL(`../../../assets/brand/${file}`, import.meta.url)), 'utf8');

/** Reads the wordmark's paths (absolute M, H, V, L and Z only) into contours in font coordinates. */
function svgContours(d: string): Contour[] {
  const contours: Contour[] = [];
  let current: Contour = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MHVLZ])([^MHVLZ]*)/g)) {
    const nums = (args ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === 'Z') {
      contours.push(current);
      current = [];
      continue;
    }
    for (let i = 0; i < nums.length; ) {
      if (cmd === 'H') x = nums[i++]!;
      else if (cmd === 'V') y = nums[i++]!;
      else {
        x = nums[i++]!;
        y = nums[i++]!;
      }
      current.push({ x, y: 20 - y });
    }
  }
  return contours;
}

function letters(svg: string): Contour[][] {
  const paths = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => svgContours(m[1]!));
  return paths.slice(1);
}

/** Samples coverage on a quarter-unit lattice, off every half-unit edge, with each shape moved to x = 0. */
function coverage(contours: Contour[]): string {
  const box = bounds(contours);
  const moved = contours.map((c) => translate(c, -box.minX));
  const rows: string[] = [];
  for (let y = -1 + 0.125; y < 16; y += 0.25) {
    let row = '';
    for (let x = -1 + 0.125; x < 14; x += 0.25) row += winding(moved, { x, y }) !== 0 ? '#' : '.';
    rows.push(row);
  }
  return rows.join('\n');
}

describe('the wordmark is Geld Sans SemiBold', () => {
  const names = ['G', 'E', 'L', 'D'];

  it('matches geld-logo.svg letter for letter', () => {
    const master = buildMaster('sans', 'roman', 600);
    letters(brand('geld-logo.svg')).forEach((logo, i) => {
      const glyph = master.glyphs.find((g) => g.name === names[i])!;
      expect(coverage(glyph.contours), names[i]).toBe(coverage(logo));
    });
  });

  it('matches geld-logo-white.svg as Geld Dark Sans', () => {
    const master = buildMaster('dark', 'roman', 600);
    letters(brand('geld-logo-white.svg')).forEach((logo, i) => {
      const glyph = master.glyphs.find((g) => g.name === names[i])!;
      expect(coverage(glyph.contours), names[i]).toBe(coverage(logo));
    });
  });
});
