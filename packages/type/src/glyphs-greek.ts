import type { PlacedDef } from './composites';
import { ALL, bar, box, diagonal, dot, type DrawContext, type GlyphDef, open, p, RIGHT, stem, vee, withPen, yArms } from './draw';
import { letter } from './glyphs-core';
import { sigma } from './glyphs-plus';

/** Greek capitals with tonos take it to the left of the letter, not above it. */
export const GREEK_TONOS_CAPS: [string, number, string][] = [
  ['Alphatonos', 0x386, 'A'],
  ['Epsilontonos', 0x388, 'E'],
  ['Etatonos', 0x389, 'H'],
  ['Iotatonos', 0x38a, 'I'],
  ['Omicrontonos', 0x38c, 'O'],
  ['Upsilontonos', 0x38e, 'Y'],
  ['Omegatonos', 0x38f, 'Ohm'],
];

const UPPER: GlyphDef[] = [
  {
    name: 'Theta',
    unicode: 0x398,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      return [box(0, w, g.bottom(0), g.top(g.cap), ALL), bar(w * 0.3, w * 0.7, g.cap / 2)];
    },
  },
  {
    name: 'Lambda',
    unicode: 0x39b,
    lsb: 0.4,
    rsb: 0.4,
    draw: (g) => vee(g, 0, g.wide(10), 0, g.cap),
  },
  {
    name: 'Xi',
    unicode: 0x39e,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      return [bar(0, w, g.top(g.cap)), bar(1, w - 1, g.cap / 2), bar(0, w, g.bottom(0))];
    },
  },
  {
    name: 'Sigma',
    unicode: 0x3a3,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      return sigma(g, g.wide(10));
    },
  },
  {
    name: 'Psi',
    unicode: 0x3a8,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(12);
      const m = 5.5;
      return [open(p(0, g.cap), p(0, m, true), p(w, m, true), p(w, g.cap)), stem(w / 2, 0, g.cap)];
    },
  },
  {
    name: 'KaiSymbol',
    unicode: 0x3cf,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => [...letter('K').draw(g), stem(g.wide(9.5) + 0.5, -2.75, g.h)],
  },
];

const LOWER_DEFS: GlyphDef[] = [
  {
    name: 'beta',
    unicode: 0x3b2,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [stem(0, g.descender, g.top(g.y(14)) + g.h / 2), box(0, g.wide(7), 7, g.top(g.y(14)), RIGHT), box(0, g.wide(8), g.bottom(0), 7, RIGHT)],
  },
  {
    name: 'gamma',
    unicode: 0x3b3,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      return yArms(g, g.wide(8.5), g.xHeight, 0, g.descender);
    },
  },
  {
    name: 'delta',
    unicode: 0x3b4,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(8.5);
      const t = g.top(g.y(14));
      const shoulder = g.top(g.xHeight);
      return [box(0, w, g.bottom(0), shoulder, ALL), open(p(w * 0.3, shoulder), p(w * 0.3, t, true), p(w, t))];
    },
  },
  {
    name: 'zeta',
    unicode: 0x3b6,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => zetaStrokes(g, false),
  },
  {
    name: 'eta',
    unicode: 0x3b7,
    lsb: 1.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      return [open(p(0, 0), p(0, t), p(w, t, true), p(w, g.descender))];
    },
  },
  {
    name: 'theta',
    unicode: 0x3b8,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(8);
      return [box(0, w, g.bottom(0), g.top(g.y(14)), ALL), bar(0, w, g.y(7))];
    },
  },
  {
    name: 'iota',
    unicode: 0x3b9,
    lsb: 1.5,
    rsb: 0.75,
    draw: (g) => [open(p(0, g.xHeight), p(0, g.bottom(0), true), p(g.wide(2.25), g.bottom(0)))],
  },
  {
    name: 'lambda',
    unicode: 0x3bb,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(8.5);
      const y = 6;
      const x = 0.5 + (w - 0.5) * ((14 - y) / 14);
      return [diagonal(g, 0.5, 14, w, 0), diagonal(g, 0, 0, x, y, [true, false])];
    },
  },
  {
    name: 'xi',
    unicode: 0x3be,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => zetaStrokes(g, true),
  },
  {
    name: 'rho',
    unicode: 0x3c1,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [stem(0, g.descender, 5), box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), [false, true, true, true])],
  },
  {
    name: 'sigma',
    unicode: 0x3c3,
    lsb: 1.25,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(8);
      const t = g.top(g.xHeight);
      return [box(0, w, g.bottom(0), t, ALL), bar(w * 0.5, w + 2, t)];
    },
  },
  {
    name: 'sigmafinal',
    unicode: 0x3c2,
    lsb: 1.25,
    rsb: 0.9,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      const d = g.bottom(g.descender);
      const x = w * 0.8;
      return [open(p(w, g.y(7)), p(w, t, true), p(0, t, true), p(0, b, true), p(x, b, true), p(x, d, true), p(x - 2, d))];
    },
  },
  {
    name: 'tau',
    unicode: 0x3c4,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(8);
      const x = w * 0.45;
      return [bar(-0.5, w, g.top(g.xHeight)), open(p(x, g.xHeight), p(x, g.bottom(0), true), p(x + 2, g.bottom(0)))];
    },
  },
  {
    name: 'upsilon',
    unicode: 0x3c5,
    lsb: 1.4,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7.5);
      return [open(p(0, g.xHeight), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.xHeight))];
    },
  },
  {
    name: 'phi',
    unicode: 0x3c6,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), ALL), stem(w / 2, g.descender, 13.5)];
    },
  },
  {
    name: 'chi',
    unicode: 0x3c7,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(8);
      return [diagonal(g, 0, g.xHeight, w, g.descender), diagonal(g, w, g.xHeight, 0, g.descender)];
    },
  },
  {
    name: 'psi',
    unicode: 0x3c8,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      return [open(p(0, g.xHeight), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.xHeight)), stem(w / 2, g.descender, 13.5)];
    },
  },
  {
    name: 'omega',
    unicode: 0x3c9,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(11);
      return [open(p(0, g.xHeight), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.xHeight)), stem(w / 2, 0, 6.5)];
    },
  },
  {
    name: 'kaiSymbol',
    unicode: 0x3d7,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(7.5);
      const y0 = 3;
      const reach = w + g.v / 2 - g.foot(w, g.xHeight - y0);
      return [
        stem(0, 0, g.xHeight),
        withPen({ ...open(p(0, y0), p(reach, g.xHeight)), endCap: 'flat' }, g.diag),
        diagonal(g, reach * 0.45, y0 + (g.xHeight - y0) * 0.45, reach, 0, [false, true]),
        stem(reach + 0.5, g.descender + 1, g.h),
      ];
    },
  },
];

