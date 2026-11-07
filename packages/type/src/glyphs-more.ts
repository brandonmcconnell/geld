/**
 * The rest of the plan's punctuation, operators and letterlike signs (3.3 to 3.5), drawn from the glyphs they extend
 * where one exists: ≡ from =, ∓ from ±, ∇ from ∆, ‽ from ?, ‱ from ‰.
 */
import type { PlacedDef } from './composites';
import { ALL, bar, box, comma, DASH_AXIS, diagonal, dot, type DrawContext, edgeAt, INSIDE, type GlyphDef, LEFT, MATH_AXIS, mirror, open, p, rotate180, solid, stem, tildeStroke, vee, withPen } from './draw';
import type { Stroke } from './geometry';
import { PUNCTUATION, UPPER } from './glyphs-core';
import { PLUS } from './glyphs-plus';
import { SYMBOLS } from './glyphs-symbols';

const draw = (name: string) => (g: DrawContext) => [...PUNCTUATION, ...PLUS, ...SYMBOLS].find((d) => d.name === name)!.draw(g);

/** The operators' height: as tall as + is wide, centred on the math axis. */
const HALF = 4;

/** ⊂ as one stroke: a bracket open to the right, its corners cut. */
const subset = (g: DrawContext, w: number, y0: number, y1: number): Stroke => open(p(w, g.top(y1)), p(0, g.top(y1), true), p(0, g.bottom(y0), true), p(w, g.bottom(y0)));

/** Half the height of ∈: three bars and two clear gaps at every weight. */
const elementHalf = (g: DrawContext) => Math.max(HALF, 1.5 * g.h + 1.4);

/** Half the size of ⊕ ⊗: their counters stay open however heavy the frame. */
const circledHalf = (g: DrawContext) => Math.max(4.5, 2 * g.h + 1.6);

/** ∈ built as the E it resembles, square-cornered: the bar through its middle would run into a cut's inner leg. */
const element = (g: DrawContext, w: number): Stroke[] => {
  const half = elementHalf(g);
  const [t, b] = [g.top(MATH_AXIS + half), g.bottom(MATH_AXIS - half)];
  return [open(p(w, t), p(0, t), p(0, b), p(w, b)), bar(0, w, MATH_AXIS)];
};

/** ⊆: ⊂ over a bar, a clear gap between them and the counter open at every weight. */
const reflexSubset = (g: DrawContext, w: number): Stroke[] => {
  const y0 = g.h + 1.25;
  return [subset(g, w, y0, Math.max(MATH_AXIS + HALF + 1, y0 + 2 * g.h + 2.5)), bar(0, w, g.bottom(0))];
};

const UPPER_DRAW = (name: string) => (g: DrawContext) => UPPER.find((d) => d.name === name)!.draw(g);

const reversedQuote = (g: DrawContext, x: number): Stroke[] => mirror(comma(g, x, g.cap - g.dot), x);

