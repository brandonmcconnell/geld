import {
  ALL,
  bar,
  box,
  comma,
  DASH_AXIS,
  diagonal,
  dot,
  type DrawContext,
  fromStemTop,
  type GlyphDef,
  LEFT,
  level,
  MATH_AXIS,
  open,
  p,
  RIGHT,
  shift,
  inPen,
  stem,
  vee,
  yArms,
  withPen,
  zed,
  crossbarReach,
} from './draw';
import type { Stroke } from './geometry';
import { smallPen } from './glyphs-figures';

export const UPPER: GlyphDef[] = [
  {
    name: 'A',
    unicode: 0x41,
    lsb: 0.4,
    rsb: 0.4,
    draw: (g) => {
      const w = g.wide(10);
      const y = g.y(5);
      const x = (w / 2) * (y / g.cap);
      return [...vee(g, 0, w, 0, g.cap), bar(x, w - x, y)];
    },
  },
  {
    name: 'B',
    unicode: 0x42,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(9), g.cap / 2, g.top(g.cap), RIGHT), box(0, g.wide(10), g.bottom(0), g.cap / 2, RIGHT)],
  },
  {
    name: 'C',
    unicode: 0x43,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      return [open(p(w, g.y(9)), p(w, g.top(g.cap), true), p(0, g.top(g.cap), true), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.y(5)))];
    },
  },
  {
    name: 'D',
    unicode: 0x44,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(10), g.bottom(0), g.top(g.cap), RIGHT)],
  },
  {
    name: 'E',
    unicode: 0x45,
    lsb: 1.5,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      return [open(p(w, g.top(g.cap)), p(0, g.top(g.cap)), p(0, g.bottom(0)), p(w, g.bottom(0))), bar(0, g.wide(9), g.cap / 2)];
    },
  },
  {
    name: 'F',
    unicode: 0x46,
    lsb: 1.5,
    rsb: 0.75,
    draw: (g) => [open(p(g.wide(10), g.top(g.cap)), p(0, g.top(g.cap)), p(0, 0)), bar(0, g.wide(8.5), g.cap / 2)],
  },
  {
    name: 'G',
    unicode: 0x47,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      const y = g.top(Math.max(g.cap / 2, 2 * g.h + 1.6));
      return [
        open(p(w, g.y(9)), p(w, g.top(g.cap), true), p(0, g.top(g.cap), true), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, y), p(w * 0.4, y)),
      ];
    },
  },
  {
    name: 'H',
    unicode: 0x48,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(9);
      return [stem(0, 0, g.cap), stem(w, 0, g.cap), bar(0, w, g.cap / 2)];
    },
  },
  { name: 'I', unicode: 0x49, lsb: 1.5, rsb: 1.5, draw: (g) => [stem(0, 0, g.cap)] },
  {
    name: 'J',
    unicode: 0x4a,
    lsb: 0.75,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      return [open(p(w, g.cap), p(w, g.bottom(0), true), p(0, g.bottom(0), true), p(0, g.y(4)))];
    },
  },
  {
    name: 'K',
    unicode: 0x4b,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(9.5);
      const y0 = g.y(4.5);
      const reach = w + g.v / 2 - g.foot(w, g.cap - y0);
      const t = 0.4;
      return [
        stem(0, 0, g.cap),
        withPen(level(open(p(0, y0), p(reach, g.cap)), false, true), g.diag),
        diagonal(g, reach * t, y0 + (g.cap - y0) * t, reach, 0, [false, true]),
      ];
    },
  },
  {
    name: 'L',
    unicode: 0x4c,
    lsb: 1.5,
    rsb: 0.5,
    draw: (g) => [open(p(0, g.cap), p(0, g.bottom(0)), p(g.wide(9), g.bottom(0)))],
  },
  {
    name: 'M',
    unicode: 0x4d,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(11);
      const y = g.y(3.5);
      return [stem(0, 0, g.cap), stem(w, 0, g.cap), fromStemTop(g, 0, 1, w / 2, y), fromStemTop(g, w, -1, w / 2, y)];
    },
  },
  {
    name: 'N',
    unicode: 0x4e,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(9.5);
      const e = g.foot(w, g.cap);
      return [stem(0, 0, g.cap), stem(w, 0, g.cap), diagonal(g, e - g.v / 2, g.cap, w + g.v / 2 - e, 0)];
    },
  },
  {
    name: 'O',
    unicode: 0x4f,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(10), g.bottom(0), g.top(g.cap), ALL)],
  },
  {
    name: 'P',
    unicode: 0x50,
    lsb: 1.5,
    rsb: 1,
    draw: (g) => [stem(0, 0, g.cap), box(0, g.wide(9.5), g.y(6), g.top(g.cap), RIGHT)],
  },
  {
    name: 'Q',
    unicode: 0x51,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      return [box(0, w, g.bottom(0), g.top(g.cap), ALL), diagonal(g, w * 0.55, 3.5, w * 0.55 + 5.5, -2, [false, true])];
    },
  },
  {
    name: 'R',
    unicode: 0x52,
    lsb: 1.5,
    rsb: 0.4,
    draw: (g) => {
      const w = g.wide(9.5);
      const bowl = g.y(6);
      const reach = w + g.v / 2 - g.foot(w * 0.6, bowl);
      return [stem(0, 0, g.cap), box(0, w, bowl, g.top(g.cap), RIGHT), diagonal(g, w * 0.4, bowl, reach, 0, [false, true])];
    },
  },
  {
    name: 'S',
    unicode: 0x53,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9.5);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [open(p(w, g.y(10)), p(w, t, true), p(0, t, true), p(0, g.cap / 2, true), p(w, g.cap / 2, true), p(w, b, true), p(0, b, true), p(0, g.y(4)))];
    },
  },
  {
    name: 'T',
    unicode: 0x54,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(11);
      return [bar(0, w, g.top(g.cap)), stem(w / 2, 0, g.cap)];
    },
  },
  {
    name: 'U',
    unicode: 0x55,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(10);
      return [open(p(0, g.cap), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.cap))];
    },
  },
  { name: 'V', unicode: 0x56, lsb: 0.3, rsb: 0.3, draw: (g) => vee(g, 0, g.wide(11), g.cap, 0) },
  {
    name: 'W',
    unicode: 0x57,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(15);
      return [...vee(g, 0, w / 2, g.cap, 0), ...vee(g, w / 2, w, g.cap, 0)].map((s, i) =>
        i === 1 || i === 2 ? { ...s, points: s.points.map((q) => (q.y === g.cap ? { ...q, y: g.y(10.5) } : q)) } : s,
      );
    },
  },
  {
    name: 'X',
    unicode: 0x58,
    lsb: 0.4,
    rsb: 0.4,
    draw: (g) => {
      const w = g.wide(10);
      return [diagonal(g, 0, g.cap, w, 0), diagonal(g, w, g.cap, 0, 0)];
    },
  },
  {
    name: 'Y',
    unicode: 0x59,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(11);
      return [...yArms(g, w, g.cap, g.y(6))];
    },
  },
  { name: 'Z', unicode: 0x5a, lsb: 0.75, rsb: 0.75, draw: (g) => zed(g, g.wide(10), g.cap) },
];

