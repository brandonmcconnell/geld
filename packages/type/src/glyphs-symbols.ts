import {
  ALL,
  bar,
  box,
  chevronLeft,
  comma,
  DASH_AXIS,
  diagonal,
  dot,
  type DrawContext,
  type GlyphDef,
  LEFT,
  MATH_AXIS,
  mirror,
  open,
  p,
  ring,
  rotate180,
  shift,
  stem,
  withPen,
} from './draw';
import type { Stroke } from './geometry';


function questionStrokes(g: DrawContext): Stroke[] {
  const w = g.wide(7.5);
  const t = g.top(g.cap);
  const x = w / 2;
  const arm = Math.min(8.5, g.cap - g.h * 1.5 - g.aperture);
  return [open(p(0, 10.5), p(0, t, true), p(w, t, true), p(w, arm, true), p(x, arm, true), p(x, g.dot + 1.5)), dot(g, x, 0)];
}

/** ’ is a comma hung from the cap height; ‘ is the same comma turned about its own centre. */
const quote = (g: DrawContext, turned: boolean, x: number): Stroke[] => {
  const top = g.cap - g.dot;
  const strokes = comma(g, x, top);
  return turned ? rotate180(strokes, x, (top - 2.5 + g.cap) / 2) : strokes;
};

/** { as one stroke: hooks at the ends, and a 45° point at the middle reaching left. */
function brace(g: DrawContext): Stroke[] {
  const w = g.wide(4.5);
  const x = 1.75 + g.v / 2;
  const top = g.top(15.5);
  const bottom = g.bottom(-3.5);
  return [open(p(w, top), p(x, top, true), p(x, 6 + x), p(0, 6), p(x, 6 - x), p(x, bottom, true), p(w, bottom))];
}

