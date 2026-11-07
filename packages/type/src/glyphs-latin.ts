import { ALL, bar, box, diagonal, type DrawContext, type GlyphDef, LEFT, level, mirror, open, p, RIGHT, rotate180, stem, withPen, yArms } from './draw';
import type { Stroke } from './geometry';

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
  {
    name: 'Schwa',
    unicode: 0x18f,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return rotate180([open(p(0, 7), p(w, 7), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 3.5))], w / 2, g.cap / 2);
    },
  },
  {
    name: 'Ereversed',
    unicode: 0x18e,
    lsb: 1,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(10);
      return mirror([open(p(w, g.top(g.cap)), p(0, g.top(g.cap)), p(0, g.bottom(0)), p(w, g.bottom(0))), bar(0, g.wide(9), g.cap / 2)], w / 2);
    },
  },
  {
    name: 'Eopen',
    unicode: 0x190,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const m = g.cap / 2;
      return mirror([open(p(0, 10), p(0, t, true), p(w, t, true), p(w, m), p(w * 0.35, m)), open(p(w, m), p(w, b, true), p(0, b, true), p(0, 4))], w / 2);
    },
  },
  {
    name: 'Oopen',
    unicode: 0x186,
    lsb: 1,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      return mirror([open(p(w, 9), p(w, g.top(g.cap), true), p(0, g.top(g.cap), true), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, 5))], w / 2);
    },
  },
  {
    name: 'Bhook',
    unicode: 0x181,
    lsb: 0.5,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(9), g.cap / 2, g.top(g.cap), RIGHT), box(0, g.wide(10), g.bottom(0), g.cap / 2, RIGHT), hookLeft(g, g.cap)],
  },
  {
    name: 'Dhook',
    unicode: 0x18a,
    lsb: 0.5,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(10), g.bottom(0), g.top(g.cap), RIGHT), hookLeft(g, g.cap)],
  },
  {
    name: 'Yhook',
    unicode: 0x1b3,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(11);
      const e = g.foot(w / 2, g.cap - 6);
      return [...yArms(g, w, g.cap, 6), bar(w - e, w + 2, g.top(g.cap))];
    },
  },
  {
    name: 'Nhookleft',
    unicode: 0x19d,
    lsb: 0.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(9.5);
      const e = g.foot(w, g.cap);
      const d = g.bottom(-3);
      return [open(p(0, g.cap), p(0, d, true), p(-2.5, d)), stem(w, 0, g.cap), diagonal(g, e - g.v / 2, g.cap, w + g.v / 2 - e, 0)];
    },
  },
  {
    name: 'Khook',
    unicode: 0x198,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(9.5);
      const y0 = 4.5;
      const reach = w + g.v / 2 - g.foot(w, g.cap - 1 - y0) - 1;
      const t = 0.4;
      return [
        stem(0, 0, g.cap),
        withPen(open(p(0, y0), p(reach, g.cap - 1)), g.diag),
        open(p(reach - 0.5, g.top(g.cap)), p(reach + 2, g.top(g.cap))),
        diagonal(g, reach * t, y0 + (g.cap - 1 - y0) * t, reach + 1, 0, [false, true]),
      ];
    },
  },
  {
    name: 'Germandbls',
    unicode: 0x1e9e,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(9);
      const w2 = g.wide(10);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const m = 7.5;
      return [open(p(0, 0), p(0, t, true), p(w, t, true), p(w, 11), p(w * 0.4, m)), open(p(w * 0.4, m), p(w2, m, true), p(w2, b, true), p(w * 0.45, b))];
    },
  },
  {
    name: 'Esh',
    unicode: 0x1a9,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(10);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const e = g.foot(w * 0.55, g.cap / 2);
      return [bar(0, w, t), bar(0, w, b), diagonal(g, e, g.cap, w * 0.55, g.cap / 2, [true, false]), diagonal(g, w * 0.55, g.cap / 2, e, 0, [false, true])];
    },
  },
  {
    name: 'Ezh',
    unicode: 0x1b7,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(-3);
      return [bar(0, w, t), diagonal(g, w - g.foot(w * 0.6, 4), g.cap, w * 0.4, 8, [true, false]), open(p(w * 0.4, 8), p(w, 8, true), p(w, b, true), p(0, b, true), p(0, 1))];
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
  {
    name: 'schwa',
    unicode: 0x259,
    lsb: 1,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(8);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return rotate180([open(p(0, 5.25), p(w, 5.25), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 2.5))], w / 2, g.xHeight / 2);
    },
  },
  {
    name: 'eturned',
    unicode: 0x1dd,
    lsb: 1,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(8);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return rotate180([open(p(0, 5.25), p(w, 5.25), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 2.5))], w / 2, g.xHeight / 2);
    },
  },
  {
    name: 'eopen',
    unicode: 0x25b,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      const m = 5;
      return mirror([open(p(0, 7.5), p(0, t, true), p(w, t, true), p(w, m), p(w * 0.35, m)), open(p(w, m), p(w, b, true), p(0, b, true), p(0, 2.5))], w / 2);
    },
  },
  {
    name: 'oopen',
    unicode: 0x254,
    lsb: 0.9,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return mirror([open(p(w, 7), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 3))], w / 2);
    },
  },
  {
    name: 'bhook',
    unicode: 0x253,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [hookRight(g, 0), box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), RIGHT)],
  },
  {
    name: 'dhook',
    unicode: 0x257,
    lsb: 1.25,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(8);
      return [hookRight(g, w), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT)];
    },
  },
  {
    name: 'yhook',
    unicode: 0x1b4,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(8.5);
      const tail = (w / 2) * (-g.descender / g.xHeight);
      const e = g.foot(w / 2, g.xHeight);
      return [diagonal(g, 0, g.xHeight, w / 2, 0), diagonal(g, w, g.xHeight, w / 2 - tail, g.descender), bar(w - e, w + 2, g.top(g.xHeight))];
    },
  },
  {
    name: 'nhookleft',
    unicode: 0x272,
    lsb: 0.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      const d = g.bottom(g.descender);
      return [open(p(-2.5, d), p(0, d, true), p(0, t), p(w, t, true), p(w, 0))];
    },
  },
  {
    name: 'khook',
    unicode: 0x199,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => [hookRight(g, 0), ...kArms(g, 0).slice(1)],
  },
  {
    name: 'alpha-latin',
    unicode: 0x251,
    lsb: 1.25,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(7.5);
      return [stem(w, 0, g.xHeight), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT)];
    },
  },
  {
    name: 'alphaturned-latin',
    unicode: 0x252,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(7.5);
      return [stem(0, 0, g.xHeight), box(0, w, g.bottom(0), g.top(g.xHeight), RIGHT)];
    },
  },
  {
    name: 'gscript',
    unicode: 0x261,
    lsb: 1.25,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      const d = g.bottom(g.descender);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), LEFT), open(p(w, g.xHeight), p(w, d, true), p(0, d, true), p(0, -1.5))];
    },
  },
  {
    name: 'Ismall',
    unicode: 0x26a,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(4);
      return [stem(w / 2, 0, g.xHeight), bar(0, w, g.top(g.xHeight)), bar(0, w, g.bottom(0))];
    },
  },
  {
    name: 'esh',
    unicode: 0x283,
    lsb: 0.5,
    rsb: 0.2,
    draw: (g) => {
      const t = g.top(g.ascender);
      const d = g.bottom(g.descender);
      return [open(p(-2.5, d), p(0, d, true), p(0, t, true), p(g.wide(4), t))];
    },
  },
  {
    name: 'ezh',
    unicode: 0x292,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.xHeight);
      const b = g.bottom(g.descender);
      return [bar(0, w, t), diagonal(g, w - g.foot(w * 0.6, 4), g.xHeight, w * 0.4, 4.5, [true, false]), open(p(w * 0.4, 4.5), p(w, 4.5, true), p(w, b, true), p(0, b, true), p(0, -2))];
    },
  },
  {
    name: 'glottalstop',
    unicode: 0x294,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.cap);
      const x = w / 2;
      const arm = Math.min(8.5, g.cap - g.h * 1.5 - g.aperture);
      return [open(p(0, 10.5), p(0, t, true), p(w, t, true), p(w, arm, true), p(x, arm, true), p(x, 0))];
    },
  },
  {
    name: 'upsilon-latin',
    unicode: 0x28a,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const b = g.bottom(0);
      return [open(p(-1, g.top(g.xHeight)), p(0, g.top(g.xHeight)), p(0, b, true), p(w, b, true), p(w, g.top(g.xHeight)), p(w + 1, g.top(g.xHeight)))];
    },
  },
  {
    name: 'vhook',
    unicode: 0x28b,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const b = g.bottom(0);
      return [open(p(0, g.xHeight), p(0, b, true), p(w, b, true), p(w, g.top(g.xHeight), true), p(w - 2, g.top(g.xHeight)))];
    },
  },
];

/** The hook of Ɓ and Ɗ: the top bar running left of the stem and turning down. */
function hookLeft(g: DrawContext, top: number): Stroke {
  const t = g.top(top);
  return open(p(-2.75, top - 3), p(-2.75, t, true), p(0, t));
}

/** The hook of ɓ, ɗ and ƙ: the ascender turning right at the top. */
function hookRight(g: DrawContext, x: number): Stroke {
  const t = g.top(g.ascender);
  return open(p(x, 0), p(x, t, true), p(x + 3, t));
}

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
