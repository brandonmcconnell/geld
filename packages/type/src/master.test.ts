import { bounds, type Contour, cutLeg, expandStroke, insetContour, winding } from './geometry';
import { ITALIC_SLOPE, METRICS, WEIGHTS } from './grid';
import { MATH_AXIS } from './draw';
import { buildMaster, type Family, flatten, type Style } from './master';
import { findSeams } from './seams';

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
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const chars = [...range(0x20, 0x7e), ...range(0xa0, 0xff), ...range(0x100, 0x17f)];

  it('covers Basic Latin, Latin-1 Supplement and Latin Extended-A', () => {
    const mapped = new Set(buildMaster('sans', 'roman', 400).glyphs.map((g) => g.unicode));
    expect(chars.filter((c) => !mapped.has(c))).toEqual([]);
  });

  it('keeps every glyph inside the clipping box at every weight, and drawn glyphs within their sidebearings', () => {
    for (const weight of WEIGHTS) {
      const master = buildMaster('sans', 'roman', weight);
      for (const glyph of master.glyphs) {
        const contours = flatten(master, glyph);
        if (!contours.length || glyph.mark) continue;
        const ys = contours.flat().map((p) => p.y);
        const xs = contours.flat().map((p) => p.x);
        expect(Math.min(...ys), `${glyph.name} ${weight}`).toBeGreaterThanOrEqual(METRICS.clipDescender);
        expect(Math.max(...ys), `${glyph.name} ${weight}`).toBeLessThanOrEqual(METRICS.clipAscender);
        if (glyph.components.length || glyph.name === 'fraction') continue;
        expect(Math.min(...xs), `${glyph.name} ${weight}`).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs), `${glyph.name} ${weight}`).toBeLessThanOrEqual(glyph.advance + 1e-9);
      }
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
  /** B and 8 (and в, B's small capital, and its Bulgarian form) have a notch at the waist, and Q's tail and ł's and ø's strokes cross, by design. */
  const notched = new Set(['B', 'eight', 'Q', 'lslash', 'Lslash', 'oslash', 'Oslash', 'litre', 've-cy', 've-cy.loclBGR']);

  it('keep every letter and figure counter at least 1.4 units open (superiors and ordinals in proportion), Black included', () => {
    const tight: string[] = [];
    for (const weight of WEIGHTS)
      for (const glyph of buildMaster('sans', 'roman', weight).glyphs) {
        const char = glyph.unicode === undefined ? '' : String.fromCodePoint(glyph.unicode);
        if (!(/[\p{L}\p{N}]/u.test(char) || glyph.name.includes('.locl')) || notched.has(glyph.name) || !orthogonal(glyph.contours)) continue;
        const small = /superior|inferior|\.dnom|^ord/.test(glyph.name);
        const gap = narrowestCounter(glyph.contours);
        if (gap < (small ? 0.75 : 1.4)) tight.push(`${glyph.name} ${weight}: ${gap.toFixed(2)}`);
      }
    expect(tight).toEqual([]);
  });
});

describe('italic', () => {
  /** Edges that are neither level nor on the slant: the cuts. */
  const cutEdges = (contour: Contour) =>
    contour
      .map((p, i) => {
        const q = contour[(i + 1) % contour.length]!;
        return { dx: q.x - p.x, dy: q.y - p.y };
      })
      .filter(({ dx, dy }) => Math.abs(dy) > 1e-6 && Math.abs(dx / dy - ITALIC_SLOPE) > 1e-6)
      .map(({ dx, dy }) => Math.hypot(dx, dy));

  it('cuts every corner of a slanted box to the same length, sharp corners and blunt alike', () => {
    for (const weight of WEIGHTS) {
      const o = buildMaster('sans', 'italic', weight).glyphs.find((g) => g.name === 'O')!;
      const [outer, inner] = o.contours.map(cutEdges);
      expect(outer).toHaveLength(4);
      expect(Math.max(...outer!) / Math.min(...outer!), `O ${weight}`).toBeLessThan(1.001);
      expect(Math.min(...inner!), `O ${weight}`).toBeGreaterThan(0.25);
    }
  });

  it('draws italic forms of a, f, l and y, and Cyrillic и п т ц, rather than slanting the roman', () => {
    const roman = buildMaster('sans', 'roman', 400).glyphs;
    const italic = buildMaster('sans', 'italic', 400).glyphs;
    for (const name of ['a', 'f', 'l', 'y', 'ii-cy', 'pe-cy', 'te-cy', 'tse-cy']) {
      const points = (glyphs: typeof roman) => glyphs.find((g) => g.name === name)!.contours.map((c) => c.length);
      expect(points(italic), name).not.toEqual(points(roman));
    }
  });
});

describe('seams and slivers', () => {
  it('leaves no touching edges and no sliver gaps in any glyph, family, style or weight', () => {
    const faults: string[] = [];
    for (const family of ['sans', 'dark'] as const)
      for (const style of ['roman', 'italic'] as const)
        for (const weight of WEIGHTS) {
          const master = buildMaster(family, style, weight);
          for (const glyph of master.glyphs) {
            const seams = findSeams(flatten(master, glyph));
            if (seams.length) faults.push(`${family} ${style} ${weight} ${glyph.name}: ${seams[0]!.kind} ${seams[0]!.gap.toFixed(2)}`);
          }
        }
    expect(faults).toEqual([]);
  });
});

describe('math operators', () => {
  const OPERATORS = ['plus', 'minus', 'equal', 'multiply', 'divide', 'less', 'greater', 'approxequal', 'notequal', 'asciitilde'];

  it('centre on one axis and share one width', () => {
    for (const weight of [100, 400, 900] as const) {
      const master = buildMaster('sans', 'roman', weight);
      const glyphs = OPERATORS.map((n) => master.glyphs.find((g) => g.name === n)!);
      const centres = glyphs.map((g) => {
        const b = bounds(flatten(master, g));
        return [g.name, Math.round(((b.minY + b.maxY) / 2) * 100) / 100];
      });
      expect(centres, `${weight}`).toEqual(OPERATORS.map((n) => [n, MATH_AXIS]));
      expect(new Set(glyphs.map((g) => g.advance)).size, `${weight} widths`).toBe(1);
    }
  });
});
