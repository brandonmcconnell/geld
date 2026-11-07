import { cutLeg, expandStroke, insetContour } from './geometry';
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
