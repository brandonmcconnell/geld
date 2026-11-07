import { bounds, type Contour, cutLeg, expandStroke, insetContour, winding } from './geometry';
import { WEIGHTS } from './grid';
import { buildMaster, type Family, type Style } from './master';

const shape = (family: Family, style: Style, weight: (typeof WEIGHTS)[number]) =>
  buildMaster(family, style, weight).glyphs.map((g) => [g.name, g.contours.map((c) => c.length)]);

describe('geometry', () => {
  it('cuts a 2-unit stroke 2 units outside and 0.83 inside', () => {
    const leg = cutLeg(2, 2);
    const k = 2 - Math.SQRT2;
    expect(leg + k).toBeCloseTo(2);
    expect(leg - k).toBeCloseTo(2 - 2 * (2 - Math.SQRT2));
  });

  it('expands a closed square into an outer and an inner contour of opposite direction', () => {
    const [outer, inner] = expandStroke(
      { closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      { v: 2, h: 2 },
    );
    expect(outer).toEqual([{ x: -1, y: -1 }, { x: 11, y: -1 }, { x: 11, y: 11 }, { x: -1, y: 11 }]);
    expect(inner).toEqual([{ x: 1, y: 9 }, { x: 9, y: 9 }, { x: 9, y: 1 }, { x: 1, y: 1 }]);
  });

  it('insets a contour toward its ink', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(insetContour(square, 1)).toEqual([{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }]);
  });
});

describe('masters', () => {
  it('draw every weight with the same contours and points, so the weights interpolate', () => {
    for (const family of ['sans', 'dark'] as const)
      for (const style of ['roman', 'italic'] as const) {
        const reference = shape(family, style, 400);
        for (const weight of WEIGHTS) expect(shape(family, style, weight), `${family} ${style} ${weight}`).toEqual(reference);
      }
  });

  it('give Geld Dark Sans the advance widths of Geld Sans, so switching never reflows', () => {
    for (const weight of WEIGHTS)
      for (const style of ['roman', 'italic'] as const) {
        const sans = buildMaster('sans', style, weight).glyphs.map((g) => g.advance);
        const dark = buildMaster('dark', style, weight).glyphs.map((g) => g.advance);
        expect(dark).toEqual(sans);
      }
  });

  it('keep heavy-weight inner cuts open', () => {
    expect(cutLeg(3.3, 3.3) - (3.3 / 2) * (2 - Math.SQRT2)).toBeCloseTo(0.5);
  });
});

describe('character set', () => {
  const chars = [
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    ...'.,:;!?-\u2013\u2014\'"()[]/_+= ',
  ].map((c) => c.codePointAt(0));

  it('covers basic Latin letters, figures and punctuation', () => {
    const mapped = new Set(buildMaster('sans', 'roman', 400).glyphs.map((g) => g.unicode));
    expect(chars.filter((c) => !mapped.has(c))).toEqual([]);
  });

  it('keeps every glyph inside the line box at every weight, with ink and room on both sides', () => {
    for (const weight of WEIGHTS)
      for (const glyph of buildMaster('sans', 'roman', weight).glyphs) {
        if (glyph.name === 'space') continue;
        const ys = glyph.contours.flat().map((p) => p.y);
        const xs = glyph.contours.flat().map((p) => p.x);
        expect(Math.min(...ys), `${glyph.name} ${weight}`).toBeGreaterThanOrEqual(-5);
        expect(Math.max(...ys), `${glyph.name} ${weight}`).toBeLessThanOrEqual(19);
        expect(Math.min(...xs), `${glyph.name} ${weight}`).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs), `${glyph.name} ${weight}`).toBeLessThanOrEqual(glyph.advance + 1e-9);
      }
  });
});

/** The narrowest white gap between two strokes, scanned across the middle of a glyph. */
function narrowestCounter(contours: Contour[]): number {
  const box = bounds(contours);
  const step = 0.02;
  let min = Infinity;
  const scan = (at: (t: number) => { x: number; y: number }, from: number, to: number) => {
    let inside = false;
    let start = NaN;
    for (let t = from; t <= to; t += step) {
      const ink = winding(contours, at(t)) !== 0;
      if (ink && !inside && !Number.isNaN(start)) min = Math.min(min, t - start);
      if (ink !== inside) {
        inside = ink;
        if (!ink) start = t;
      }
    }
  };
  for (const f of [0.35, 0.5, 0.65]) {
    const x = box.minX + (box.maxX - box.minX) * f;
    const y = box.minY + (box.maxY - box.minY) * f;
    scan((t) => ({ x, y: t }), box.minY - 0.5, box.maxY + 0.5);
    scan((t) => ({ x: t, y }), box.minX - 0.5, box.maxX + 0.5);
  }
  return min;
}

const orthogonal = (contours: Contour[]) =>
  contours.every((c) =>
    c.every((p, i) => {
      const q = c[(i + 1) % c.length]!;
      const dx = Math.abs(q.x - p.x);
      const dy = Math.abs(q.y - p.y);
      return dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6;
    }),
  );

describe('heavy weights', () => {
  /** B and 8 have a notch at the waist, and Q's tail crosses its bowl, by design. */
  const notched = new Set(['B', 'eight', 'Q']);

  it('keep every counter at least 1.4 units open, Black included', () => {
    const tight: string[] = [];
    for (const weight of WEIGHTS)
      for (const glyph of buildMaster('sans', 'roman', weight).glyphs) {
        if (!glyph.contours.length || notched.has(glyph.name) || !orthogonal(glyph.contours)) continue;
        const gap = narrowestCounter(glyph.contours);
        if (gap < 1.4) tight.push(`${glyph.name} ${weight}: ${gap.toFixed(2)}`);
      }
    expect(tight).toEqual([]);
  });
});