export const SYMBOLS: GlyphDef[] = [
  {
    name: 'minus',
    unicode: 0x2212,
    lsb: 1,
    rsb: 1,
    draw: (g) => [bar(0, g.wide(8), MATH_AXIS)],
  },
  {
    name: 'Euro',
    unicode: 0x20ac,
    lsb: 0.5,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      const x = 2;
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [
        open(p(w + x, 10), p(w + x, t, true), p(x, t, true), p(x, b, true), p(w + x, b, true), p(w + x, 4)),
        bar(-0.5, x + 5, 8.5),
        bar(-0.5, x + 5, 5.5),
      ];
    },
  },
  {
    name: 'numbersign',
    unicode: 0x23,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(9);
      return [stem(w * 0.3, 1, 13), stem(w * 0.7, 1, 13), bar(0, w, 4.75), bar(0, w, 9.25)];
    },
  },
  {
    name: 'dollar',
    unicode: 0x24,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9.5);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [
        open(p(w, 10), p(w, t, true), p(0, t, true), p(0, g.cap / 2, true), p(w, g.cap / 2, true), p(w, b, true), p(0, b, true), p(0, 4)),
        stem(w / 2, -2, 16),
      ];
    },
  },
  {
    name: 'percent',
    unicode: 0x25,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(12);
      const inner = Math.max(1.6, 4.4 - Math.max(g.v, g.h));
      const size = Math.max(g.v, g.h) + inner;
      const e = g.foot(w, g.cap);
      return [ring(g, 0, g.cap - size - g.h, inner), ring(g, w - size, 0, inner), diagonal(g, w - e, g.cap, e, 0)];
    },
  },
  {
    name: 'ampersand',
    unicode: 0x26,
    lsb: 1,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(10);
      const b = g.bottom(0);
      const mid = 8;
      return [
        box(0.75, w * 0.6, mid, g.top(g.cap), ALL),
        open(p(w * 0.6, mid), p(0, mid, true), p(0, b, true), p(w * 0.75, b)),
        diagonal(g, 0.75 + w * 0.2, mid, w + g.v / 2 - g.foot(w, mid), 0, [false, true]),
        bar(w * 0.55, w + 0.5, Math.min(5.5, mid - g.h - 1.6)),
      ];
    },
  },
  {
    name: 'asterisk',
    unicode: 0x2a,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const c = { x: 2.6, y: 11 };
      const r = 2.75;
      const arm = (deg: number) => {
        const a = (deg * Math.PI) / 180;
        return withPen(open(p(c.x - r * Math.cos(a), c.y - r * Math.sin(a)), p(c.x + r * Math.cos(a), c.y + r * Math.sin(a))), g.diag);
      };
      return [stem(c.x, c.y - r, c.y + r), arm(30), arm(150)];
    },
  },
  {
    name: 'less',
    unicode: 0x3c,
    lsb: 1,
    rsb: 1,
    draw: (g) => chevronLeft(g, 4.5, MATH_AXIS),
  },
  {
    name: 'greater',
    unicode: 0x3e,
    lsb: 1,
    rsb: 1,
    draw: (g) => mirror(chevronLeft(g, 4.5, MATH_AXIS), 2.25),
  },
  {
    name: 'at',
    unicode: 0x40,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(13);
      const top = g.top(g.cap);
      const bottom = g.bottom(-2);
      const x0 = 3 + g.v / 2;
      const x1 = w - 3 - g.v / 2;
      return [
        open(p(w, 2), p(w, top, true), p(0, top, true), p(0, bottom, true), p(w * 0.8, bottom)),
        box(x0, x1, 3 + g.h / 2, 9.5 - g.h / 2, LEFT),
        open(p(x1, 9.5), p(x1, 3 + g.h / 2), p(w, 3 + g.h / 2)),
      ];
    },
  },
  { name: 'backslash', unicode: 0x5c, lsb: 0.25, rsb: 0.25, draw: (g) => [diagonal(g, 0, 15.5, 7, -3.5)] },
  {
    name: 'asciicircum',
    unicode: 0x5e,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(8);
      return [diagonal(g, 0, 7, w / 2, g.cap, [false, true]), diagonal(g, w, 7, w / 2, g.cap, [false, true])];
    },
  },
  { name: 'braceleft', unicode: 0x7b, lsb: 1, rsb: 0.75, draw: (g) => brace(g) },
  {
    name: 'braceright',
    unicode: 0x7d,
    lsb: 0.75,
    rsb: 1,
    draw: (g) => mirror(brace(g), (g.wide(4.5) + 0) / 2),
  },
  { name: 'bar', unicode: 0x7c, lsb: 1.75, rsb: 1.75, draw: () => [stem(0, -3.5, 15.5)] },
  {
    name: 'asciitilde',
    unicode: 0x7e,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const s = 2.25;
      const y = MATH_AXIS - s / 2;
      return [withPen(open(p(0, y), p(s, y + s, true), p(2 * s, y, true), p(3 * s, y + s)), g.pen)];
    },
  },
  { name: 'quoteleft', unicode: 0x2018, lsb: 1.25, rsb: 1.25, draw: (g) => quote(g, true, 0) },
  { name: 'quoteright', unicode: 0x2019, lsb: 1.25, rsb: 1.25, draw: (g) => quote(g, false, 0) },
  {
    name: 'quotedblleft',
    unicode: 0x201c,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [...quote(g, true, 0), ...quote(g, true, g.dot + 1.25)],
  },
  {
    name: 'quotedblright',
    unicode: 0x201d,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [...quote(g, false, 0), ...quote(g, false, g.dot + 1.25)],
  },
  { name: 'quotesinglbase', unicode: 0x201a, lsb: 1.25, rsb: 1.25, draw: (g) => comma(g, 0, 0) },
  {
    name: 'quotedblbase',
    unicode: 0x201e,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [...comma(g, 0, 0), ...comma(g, g.dot + 1.25, 0)],
  },
  { name: 'guilsinglleft', unicode: 0x2039, lsb: 1, rsb: 1, draw: (g) => chevronLeft(g, 3, DASH_AXIS) },
  { name: 'guilsinglright', unicode: 0x203a, lsb: 1, rsb: 1, draw: (g) => mirror(chevronLeft(g, 3, DASH_AXIS), 1.5) },
  {
    name: 'guillemetleft',
    unicode: 0xab,
    lsb: 1,
    rsb: 1,
    draw: (g) => [...chevronLeft(g, 3, DASH_AXIS), ...shift(chevronLeft(g, 3, DASH_AXIS), 2.5 + g.v, 0)],
  },
  {
    name: 'guillemetright',
    unicode: 0xbb,
    lsb: 1,
    rsb: 1,
    draw: (g) => mirror([...chevronLeft(g, 3, DASH_AXIS), ...shift(chevronLeft(g, 3, DASH_AXIS), 2.5 + g.v, 0)], (3 + 2.5 + g.v) / 2),
  },
  { name: 'exclamdown', unicode: 0xa1, lsb: 1.5, rsb: 1.5, draw: (g) => rotate180([stem(0, g.dot + 1.5, g.cap), dot(g, 0, 0)], 0, 5) },
  { name: 'questiondown', unicode: 0xbf, lsb: 1, rsb: 1, draw: (g) => rotate180(questionStrokes(g), g.wide(7.5) / 2, 5) },
  { name: 'periodcentered', unicode: 0xb7, lsb: 1.25, rsb: 1.25, draw: (g) => [dot(g, 0, DASH_AXIS - g.dot / 2)] },
  { name: 'bullet', unicode: 0x2022, lsb: 1.25, rsb: 1.25, draw: (g) => [withPen(open(p(0, DASH_AXIS - 1.5 - g.v / 2), p(0, DASH_AXIS + 1.5 + g.v / 2)), { v: 3 + g.v, h: 3 + g.v })] },
  {
    name: 'ellipsis',
    unicode: 0x2026,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [dot(g, 0, 0), dot(g, g.dot + 2, 0), dot(g, 2 * (g.dot + 2), 0)],
  },
  {
    name: 'multiply',
    unicode: 0xd7,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const r = 3;
      return [withPen(open(p(0, MATH_AXIS - r), p(2 * r, MATH_AXIS + r)), g.diag), withPen(open(p(0, MATH_AXIS + r), p(2 * r, MATH_AXIS - r)), g.diag)];
    },
  },
  {
    name: 'divide',
    unicode: 0xf7,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      return [bar(0, w, MATH_AXIS), dot(g, w / 2, MATH_AXIS + g.h / 2 + 1.25), dot(g, w / 2, MATH_AXIS - g.h / 2 - 1.25 - g.dot)];
    },
  },
  {
    name: 'plusminus',
    unicode: 0xb1,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const y = MATH_AXIS + 1.5;
      return [bar(0, w, y), stem(w / 2, y - w / 2 + 0.5, y + w / 2 - 0.5), bar(0, w, g.bottom(0))];
    },
  },
  { name: 'degree', unicode: 0xb0, lsb: 1, rsb: 1, draw: (g) => [ring(g, 0, g.cap - Math.max(g.v, g.h) - 1.6 - g.h, 1.6)] },
  { name: 'brokenbar', unicode: 0xa6, lsb: 1.75, rsb: 1.75, draw: () => [stem(0, -3.5, 5.5), stem(0, 7.5, 15.5)] },
  {
    name: 'logicalnot',
    unicode: 0xac,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      return [open(p(0, MATH_AXIS + 1), p(w, MATH_AXIS + 1), p(w, MATH_AXIS - 2.5))];
    },
  },
  {
    name: 'section',
    unicode: 0xa7,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.cap);
      const b = g.bottom(-2);
      return [
        open(p(w, 11), p(w, t, true), p(0, t, true), p(0, 8, true), p(w, 8, true), p(w, 4)),
        open(p(0, 8), p(0, 4, true), p(w, 4, true), p(w, b, true), p(0, b, true), p(0, 1)),
      ];
    },
  },
];