const LOWER_DEFS: GlyphDef[] = [
  {
    name: 'a',
    unicode: 0x61,
    lsb: 1,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.xHeight);
      return [open(p(0, t), p(w, t, true), p(w, 0)), box(0, w, g.bottom(0), g.y(5.25), LEFT)];
    },
    italic: (g) => {
      const w = g.wide(7.5);
      return [stem(w, 0, g.xHeight), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT)];
    },
  },
  {
    name: 'b',
    unicode: 0x62,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [stem(0, 0, g.ascender), box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), RIGHT)],
  },
  {
    name: 'c',
    unicode: 0x63,
    lsb: 1.25,
    rsb: 0.9,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return [open(p(w, g.y(7)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, g.y(3)))];
    },
  },
  {
    name: 'd',
    unicode: 0x64,
    lsb: 1.25,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      return [stem(w, 0, g.ascender), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT)];
    },
  },
  {
    name: 'e',
    unicode: 0x65,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return [open(p(0, g.y(5.25)), p(w, g.y(5.25)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, g.y(2.5)))];
    },
  },
  {
    name: 'f',
    unicode: 0x66,
    lsb: 0.5,
    rsb: 0.2,
    draw: (g) => {
      const t = g.top(g.ascender);
      return [open(p(0, 0), p(0, t, true), p(g.wide(4), t)), bar(-crossbarReach(g), g.wide(3.5), g.top(g.xHeight))];
    },
    italic: (g) => {
      const t = g.top(g.ascender);
      const d = g.bottom(g.descender);
      return [open(p(-2.5, d), p(0, d, true), p(0, t, true), p(g.wide(4), t)), bar(-crossbarReach(g), g.wide(3.5), g.top(g.xHeight))];
    },
  },
  {
    name: 'g',
    unicode: 0x67,
    lsb: 1.25,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      const d = g.bottom(g.descender);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), LEFT), open(p(w, g.xHeight), p(w, d, true), p(0, d, true), p(0, g.y(-1.5)))];
    },
  },
  {
    name: 'h',
    unicode: 0x68,
    lsb: 1.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      return [stem(0, 0, g.ascender), open(p(0, t), p(w, t, true), p(w, 0))];
    },
  },
  {
    name: 'i',
    unicode: 0x69,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => [stem(0, 0, g.xHeight), dot(g, 0, g.xHeight + g.y(1.5))],
  },
  {
    name: 'j',
    unicode: 0x6a,
    lsb: 0.5,
    rsb: 1.5,
    draw: (g) => {
      const d = g.bottom(g.descender);
      return [open(p(0, g.xHeight), p(0, d, true), p(-2.5, d)), dot(g, 0, g.xHeight + g.y(1.5))];
    },
  },
  {
    name: 'k',
    unicode: 0x6b,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(7.5);
      const y0 = 3;
      const reach = w + g.v / 2 - g.foot(w, g.xHeight - y0);
      const t = 0.45;
      return [
        stem(0, 0, g.ascender),
        withPen(level(open(p(0, y0), p(reach, g.xHeight)), false, true), g.diag),
        diagonal(g, reach * t, y0 + (g.xHeight - y0) * t, reach, 0, [false, true]),
      ];
    },
  },
  {
    name: 'l',
    unicode: 0x6c,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => [stem(0, 0, g.ascender)],
    italic: (g) => [open(p(0, g.ascender), p(0, g.bottom(0), true), p(g.wide(2.5), g.bottom(0)))],
  },
  {
    name: 'm',
    unicode: 0x6d,
    lsb: 1.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(6.5);
      const t = g.top(g.xHeight);
      return [stem(0, 0, g.xHeight), open(p(0, t), p(w, t), p(w, 0)), open(p(w, t), p(2 * w, t, true), p(2 * w, 0))];
    },
  },
  {
    name: 'n',
    unicode: 0x6e,
    lsb: 1.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      return [open(p(0, 0), p(0, g.top(g.xHeight)), p(w, g.top(g.xHeight), true), p(w, 0))];
    },
  },
  {
    name: 'o',
    unicode: 0x6f,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), ALL)],
  },
  {
    name: 'p',
    unicode: 0x70,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => [stem(0, g.descender, g.xHeight), box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), RIGHT)],
  },
  {
    name: 'q',
    unicode: 0x71,
    lsb: 1.25,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      return [stem(w, g.descender, g.xHeight), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT)];
    },
  },
  {
    name: 'r',
    unicode: 0x72,
    lsb: 1.5,
    rsb: 0.4,
    draw: (g) => [stem(0, 0, g.xHeight), bar(0, g.wide(5), g.top(g.xHeight))],
  },
  {
    name: 's',
    unicode: 0x73,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return [open(p(w, g.y(7.5)), p(w, t, true), p(0, t, true), p(0, g.y(5), true), p(w, g.y(5), true), p(w, b, true), p(0, b, true), p(0, g.y(2.5)))];
    },
  },
  {
    name: 't',
    unicode: 0x74,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const b = g.bottom(0);
      return [open(p(0, g.y(13)), p(0, b, true), p(g.wide(3.5), b)), bar(-crossbarReach(g), g.wide(3.5), g.top(g.xHeight))];
    },
  },
  {
    name: 'u',
    unicode: 0x75,
    lsb: 1.4,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(7);
      return [open(p(0, g.xHeight), p(0, g.bottom(0), true), p(w, g.bottom(0))), stem(w, 0, g.xHeight)];
    },
  },
  { name: 'v', unicode: 0x76, lsb: 0.3, rsb: 0.3, draw: (g) => vee(g, 0, g.wide(8.5), g.xHeight, 0) },
  {
    name: 'w',
    unicode: 0x77,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(12);
      return [...vee(g, 0, w / 2, g.xHeight, 0), ...vee(g, w / 2, w, g.xHeight, 0)].map((s, i) =>
        i === 1 || i === 2 ? { ...s, points: s.points.map((q) => (q.y === g.xHeight ? { ...q, y: g.y(7.5) } : q)) } : s,
      );
    },
  },
  {
    name: 'x',
    unicode: 0x78,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(8);
      return [diagonal(g, 0, g.xHeight, w, 0), diagonal(g, w, g.xHeight, 0, 0)];
    },
  },
  {
    name: 'y',
    unicode: 0x79,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(8.5);
      const tail = (w / 2) * (-g.descender / g.xHeight);
      return [diagonal(g, 0, g.xHeight, w / 2, 0), diagonal(g, w, g.xHeight, w / 2 - tail, g.descender)];
    },
    italic: (g) => {
      const w = g.wide(7);
      const d = g.bottom(g.descender);
      return [open(p(0, g.xHeight), p(0, g.bottom(0), true), p(w, g.bottom(0))), open(p(w, g.xHeight), p(w, d, true), p(w - 3, d))];
    },
  },
  { name: 'z', unicode: 0x7a, lsb: 0.75, rsb: 0.75, draw: (g) => zed(g, g.wide(7.5), g.xHeight) },
];
export const LOWER: GlyphDef[] = LOWER_DEFS.map((def) => ({ ...def, lower: true }));