export const MORE: GlyphDef[] = [
  { name: 'figuredash', unicode: 0x2012, lsb: 0, rsb: 0, tabular: true, draw: (g) => [bar(0, g.wide(8), DASH_AXIS)] },
  { name: 'quotereversed', unicode: 0x201b, lsb: 1.25, rsb: 1.25, draw: (g) => reversedQuote(g, 0) },
  { name: 'quotedblreversed', unicode: 0x201f, lsb: 1.25, rsb: 1.25, draw: (g) => [...reversedQuote(g, 0), ...reversedQuote(g, g.dot + 1.25)] },
  {
    // ‣ the bullet as a right-pointing triangle, its point a 45° join.
    name: 'triangularbullet',
    unicode: 0x2023,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const h = 2 + g.v / 2;
      return [solid([p(0, DASH_AXIS - h), p(h, DASH_AXIS), p(0, DASH_AXIS + h)], 0.001)];
    },
  },
  {
    name: 'tripleprime',
    unicode: 0x2034,
    lsb: 1,
    rsb: 1,
    draw: (g) => [0, 1, 2].map((i) => diagonal(g, i * (g.v + 1.5), g.cap - 4.5, i * (g.v + 1.5) + 1.25, g.cap)),
  },
  {
    // ※ a cross with a dot in each gap, the dots kept clear of the arms at every weight.
    name: 'referencemark',
    unicode: 0x203b,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const r = g.dot + 1.5 * (g.diag.v / 2 + 1.2);
      const [cx, cy] = [r, MATH_AXIS];
      return [
        withPen(open(p(cx - r * 0.75, cy - r * 0.75), p(cx + r * 0.75, cy + r * 0.75)), g.diag),
        withPen(open(p(cx - r * 0.75, cy + r * 0.75), p(cx + r * 0.75, cy - r * 0.75)), g.diag),
        dot(g, cx, cy + r - g.dot / 2),
        dot(g, cx, cy - r - g.dot / 2),
        dot(g, cx - r, cy - g.dot / 2),
        dot(g, cx + r, cy - g.dot / 2),
      ];
    },
  },
  {
    // ‽ ? with !'s stroke through it: the arm's turn is no corner here, since the stroke carries on up to the top.
    name: 'interrobang',
    unicode: 0x203d,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.cap);
      const x = w / 2;
      const arm = Math.min(8.5, g.cap - g.h * 1.5 - g.aperture);
      return [open(p(0, g.y(10.5)), p(0, t, true), p(w, t, true), p(w, arm, true), p(x, arm), p(x, g.dot + 1.5)), stem(x, arm, g.cap), dot(g, x, 0)];
    },
  },
  { name: 'swungdash', unicode: 0x2053, lsb: 1, rsb: 1, draw: (g) => [tildeStroke(0, g.wide(12), DASH_AXIS - 1.75 / 2, 1.75)] },
  {
    name: 'pertenthousand',
    unicode: 0x2031,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(12);
      const size = Math.max(g.v, g.h) + Math.max(1.6, 4.4 - Math.max(g.v, g.h));
      const e = g.foot(w, g.cap);
      const ring = (x: number, y: number) => box(x, x + size, y + g.h / 2, y + g.h / 2 + size, ALL);
      const step = size + g.v + 1.4;
      return [ring(0, g.cap - size - g.h), ring(w - size, 0), ring(w - size + step, 0), ring(w - size + 2 * step, 0), diagonal(g, w - e, g.cap, e, 0)];
    },
  },
  {
    name: 'equivalence',
    unicode: 0x2261,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const gap = 1.25 + g.h;
      return [bar(0, w, MATH_AXIS + gap), bar(0, w, MATH_AXIS), bar(0, w, MATH_AXIS - gap)];
    },
  },
  {
    name: 'minusplus',
    unicode: 0x2213,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const top = MATH_AXIS + 1.5 + w / 2 - 0.5;
      return rotate180(draw('plusminus')(g), w / 2, top / 2);
    },
  },
  { name: 'nabla', unicode: 0x2207, lsb: 0.5, rsb: 0.5, draw: (g) => rotate180(draw('increment')(g), g.wide(11) / 2, g.cap / 2) },
  {
    // ∝ a square with its top and bottom carried on to the right, so only its left corners are cut.
    name: 'proportional',
    unicode: 0x221d,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const size = Math.max(6, 2 * Math.max(g.v, g.h) + 2);
      const m = size;
      const w = m + 3.5;
      const y0 = MATH_AXIS - size / 2 + g.h / 2;
      const y1 = MATH_AXIS + size / 2 - g.h / 2;
      return [box(0, m, y0, y1, LEFT), bar(m, w, y0), bar(m, w, y1)];
    },
  },
  {
    name: 'angle',
    unicode: 0x2220,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const top = g.cap - 2;
      const start = edgeAt(g.diag, 0, 0, w * 0.75, top, g.h, -1) + INSIDE;
      return [diagonal(g, 0, 0, w * 0.75, top), bar(start, w, g.bottom(0))];
    },
  },
  { name: 'logicaland', unicode: 0x2227, lsb: 1, rsb: 1, draw: (g) => rotate180(vee(g, 0, g.wide(8), MATH_AXIS + HALF, MATH_AXIS - HALF), g.wide(8) / 2, MATH_AXIS) },
  { name: 'logicalor', unicode: 0x2228, lsb: 1, rsb: 1, draw: (g) => vee(g, 0, g.wide(8), MATH_AXIS + HALF, MATH_AXIS - HALF) },
  {
    name: 'intersection',
    unicode: 0x2229,
    lsb: 1,
    rsb: 1,
    draw: (g) => [open(p(0, MATH_AXIS - HALF), p(0, g.top(MATH_AXIS + HALF), true), p(g.wide(8), g.top(MATH_AXIS + HALF), true), p(g.wide(8), MATH_AXIS - HALF))],
  },
  {
    name: 'union',
    unicode: 0x222a,
    lsb: 1,
    rsb: 1,
    draw: (g) => [open(p(0, MATH_AXIS + HALF), p(0, g.bottom(MATH_AXIS - HALF), true), p(g.wide(8), g.bottom(MATH_AXIS - HALF), true), p(g.wide(8), MATH_AXIS + HALF))],
  },
  { name: 'element', unicode: 0x2208, lsb: 1, rsb: 1, draw: (g) => element(g, g.wide(7)) },
  {
    name: 'notelement',
    unicode: 0x2209,
    lsb: 1,
    rsb: 1,
    draw: (g) => [...element(g, g.wide(7)), diagonal(g, g.wide(7) * 0.35, MATH_AXIS - elementHalf(g) - 1.5, g.wide(7) * 0.65, MATH_AXIS + elementHalf(g) + 1.5)],
  },
  { name: 'suchthat', unicode: 0x220b, lsb: 1, rsb: 1, draw: (g) => mirror(element(g, g.wide(7)), g.wide(7) / 2) },
  { name: 'propersubset', unicode: 0x2282, lsb: 1, rsb: 1, draw: (g) => [subset(g, g.wide(7), MATH_AXIS - HALF, MATH_AXIS + HALF)] },
  { name: 'propersuperset', unicode: 0x2283, lsb: 1, rsb: 1, draw: (g) => mirror([subset(g, g.wide(7), MATH_AXIS - HALF, MATH_AXIS + HALF)], g.wide(7) / 2) },
  {
    name: 'reflexsubset',
    unicode: 0x2286,
    lsb: 1,
    rsb: 1,
    draw: (g) => reflexSubset(g, g.wide(7)),
  },
  {
    name: 'reflexsuperset',
    unicode: 0x2287,
    lsb: 1,
    rsb: 1,
    draw: (g) => mirror(reflexSubset(g, g.wide(7)), g.wide(7) / 2),
  },
  {
    // ⊕ ⊗ in the cut square ∅ is drawn in, so the circled operators are one family.
    name: 'circleplus',
    unicode: 0x2295,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const half = circledHalf(g);
      const w = 2 * half;
      return [box(0, w, MATH_AXIS - half + g.h / 2, MATH_AXIS + half - g.h / 2, ALL), bar(0, w, MATH_AXIS), stem(w / 2, MATH_AXIS - half + g.h / 2, MATH_AXIS + half - g.h / 2)];
    },
  },
  {
    name: 'circlemultiply',
    unicode: 0x2297,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const half = circledHalf(g);
      const w = 2 * half;
      // The cross floats in the counter, its arms a clear gap short of the frame.
      const r = half - g.h - 0.9 - g.diag.v / 2;
      return [
        box(0, w, MATH_AXIS - half + g.h / 2, MATH_AXIS + half - g.h / 2, ALL),
        withPen(open(p(w / 2 - r, MATH_AXIS - r), p(w / 2 + r, MATH_AXIS + r)), g.diag),
        withPen(open(p(w / 2 - r, MATH_AXIS + r), p(w / 2 + r, MATH_AXIS - r)), g.diag),
      ];
    },
  },
  { name: 'perpendicular', unicode: 0x22a5, lsb: 1, rsb: 1, draw: (g) => [stem(g.wide(8) / 2, 0, MATH_AXIS + HALF + 1), bar(0, g.wide(8), g.bottom(0))] },
  // ∀ is a turned A and ∃ a reversed E, drawn from the letters so their joins are the letters'.
  { name: 'universal', unicode: 0x2200, lsb: 0.4, rsb: 0.4, draw: (g) => rotate180(UPPER_DRAW('A')(g), g.wide(10) / 2, g.cap / 2) },
  { name: 'existential', unicode: 0x2203, lsb: 1, rsb: 1.5, draw: (g) => mirror(UPPER_DRAW('E')(g), g.wide(10) / 2) },
  { name: 'ringoperator', unicode: 0x2218, lsb: 1, rsb: 1, draw: (g) => [box(0, 3 + g.v, MATH_AXIS - 1.5 - g.v / 2 + g.h / 2, MATH_AXIS + 1.5 + g.v / 2 - g.h / 2, ALL)] },
  { name: 'bulletoperator', unicode: 0x2219, lsb: 1, rsb: 1, draw: (g) => [dot(g, 0, MATH_AXIS - g.dot / 2)] },
  { name: 'dotoperator', unicode: 0x22c5, lsb: 1, rsb: 1, draw: (g) => [dot(g, 0, MATH_AXIS - g.dot / 2)] },
  { name: 'divisionslash', unicode: 0x2215, lsb: 0.25, rsb: 0.25, draw: (g) => [diagonal(g, 0, -1, 6, 13)] },
];

