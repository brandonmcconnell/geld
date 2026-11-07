import { ALL, bar, box, diagonal, type DrawContext, type GlyphDef, LEFT, MATH_AXIS, open, p, ring, smaller, stem, vee, withPen } from './draw';
import type { Stroke } from './geometry';

/** The C inside © and the R inside ®, drawn small in the circle's middle. */
function enclosed(g: DrawContext, inner: (g: DrawContext) => Stroke[]): Stroke[] {
  const w = g.wide(13);
  const t = g.top(g.cap);
  const b = g.bottom(0);
  const k = 0.5;
  const pen = { v: g.v * 0.8, h: g.h * 0.8 };
  return [box(0, w, b, t, ALL), ...smaller(inner(g), k, 0, g.pen, 0.8).map((s) => ({ ...s, points: s.points.map((q) => ({ ...q, x: q.x + w / 2 - 2.6, y: q.y + 3.5 })), pen: s.pen ?? pen }))];
}

const smallC = (g: DrawContext): Stroke[] => {
  const w = g.wide(10);
  const t = g.top(g.cap);
  const b = g.bottom(0);
  return [open(p(w, 9), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 5))];
};

const smallR = (g: DrawContext): Stroke[] => {
  const w = g.wide(9.5);
  return [stem(0, 0, g.cap), box(0, w, 6, g.top(g.cap), [false, true, true, false]), diagonal(g, w * 0.4, 6, w + g.v / 2 - g.foot(w * 0.6, 6), 0, [false, true])];
};

export const LATIN1: GlyphDef[] = [
  {
    name: 'cent',
    unicode: 0xa2,
    lsb: 1.25,
    rsb: 0.9,
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return [open(p(w, 7), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, 3)), stem(w / 2, -2, 12)];
    },
  },
  {
    name: 'sterling',
    unicode: 0xa3,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(9);
      const x = 2.5;
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [open(p(w, 11), p(w, t, true), p(x, t, true), p(x, b)), bar(0, w, b), bar(0, x + 4, g.cap / 2)];
    },
  },
  {
    name: 'currency',
    unicode: 0xa4,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const size = Math.max(g.v, g.h) + 2.5;
      const x0 = 1.5;
      const y0 = MATH_AXIS - size / 2 - g.h / 2;
      const ear = (ax: number, ay: number, dx: number, dy: number) => withPen(open(p(ax, ay), p(ax + dx, ay + dy)), g.diag);
      const x1 = x0 + size;
      const y1 = y0 + g.h + size;
      return [ring(g, x0, y0, 2.5), ear(x0, y0 + g.h / 2, -1.5, -1.5), ear(x1, y0 + g.h / 2, 1.5, -1.5), ear(x0, y1 - g.h / 2, -1.5, 1.5), ear(x1, y1 - g.h / 2, 1.5, 1.5)];
    },
  },
  {
    name: 'yen',
    unicode: 0xa5,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(11);
      return [...vee(g, 0, w, g.cap, 6), stem(w / 2, 0, 6), bar(w / 2 - 3.5, w / 2 + 3.5, 4.75), bar(w / 2 - 3.5, w / 2 + 3.5, 1.75 + g.h / 2)];
    },
  },
  { name: 'copyright', unicode: 0xa9, lsb: 1, rsb: 1, draw: (g) => enclosed(g, smallC) },
  { name: 'registered', unicode: 0xae, lsb: 1, rsb: 1, draw: (g) => enclosed(g, smallR) },
  {
    name: 'ordfeminine',
    unicode: 0xaa,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7.5);
      const strokes = [stem(w, 0, g.xHeight), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT)];
      return [...smaller(strokes, 0.6, 8, g.pen, 0.8), withPen(bar(0, w * 0.6 + 0.5, 6.8 - g.h * 0.4), { v: g.v * 0.8, h: g.h * 0.8 })];
    },
  },
  {
    name: 'ordmasculine',
    unicode: 0xba,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(8);
      return [...smaller([box(0, w, g.bottom(0), g.top(g.xHeight), ALL)], 0.6, 8, g.pen, 0.8), withPen(bar(0, w * 0.6, 6.8 - g.h * 0.4), { v: g.v * 0.8, h: g.h * 0.8 })];
    },
  },
  {
    name: 'mu',
    unicode: 0xb5,
    lower: true,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(7);
      return [stem(0, g.descender, g.xHeight), open(p(0, g.bottom(0)), p(w, g.bottom(0))), stem(w, 0, g.xHeight)];
    },
  },
  {
    name: 'paragraph',
    unicode: 0xb6,
    lsb: 1,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(8);
      const bowl = 5;
      return [stem(w * 0.55, -2, g.cap), stem(w, -2, g.cap), bar(w * 0.55, w, g.top(g.cap)), withPen(open(p(bowl / 2 - 0.5, 7), p(bowl / 2 - 0.5, g.cap)), { v: bowl, h: g.h })];
    },
  },
  {
    name: 'Tbar',
    unicode: 0x166,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(11);
      return [bar(0, w, g.top(g.cap)), stem(w / 2, 0, g.cap), bar(w / 2 - 2.75, w / 2 + 2.75, g.cap / 2)];
    },
  },
  {
    name: 'tbar',
    unicode: 0x167,
    lower: true,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const b = g.bottom(0);
      return [open(p(0, 13), p(0, b, true), p(g.wide(3.5), b)), bar(-1.5, g.wide(3.5), g.top(g.xHeight)), bar(-1.5, g.wide(3.5), 4.75)];
    },
  },
];