export const FIGURES: GlyphDef[] = [
  {
    name: 'zero',
    unicode: 0x30,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [box(0, g.wide(9), g.bottom(0), g.top(g.cap), ALL)],
  },
  {
    name: 'one',
    unicode: 0x31,
    lsb: 1,
    rsb: 1.5,
    draw: (g) => {
      const x = g.wide(3);
      const flag = g.y(3);
      return [stem(x, 0, g.cap), withPen(level(open(p(0, g.cap - flag), p(x + g.v / 2 - g.foot(x, flag), g.cap)), false, true), g.diag)];
    },
  },
  {
    name: 'two',
    unicode: 0x32,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const turn = g.y(7.5);
      const end = g.foot(w, turn - b) - g.v / 2;
      return [level(open(p(0, g.y(10)), p(0, t, true), p(w, t, true), p(w, turn), p(end, b)), false, true), bar(0, w, b)];
    },
  },
  {
    name: 'three',
    unicode: 0x33,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const m = g.cap / 2;
      return [open(p(0, g.y(10)), p(0, t, true), p(w, t, true), p(w, m), p(w * 0.35, m)), open(p(w, m), p(w, b, true), p(0, b, true), p(0, g.y(4)))];
    },
  },
  {
    name: 'four',
    unicode: 0x34,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      const x = w * 0.72;
      const y = g.y(4.5);
      return [stem(x, 0, g.cap), bar(0, w, y), diagonal(g, x + g.v / 2 - g.foot(x, g.cap - y), g.cap, g.foot(x, g.cap - y), y)];
    },
  },
  {
    name: 'five',
    unicode: 0x35,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [open(p(w, t), p(0, t), p(0, g.y(8)), p(w, g.y(8), true), p(w, b, true), p(0, b, true), p(0, g.y(4)))];
    },
  },
  {
    name: 'six',
    unicode: 0x36,
    lsb: 1.25,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const m = g.y(8);
      return [open(p(w, Math.max(g.y(10.5), m + g.h / 2 + g.aperture)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, m, true), p(0, m))];
    },
  },
  {
    name: 'seven',
    unicode: 0x37,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(9);
      return [bar(0, w, g.top(g.cap)), diagonal(g, w - g.foot(w * 0.65, g.cap), g.cap, w * 0.35, 0)];
    },
  },
  {
    name: 'eight',
    unicode: 0x38,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(9.5);
      return [box(g.y(0.5), w - g.y(0.5), g.cap / 2, g.top(g.cap), ALL), box(0, w, g.bottom(0), g.cap / 2, ALL)];
    },
  },
  {
    name: 'nine',
    unicode: 0x39,
    lsb: 1,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const m = g.y(6);
      return [open(p(0, Math.min(g.y(3.5), m - g.h / 2 - g.aperture)), p(0, b, true), p(w, b, true), p(w, t, true), p(0, t, true), p(0, m, true), p(w, m))];
    },
  },
];