/** Signs that are another glyph, or several, under their own code point. */
export const MORE_ALIASES: PlacedDef[] = [
  { name: 'hyphentwo', unicode: 0x2010, parts: [{ glyph: 'hyphen' }] },
  { name: 'nonbreakinghyphen', unicode: 0x2011, parts: [{ glyph: 'hyphen' }] },
  { name: 'horizontalbar', unicode: 0x2015, parts: [{ glyph: 'emdash' }] },
  { name: 'onedotenleader', unicode: 0x2024, parts: [{ glyph: 'period' }] },
  { name: 'twodotenleader', unicode: 0x2025, parts: [{ glyph: 'period', after: true }, { glyph: 'period', after: true }] },
  { name: 'hyphenationpoint', unicode: 0x2027, parts: [{ glyph: 'periodcentered' }] },
  { name: 'exclamdbl', unicode: 0x203c, parts: [{ glyph: 'exclam', after: true }, { glyph: 'exclam', after: true }] },
  { name: 'lowasterisk', unicode: 0x204e, parts: [{ glyph: 'asterisk', dy: -9 }] },
  { name: 'asteriskoperator', unicode: 0x2217, parts: [{ glyph: 'asterisk', dy: MATH_AXIS - 11 }] },
  { name: 'degreecelsius', unicode: 0x2103, parts: [{ glyph: 'degree', after: true }, { glyph: 'C', after: true }] },
  { name: 'degreefahrenheit', unicode: 0x2109, parts: [{ glyph: 'degree', after: true }, { glyph: 'F', after: true }] },
  { name: 'information', unicode: 0x2139, parts: [{ glyph: 'i' }] },
  { name: 'lowverticallinemod', unicode: 0x2cc, parts: [{ glyph: 'verticallinemod', dy: -14 }] },
  { name: 'primedblmod', unicode: 0x2ba, parts: [{ glyph: 'second' }] },
];
