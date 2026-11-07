import { ALL, bar, box, diagonal, type DrawContext, type GlyphDef, LEFT, level, mirror, open, p, RIGHT, rotate180, stem, withPen, yArms, barIntoDiagonal, diagonalOntoBar, edgeAt, INSIDE , crossbarReach , strikeThrough , strikeReach } from './draw';
import type { Stroke } from './geometry';
import { sigma } from './glyphs-plus';

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
      return [box(0, w, g.bottom(0), g.top(g.cap), ALL), diagonal(g, -1.25, -1.75, w + 1.25, g.cap + 1.75)];
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
      const thin = g.h * 0.85;
      const y = Math.min(Math.max((g.cap + g.cap / 2 + g.h / 2) / 2, g.cap / 2 + g.h / 2 + 1.6 + thin / 2), g.cap - thin / 2);
      return [stem(0, 0, g.cap), stem(w, 0, g.cap), bar(0, w, g.cap / 2), withPen(bar(-crossbarReach(g), w + crossbarReach(g), y), { v: g.v, h: thin })];
    },
  },
  {
    name: 'Lslash',
    unicode: 0x141,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => [open(p(0, g.cap), p(0, g.bottom(0)), p(g.wide(9), g.bottom(0))), strikeThrough(g, 0, Math.max(g.y(7), g.h + 1.6 + strikeReach(g)))],
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
      return rotate180([open(p(0, g.y(7)), p(w, g.y(7)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, g.y(3.5)))], w / 2, g.cap / 2);
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
      return mirror([open(p(0, g.y(10)), p(0, t, true), p(w, t, true), p(w, m), p(w * 0.35, m)), open(p(w, m), p(w, b, true), p(0, b, true), p(0, g.y(4)))], w / 2);
    },
  },
  {
    name: 'Oopen',
    unicode: 0x186,
    lsb: 1,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      return mirror([open(p(w, g.y(9)), p(w, g.top(g.cap), true), p(0, g.top(g.cap), true), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.y(5)))], w / 2);
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
        bar(edgeAt(g.diag, 0, y0, reach, g.cap - 1, g.cap - g.h, -1) + INSIDE, edgeAt(g.diag, 0, y0, reach, g.cap - 1, g.cap - 1, 1) + 1.5, g.top(g.cap)),
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
      const m = g.y(7.5);
      const low = m - g.h / 2;
      const start = edgeAt(g.pen, w, g.y(11), w * 0.4, low, m + g.h / 2, -1) + INSIDE;
      return [level(open(p(0, 0), p(0, t, true), p(w, t, true), p(w, g.y(11)), p(w * 0.4, low)), false, true), open(p(start, m), p(w2, m, true), p(w2, b, true), p(w * 0.45, b))];
    },
  },
  {
    name: 'Esh',
    unicode: 0x1a9,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => sigma(g, g.wide(10)),
  },
  {
    name: 'Ezh',
    unicode: 0x1b7,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const b = g.bottom(-3);
      const [top, slope] = barIntoDiagonal(g, 0, w, g.cap, [w * 0.4, g.y(8)], false);
      const waist = diagonalOntoBar(g, [slope!.points[0]!.x, g.cap], w * 0.4, g.y(8));
      return [top!, level(waist.diagonal, true, true), open(p(waist.start, g.y(8)), p(w, g.y(8), true), p(w, b, true), p(0, b, true), p(0, g.y(1)))];
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
      return [open(p(0, t), p(xe, t, true), p(xe, m), p(xm, m)), stem(xm, 0, g.xHeight), box(0, xm, b, m, LEFT), open(p(xm, b), p(xe, b, true), p(xe, g.y(2.5)))];
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
      return [box(0, xm, b, t, LEFT), open(p(xm, m), p(xe, m), p(xe, t, true), p(xm, t)), open(p(xm, b), p(xe, b, true), p(xe, g.y(2.5)))];
    },
  },
  {
    name: 'oslash',
    unicode: 0xf8,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(8);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), ALL), diagonal(g, -1.25, -1.5, w + 1.25, g.xHeight + 1.5)];
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
        level(open(p(w, 0), p(w, g.y(12)), p(w - 3, g.ascender)), false, true),
        withPen(open(p(w - 3.25, g.y(11.25)), p(w + 1.25, g.y(13.75))), g.diag),
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
      return [stem(0, 0, g.ascender), open(p(0, t), p(w, t, true), p(w, 0)), bar(-crossbarReach(g), Math.max(3, crossbarReach(g)), 12.5)];
    },
  },
  {
    name: 'lslash',
    unicode: 0x142,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => [stem(0, 0, g.ascender), strikeThrough(g, 0, g.y(8.25))],
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
      return rotate180([open(p(0, g.y(5.25)), p(w, g.y(5.25)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, g.y(2.5)))], w / 2, g.xHeight / 2);
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
      return rotate180([open(p(0, g.y(5.25)), p(w, g.y(5.25)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, g.y(2.5)))], w / 2, g.xHeight / 2);
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
      const m = g.y(5);
      return mirror([open(p(0, g.y(7.5)), p(0, t, true), p(w, t, true), p(w, m), p(w * 0.35, m)), open(p(w, m + g.h / 2), p(w, b, true), p(0, b, true), p(0, g.y(2.5)))], w / 2);
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
      return mirror([open(p(w, g.y(7)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, g.y(3)))], w / 2);
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
      return [box(0, w, g.bottom(0), g.top(g.xHeight), LEFT), open(p(w, g.xHeight), p(w, d, true), p(0, d, true), p(0, g.y(-1.5)))];
    },
  },
  {
    name: 'Ismall',
    unicode: 0x26a,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const r = crossbarReach(g);
      return [stem(r, 0, g.xHeight), bar(0, 2 * r, g.top(g.xHeight)), bar(0, 2 * r, g.bottom(0))];
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
      const b = g.bottom(g.descender);
      const [top, slope] = barIntoDiagonal(g, 0, w, g.xHeight, [w * 0.4, g.y(4.5)], false);
      const waist = diagonalOntoBar(g, [slope!.points[0]!.x, g.xHeight], w * 0.4, g.y(4.5));
      return [top!, level(waist.diagonal, true, true), open(p(waist.start, g.y(4.5)), p(w, g.y(4.5), true), p(w, b, true), p(0, b, true), p(0, g.y(-2)))];
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
      return [open(p(0, g.y(10.5)), p(0, t, true), p(w, t, true), p(w, arm, true), p(x, arm, true), p(x, 0))];
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
      const flick = crossbarReach(g);
      return [open(p(-flick, g.top(g.xHeight)), p(0, g.top(g.xHeight)), p(0, b, true), p(w, b, true), p(w, g.top(g.xHeight)), p(w + flick, g.top(g.xHeight)))];
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
export function hookLeft(g: DrawContext, top: number): Stroke {
  const t = g.top(top);
  const x = -(g.v + 1.6);
  return open(p(x, top - Math.max(3, g.h + 2.25)), p(x, t, true), p(0, t));
}

/** The hook of ɓ, ɗ and ƙ: the ascender turning right at the top. */
export function hookRight(g: DrawContext, x: number): Stroke {
  const t = g.top(g.ascender);
  return open(p(x, 0), p(x, t, true), p(x + g.v / 2 + 2.5, t));
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