export const PUNCTUATION: GlyphDef[] = [
  { name: 'period', unicode: 0x2e, lsb: 1.25, rsb: 1.25, draw: (g) => [dot(g, 0, 0)] },
  {
    name: 'comma',
    unicode: 0x2c,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => comma(g, 0, 0),
  },
  { name: 'colon', unicode: 0x3a, lsb: 1.25, rsb: 1.25, draw: (g) => [dot(g, 0, 0), dot(g, 0, g.xHeight - g.dot)] },
  {
    name: 'semicolon',
    unicode: 0x3b,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [...comma(g, 0, 0), dot(g, 0, g.xHeight - g.dot)],
  },
  { name: 'exclam', unicode: 0x21, lsb: 1.5, rsb: 1.5, draw: (g) => [stem(0, g.dot + 1.5, g.cap), dot(g, 0, 0)] },
  {
    name: 'question',
    unicode: 0x3f,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.cap);
      const x = w / 2;
      const arm = Math.min(8.5, g.cap - g.h * 1.5 - g.aperture);
      return [open(p(0, g.y(10.5)), p(0, t, true), p(w, t, true), p(w, arm, true), p(x, arm, true), p(x, g.dot + 1.5)), dot(g, x, 0)];
    },
  },
  { name: 'hyphen', unicode: 0x2d, lsb: 1, rsb: 1, draw: (g) => [bar(0, g.wide(4.5), DASH_AXIS)] },
  { name: 'endash', unicode: 0x2013, lsb: 0.5, rsb: 0.5, draw: () => [bar(0, 9, DASH_AXIS)] },
  { name: 'emdash', unicode: 0x2014, lsb: 1, rsb: 1, draw: () => [bar(0, 18, DASH_AXIS)] },
  { name: 'quotesingle', unicode: 0x27, lsb: 1.25, rsb: 1.25, draw: (g) => [stem(0, g.cap - 4, g.cap)] },
  {
    name: 'quotedbl',
    unicode: 0x22,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => [stem(0, g.cap - 4, g.cap), stem(g.v + 1.5, g.cap - 4, g.cap)],
  },
  {
    name: 'parenleft',
    unicode: 0x28,
    lsb: 1.5,
    rsb: 0.75,
    draw: (g) => {
      const w = g.y(3.5);
      return [level(open(p(w, g.y(15.5)), p(0, g.y(15.5) - w), p(0, g.y(-3.5) + w), p(w, g.y(-3.5))))];
    },
  },
  {
    name: 'parenright',
    unicode: 0x29,
    lsb: 0.75,
    rsb: 1.5,
    draw: (g) => {
      const w = g.y(3.5);
      return [level(open(p(0, g.y(15.5)), p(w, g.y(15.5) - w), p(w, g.y(-3.5) + w), p(0, g.y(-3.5))))];
    },
  },
  {
    name: 'bracketleft',
    unicode: 0x5b,
    lsb: 1.5,
    rsb: 0.75,
    draw: (g) => [open(p(g.wide(4), g.top(15.5)), p(0, g.top(15.5)), p(0, g.bottom(-3.5)), p(g.wide(4), g.bottom(-3.5)))],
  },
  {
    name: 'bracketright',
    unicode: 0x5d,
    lsb: 0.75,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(4);
      return [open(p(0, g.top(15.5)), p(w, g.top(15.5)), p(w, g.bottom(-3.5)), p(0, g.bottom(-3.5)))];
    },
  },
  { name: 'slash', unicode: 0x2f, lsb: 0.25, rsb: 0.25, draw: (g) => [diagonal(g, 0, -3.5, 7, 15.5)] },
  { name: 'underscore', unicode: 0x5f, lsb: 0, rsb: 0, draw: (g) => [bar(0, 10, g.top(-2))] },
  {
    name: 'plus',
    unicode: 0x2b,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const axis = g.y(MATH_AXIS);
      return [bar(0, w, axis), stem(w / 2, axis - w / 2, axis + w / 2)];
    },
  },
  {
    name: 'equal',
    unicode: 0x3d,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      const gap = g.y(1.75) + g.h / 2;
      return [bar(0, w, g.y(MATH_AXIS) + gap), bar(0, w, g.y(MATH_AXIS) - gap)];
    },
  },
];

