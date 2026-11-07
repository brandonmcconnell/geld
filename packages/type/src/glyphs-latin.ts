import { ALL, bar, box, diagonal, type DrawContext, type GlyphDef, LEFT, level, open, p, RIGHT, stem, withPen } from './draw';

/** Latin letters with no Unicode decomposition into a base and marks, drawn on their own. */
const UPPER: GlyphDef[] = [
  {
    name: 'AE',
    unicode: 0xc6,
    lsb: 0.4,
    rsb: 1,
    draw: (g) => {
      const xm = g.wide(6);
      const x2 = xm + g.wide(6.5);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const y = 5;
      return [
        diagonal(g, 0, 0, xm, g.cap),
        open(p(x2, t), p(xm, t), p(xm, b), p(x2, b)),
        bar(xm, xm + g.wide(6), g.cap / 2),
        bar((xm * y) / g.cap, xm, y),
      ];
    },
  },
  {
    name: 'OE',
    unicode: 0x152,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const xm = g.wide(7);
      const x2 = xm + g.wide(6);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [open(p(xm, t), p(0, t, true), p(0, b, true), p(xm, b)), stem(xm, 0, g.cap), open(p(x2, t), p(xm, t)), bar(xm, x2 - 1, g.cap / 2), open(p(xm, b), p(x2, b))];
    },
  },
  {
    name: 'Oslash',
    unicode: 0xd8,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      return [box(0, w, g.bottom(0), g.top(g.cap), ALL), diagonal(g, -0.75, -1, w + 0.75, g.cap + 1)];
    },
  },
  {
    name: 'Eth',
    unicode: 0xd0,
    lsb: 0.5,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(10), g.bottom(0), g.top(g.cap), RIGHT), bar(-g.v / 2 - 1.5, 3.5, g.cap / 2)],
  },
  {
    name: 'Thorn',
    unicode: 0xde,
    lsb: 1.5,
    rsb: 1,
    draw: (g) => [stem(0, 0, g.cap), box(0, g.wide(9.5), 3, 11 - g.h / 2, RIGHT)],
  },
  {
    name: 'Hbar',
    unicode: 0x126,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(9);
      const y = (g.cap + g.cap / 2 + g.h / 2) / 2;
      return [stem(0, 0, g.cap), stem(w, 0, g.cap), bar(0, w, g.cap / 2), withPen(bar(-g.v / 2 - 1, w + g.v / 2 + 1, y), { v: g.v, h: g.h * 0.85 })];
    },
  },
  {
    name: 'Lslash',
    unicode: 0x141,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => [open(p(0, g.cap), p(0, g.bottom(0)), p(g.wide(9), g.bottom(0))), withPen(open(p(-2, 4.75), p(2.75, 9.25)), g.diag)],
  },
  {
    name: 'Eng',
    unicode: 0x14a,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(9.5);
      const t = g.top(g.cap);
      const d = g.bottom(-2.5);
      return [stem(0, 0, g.cap), open(p(0, t), p(w, t, true), p(w, d, true), p(w - 3, d))];
    },
  },
];

const LOWER_DEFS: GlyphDef[] = [
  { name: 'dotlessi', unicode: 0x131, lsb: 1.5, rsb: 1.5, draw: (g) => [stem(0, 0, g.xHeight)] },
  {
    name: 'dotlessj',
    unicode: 0x237,
    lsb: 0.5,
    rsb: 1.5,
    draw: (g) => {
      const d = g.bottom(g.descender);
      return [open(p(0, g.xHeight), p(0, d, true), p(-2.5, d))];
    },
  },
  {
    name: 'ae',
    unicode: 0xe6,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const xm = g.wide(6.5);
      const xe = xm + g.wide(6.5);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      const m = 5.25;
      return [open(p(0, t), p(xe, t, true), p(xe, m), p(xm, m)), stem(xm, 0, g.xHeight), box(0, xm, b, m, LEFT), open(p(xm, b), p(xe, b, true), p(xe, 2.5))];
    },
  },
  {
    name: 'oe',
    unicode: 0x153,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const xm = g.wide(7);
      const xe = xm + g.wide(6.5);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      const m = 5.25;
      return [box(0, xm, b, t, LEFT), open(p(xm, m), p(xe, m), p(xe, t, true), p(xm, t)), open(p(xm, b), p(xe, b, true), p(xe, 2.5))];
    },
  },
  {
    name: 'oslash',
    unicode: 0xf8,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(8);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), ALL), diagonal(g, -0.75, -0.75, w + 0.75, g.xHeight + 0.75)];
    },
  },
  {
    name: 'eth',
    unicode: 0xf0,
    lsb: 1.25,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(8);
      return [
        box(0, w, g.bottom(0), g.top(g.xHeight), LEFT),
        level(open(p(w, 0), p(w, 12), p(w - 3, g.ascender)), false, true),
        withPen(open(p(w - 3.25, 11.25), p(w + 1.25, 13.75)), g.diag),
      ];
    },
  },
  {
    name: 'thorn',
    unicode: 0xfe,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [stem(0, g.descender, g.ascender), box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), RIGHT)],
  },
  {
    name: 'germandbls',
    unicode: 0xdf,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => {
      const w1 = g.wide(6.5);
      const w2 = g.wide(8);
      const tA = g.top(g.ascender);
      const m = 8.5;
      const b = g.bottom(0);
      return [stem(0, 0, g.ascender), box(0, w1, m, tA, RIGHT), open(p(w1 * 0.5, m), p(w2, m, true), p(w2, b, true), p(w1 * 0.5, b))];
    },
  },
  {
    name: 'dcroat',
    unicode: 0x111,
    lsb: 1.25,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(8);
      return [stem(w, 0, g.ascender), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT), bar(w - 3, w + g.v / 2 + 1.25, 12.5)];
    },
  },
  {
    name: 'hbar',
    unicode: 0x127,
    lsb: 0.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      return [stem(0, 0, g.ascender), open(p(0, t), p(w, t, true), p(w, 0)), bar(-g.v / 2 - 1, 3, 12.5)];
    },
  },
  {
    name: 'lslash',
    unicode: 0x142,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => [stem(0, 0, g.ascender), withPen(open(p(-2, 6.25), p(2, 10.25)), g.diag)],
  },
  {
    name: 'eng',
    unicode: 0x14b,
    lsb: 1.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      const d = g.bottom(g.descender);
      return [open(p(0, 0), p(0, t), p(w, t, true), p(w, d, true), p(w - 2.5, d))];
    },
  },
  {
    name: 'kgreenlandic',
    unicode: 0x138,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => kArms(g, g.xHeight),
  },
  {
    name: 'longs',
    unicode: 0x17f,
    lsb: 0.5,
    rsb: 0.2,
    draw: (g) => {
      const t = g.top(g.ascender);
      return [open(p(0, 0), p(0, t, true), p(g.wide(4), t))];
    },
  },
];

/** k's stem and arms, with the stem as tall as `height` (the x-height gives ĸ). */
function kArms(g: DrawContext, height: number) {
  const w = g.wide(7.5);
  const y0 = 3;
  const reach = w + g.v / 2 - g.foot(w, g.xHeight - y0);
  const t = 0.45;
  return [
    stem(0, 0, height),
    withPen(level(open(p(0, y0), p(reach, g.xHeight)), false, true), g.diag),
    diagonal(g, reach * t, y0 + (g.xHeight - y0) * t, reach, 0, [false, true]),
  ];
}

export const LATIN_EXTRA: GlyphDef[] = [...UPPER, ...LOWER_DEFS.map((def) => ({ ...def, lower: true }))];