/** ζ and ξ: a tall top bar, a diagonal, and a bottom that turns down into a descender; ξ adds a middle bar. */
function zetaStrokes(g: DrawContext, xi: boolean) {
  const w = g.wide(7.5);
  const top = 14;
  const e = g.foot(w, top);
  const b = g.bottom(0);
  const d = g.bottom(g.descender);
  return [
    bar(0, w, g.top(top)),
    ...(xi ? [bar(1, w * 0.8, g.y(7.5))] : []),
    diagonal(g, w - e, top, e, 0),
    open(p(0, b), p(w, b, true), p(w, d, true), p(w - 2.5, d)),
  ];
}

const PUNCTUATION: GlyphDef[] = [
  { name: 'tonos', unicode: 0x384, lsb: 0.5, rsb: 0.25, draw: (g) => [withPen(diagonal(g, 0, g.cap - 3, 1.2, g.cap), { v: g.v * 0.9, h: g.h * 0.9 })] },
  {
    name: 'dieresistonos',
    unicode: 0x385,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const x = g.dot + 2.5;
      return [dot(g, 0, g.cap - 2), withPen(diagonal(g, x / 2 - 0.6, g.cap - 2.5, x / 2 + 0.6, g.cap + 0.5), { v: g.v * 0.9, h: g.h * 0.9 }), dot(g, x, g.cap - 2)];
    },
  },
  { name: 'anoteleia', unicode: 0x387, lsb: 1.25, rsb: 1.25, draw: (g) => [dot(g, 0, g.xHeight - g.dot)] },
  { name: 'numeralsign', unicode: 0x375, lsb: 1, rsb: 1, draw: (g) => [diagonal(g, 0, -4, 1.25, -0.5)] },
];

export const GREEK: GlyphDef[] = [...UPPER, ...LOWER_DEFS.map((def) => ({ ...def, lower: true })), ...PUNCTUATION];

/** Greek letters that are the Latin, Cyrillic or symbol glyph, shared as a component. */
export const GREEK_ALIASES: PlacedDef[] = (
  [
    ['Alpha', 0x391, 'A'],
    ['Beta', 0x392, 'B'],
    ['Gamma', 0x393, 'Ge-cy'],
    ['Delta', 0x394, 'increment'],
    ['Epsilon', 0x395, 'E'],
    ['Zeta', 0x396, 'Z'],
    ['Eta', 0x397, 'H'],
    ['Iota', 0x399, 'I'],
    ['Kappa', 0x39a, 'K'],
    ['Mu', 0x39c, 'M'],
    ['Nu', 0x39d, 'N'],
    ['Omicron', 0x39f, 'O'],
    ['Pi', 0x3a0, 'Pe-cy'],
    ['Rho', 0x3a1, 'P'],
    ['Tau', 0x3a4, 'T'],
    ['Upsilon', 0x3a5, 'Y'],
    ['Phi', 0x3a6, 'Ef-cy'],
    ['Chi', 0x3a7, 'X'],
    ['Omega', 0x3a9, 'Ohm'],
    ['alpha', 0x3b1, 'alpha-latin'],
    ['epsilon', 0x3b5, 'eopen'],
    ['kappa', 0x3ba, 'kgreenlandic'],
    ['mu-greek', 0x3bc, 'mu'],
    ['nu', 0x3bd, 'v'],
    ['omicron', 0x3bf, 'o'],
    ['questiongreek', 0x37e, 'semicolon'],
    ['numeralsigngreek', 0x374, 'minute'],
  ] as const
).map(([name, unicode, glyph]) => ({ name, unicode, parts: [{ glyph, after: true }] }));

/** Ά Έ Ή Ί Ό Ύ Ώ: the tonos set before the capital. */
export const GREEK_TONOS: PlacedDef[] = GREEK_TONOS_CAPS.map(([name, unicode, base]) => ({
  name,
  unicode,
  parts: [{ glyph: 'tonos', after: true, dx: -0.25 }, { glyph: base, after: true, dx: -0.75 }],
}));