export const letter = (name: string): GlyphDef => [...UPPER, ...LOWER].find((d) => d.name === name)!;

/** A sign drawn on a letter: the letter's strokes and `extra`, spaced like the letter unless told otherwise. */
export function onLetter(name: string, unicode: number, base: string, extra: (g: DrawContext) => Stroke[], spacing?: { lsb: number; rsb: number }): GlyphDef {
  const def = letter(base);
  return {
    name,
    unicode,
    ...(def.lower ? { lower: true } : {}),
    lsb: spacing?.lsb ?? def.lsb,
    rsb: spacing?.rsb ?? def.rsb,
    draw: (g) => [...def.draw(g), ...extra(g)],
  };
}

const through = (x: number) => stem(x, -2, 16);

/** Currency signs and letterlike symbols that are a letter with strokes added. */
export const ON_LETTERS: GlyphDef[] = [
  onLetter('naira', 0x20a6, 'N', (g) => [bar(-1.5, g.wide(9.5) + 1.5, 5), bar(-1.5, g.wide(9.5) + 1.5, 9)], { lsb: 0.5, rsb: 0.5 }),
  onLetter('won', 0x20a9, 'W', (g) => [bar(-0.5, g.wide(15) + 0.5, 5.5), bar(-0.5, g.wide(15) + 0.5, 8.75)]),
  onLetter('kip', 0x20ad, 'K', () => [bar(-1.5, 6, 7)], { lsb: 0.5, rsb: 0.3 }),
  onLetter('tugrik', 0x20ae, 'T', (g) => {
    const x = g.wide(11) / 2;
    return [withPen(open(p(x - 2.75, g.y(3.5)), p(x + 2.75, g.y(6.5))), g.diag), withPen(open(p(x - 2.75, g.y(7)), p(x + 2.75, g.y(10))), g.diag)];
  }),
  onLetter('peso', 0x20b1, 'P', (g) => [bar(-1.75, 0, g.top(g.cap)), bar(-1.75, 0, 6)], { lsb: 0.5, rsb: 1 }),
  onLetter('guarani', 0x20b2, 'G', (g) => [through(g.wide(10) / 2)]),
  {
    name: 'hryvnia',
    unicode: 0x20b4,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(9.5);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const thin = Math.min(g.h, g.y(4.5) - g.h);
      const d = thin / 2 + 0.9;
      const hi = g.cap / 2 + d;
      const lo = g.cap / 2 - d;
      const pen = { v: g.v, h: thin };
      return [open(p(w, t), p(0, t, true), p(0, hi)), open(p(w, lo), p(w, b, true), p(0, b)), withPen(bar(-1, w + 1, hi), pen), withPen(bar(-1, w + 1, lo), pen)];
    },
  },
  onLetter('cedi', 0x20b5, 'C', (g) => [through(g.wide(10) / 2)]),
  onLetter('tenge', 0x20b8, 'T', (g) => [bar(0, g.wide(11), g.top(Math.min(g.y(10.5), g.cap - g.h - 1.6)))]),
  onLetter('ruble', 0x20bd, 'P', (g) => [bar(-1.75, 5, 6 - g.h - 1.5)], { lsb: 0.5, rsb: 1 }),
  onLetter('bitcoin', 0x20bf, 'B', (g) => {
    const x1 = 2;
    const x2 = x1 + g.v + 1.6;
    return [stem(x1, -2, 1), stem(x1, g.cap - 1, 16), stem(x2, -2, 1), stem(x2, g.cap - 1, 16)];
  }),
  onLetter('baht', 0x0e3f, 'B', (g) => [through(g.v + 1.6)]),
  onLetter('colonmonetary', 0x20a1, 'C', (g) => {
    const w = g.wide(10);
    const x = w * 0.3;
    const gap = g.v + 1.6;
    return [withPen(open(p(x, g.y(-1.5)), p(x + 2, g.y(15.5))), g.diag), withPen(open(p(x + gap, g.y(-1.5)), p(x + gap + 2, g.y(15.5))), g.diag)];
  }),
  onLetter('dong', 0x20ab, 'd', (g) => {
    const w = g.wide(8);
    return [bar(w - 3, w + g.v / 2 + 1.25, 12.5), bar(0, w + 1.5, g.top(-1.5))];
  }),
];

export const DRAWN_SIGNS: GlyphDef[] = [
  {
    name: 'Ohm',
    unicode: 0x2126,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(11);
      const leg = 3.5 - Math.max(0, g.v - 2) * 0.75;
      const y = Math.max(4, g.h * 1.5 + 1.5);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [
        open(p(leg, y), p(0, y, true), p(0, t, true), p(w, t, true), p(w, y, true), p(w - leg, y)),
        stem(leg, 0, y + g.h / 2),
        stem(w - leg, 0, y + g.h / 2),
        bar(-0.5, leg, b),
        bar(w - leg, w + 0.5, b),
      ];
    },
  },
  {
    name: 'pi',
    unicode: 0x3c0,
    lower: true,
    lsb: 0.75,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(8);
      return [bar(-1, w + 1, g.top(g.xHeight)), stem(1, 0, g.xHeight), stem(w - 1, 0, g.xHeight)];
    },
  },
  {
    name: 'litre',
    unicode: 0x2113,
    lower: true,
    lsb: 1,
    rsb: 0.75,
    draw: (g) => [open(p(0, g.ascender), p(0, g.bottom(0), true), p(g.wide(2.5), g.bottom(0))), withPen(open(p(-1.75, g.y(5.5)), p(1.75, g.y(9))), g.diag)],
  },
  {
    name: 'numero',
    unicode: 0x2116,
    lsb: 1.5,
    rsb: 1,
    draw: (g) => {
      const n = letter('N');
      const small = g.sub(g.cap * 0.6, smallPen(g.v), true);
      const x = g.wide(9.5) + g.v / 2 + small.v / 2 + 1.5;
      const ow = small.wide(8);
      const rise = g.cap - small.xHeight;
      const o = inPen(small, [box(0, ow, small.bottom(0), small.top(small.xHeight), ALL)]);
      const under = rise - small.h / 2 - 1.5;
      return [...n.draw(g), ...shift(o, x, rise), withPen(bar(x - small.v / 2, x + ow + small.v / 2, under), small.pen)];
    },
  },
  {
    name: 'estimated',
    unicode: 0x212e,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      const top = g.top(12);
      const b = g.bottom(0);
      return [open(p(0, g.y(6)), p(w, g.y(6)), p(w, top, true), p(0, top, true), p(0, b, true), p(w, b, true), p(w, g.y(3)))];
    },
  },
  {
    name: 'Dcircle',
    unicode: 0x24b9,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(13);
      const small = g.sub(g.cap * 0.45, smallPen(g.v));
      const inner = inPen(small, letter('D').draw(small));
      return [box(0, w, g.bottom(-1), g.top(g.cap + 1), ALL), ...shift(inner, w / 2 - small.wide(10) / 2, (g.cap - small.cap) / 2)];
    },
  },
  {
    name: 'sheqel',
    unicode: 0x20aa,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(12);
      const x1 = w / 3;
      const x2 = (2 * w) / 3;
      const t = g.top(g.y(11));
      const b = g.bottom(0);
      const pen = { v: Math.min(g.v, x1 - 1.7), h: g.h };
      const low = Math.max(g.y(4), g.h + 1.7);
      const high = Math.min(g.y(7), g.y(11) - g.h - 1.7);
      return [withPen(open(p(0, 0), p(0, t), p(x2, t, true), p(x2, low)), pen), withPen(open(p(x1, high), p(x1, b), p(w, b, true), p(w, g.y(11))), pen)];
    },
  },
  {
    name: 'rupeeindian',
    unicode: 0x20b9,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.cap);
      const second = g.cap - g.h * 1.5 - 1.6;
      const m = second - g.h - Math.max(1.6, 4.5 - g.h);
      return [bar(0, w, t), bar(0, w, second), open(p(0, second), p(w * 0.75, second, true), p(w * 0.75, m, true), p(0, m)), diagonal(g, 2.5, m, w * 0.8, 0, [false, true])];
    },
  },
  {
    name: 'lira',
    unicode: 0x20ba,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const x = 2.5;
      const b = g.bottom(0);
      return [open(p(x, g.cap), p(x, b), p(w, b, true), p(w, g.y(5))), withPen(open(p(0, g.y(5)), p(6, g.y(8))), g.diag), withPen(open(p(0, g.y(8)), p(6, g.y(11))), g.diag)];
    },
  },
  {
    name: 'manat',
    unicode: 0x20bc,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      const t = g.top(10);
      return [open(p(0, 0), p(0, t, true), p(w, t, true), p(w, 0)), stem(w / 2, 0, 13)];
    },
  },
  {
    name: 'lari',
    unicode: 0x20be,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(10);
      const b = g.bottom(0);
      const x = g.v + 1.6;
      return [open(p(0, g.y(9)), p(0, b, true), p(w, b, true), p(w, g.y(3.5))), stem(x, g.y(4.5), g.cap), stem(x + g.v + 1.6, g.y(4.5), g.cap)];
    },
  },
];

/** ™ is a superior T and M, drawn from the capitals at the superiors' size. */
export const TRADEMARK: GlyphDef = {
  name: 'trademark',
  unicode: 0x2122,
  lsb: 1,
  rsb: 1,
  draw: (g) => {
    const small = g.sub(g.cap * 0.5, smallPen(g.v) * 0.95);
    const rise = g.cap - small.cap;
    const t = inPen(small, UPPER.find((d) => d.name === 'T')!.draw(small));
    const m = inPen(small, UPPER.find((d) => d.name === 'M')!.draw(small));
    return [...shift(t, 0, rise), ...shift(m, small.wide(11) + small.v / 2 + 1.25, rise)];
  },
};

export const NOTDEF: GlyphDef = {
  name: '.notdef',
  lsb: 1,
  rsb: 1,
  draw: (g) => [box(0, g.wide(7), g.bottom(0), g.top(g.cap), [false, false, false, false])],
};
