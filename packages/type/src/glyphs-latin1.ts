import { smallPen } from './glyphs-figures';
import { kept, ALL, bar, box, crossbarReach, diagonal, type DrawContext, type GlyphDef, LEFT, MATH_AXIS, open, p, inPen, shift, stem, withPen, yArms , edgeAt  } from './draw';
import type { Stroke } from './geometry';

/** The C inside © and the R inside ®, drawn natively at their size and centred in the frame. */
function enclosed(g: DrawContext, inner: (g: DrawContext) => Stroke[], width: number): Stroke[] {
  const w = g.wide(13);
  const small = g.sub(g.cap * 0.45, smallPen(g.v));
  // The ring is a circle's stand-in, an octagon in both corner styles.
  return [box(0, w, g.bottom(-1), g.top(g.cap + 1), kept(ALL)), ...shift(inPen(small, inner(small)), w / 2 - small.wide(width) / 2, (g.cap - small.cap) / 2)];
}

const smallC = (g: DrawContext): Stroke[] => {
  const w = g.wide(10);
  const t = g.top(g.cap);
  const b = g.bottom(0);
  return [open(p(w, g.y(9)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, g.y(5)))];
};

const smallP = (g: DrawContext): Stroke[] => {
  const w = g.wide(9.5);
  return [stem(0, 0, g.cap), box(0, w, g.y(6), g.top(g.cap), [false, true, true, false])];
};

const smallR = (g: DrawContext): Stroke[] => {
  const w = g.wide(9.5);
  const bowl = g.y(6);
  return [stem(0, 0, g.cap), box(0, w, bowl, g.top(g.cap), [false, true, true, false]), diagonal(g, w * 0.4, bowl, w + g.v / 2 - g.foot(w * 0.6, bowl), 0, [false, true])];
};

/** ª º: a lowercase letter drawn at superior size, standing at the cap height, over a rule. */
function ordinal(g: DrawContext, letter: (s: DrawContext) => [Stroke[], number]): Stroke[] {
  const small = g.sub(g.cap * 0.7, smallPen(g.v) * 0.85, true);
  const [strokes, w] = letter(small);
  const rise = g.cap - small.xHeight;
  const under = rise - small.h / 2 - 1.5;
  return [...shift(inPen(small, strokes), 0, rise), withPen(bar(-small.v / 2, w + small.v / 2, under), small.pen)];
}

export const LATIN1: GlyphDef[] = [
  {
    name: 'cent',
    unicode: 0xa2,
    lsb: 1.25,
    rsb: 0.9,
    draw: (g) => {
      const w = g.wide(8);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      const thin = Math.min(g.v, w - g.v - 3.8);
      return [open(p(w, g.y(7)), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, g.y(3))), withPen(stem(w / 2, g.y(-2), g.y(12)), { v: thin, h: g.h })];
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
      return [open(p(w, g.y(11)), p(w, t, true), p(x, t, true), p(x, b)), bar(x - crossbarReach(g), w, b), bar(x - crossbarReach(g), x + 4, g.cap / 2)];
    },
  },
  {
    name: 'currency',
    unicode: 0xa4,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const size = Math.max(g.v, g.h) + 2.5;
      const x0 = 1.75;
      const x1 = x0 + size;
      const y0 = MATH_AXIS - size / 2;
      const y1 = MATH_AXIS + size / 2;
      const ear = (ax: number, ay: number, dx: number, dy: number) => withPen(open(p(ax, ay), p(ax + dx, ay + dy)), g.diag);
      return [box(x0, x1, y0, y1, [false, false, false, false]), ear(x0, y0, -1.75, -1.75), ear(x1, y0, 1.75, -1.75), ear(x0, y1, -1.75, 1.75), ear(x1, y1, 1.75, 1.75)];
    },
  },
  {
    name: 'yen',
    unicode: 0xa5,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(11);
      const reach = 3.5;
      // The upper bar stays 1.4 below where the arms' outer edges meet the stem, the lower one 1.6 below it or on the
      // baseline rather than over a stub of stem, and where both do not fit under arms meeting at 6 the arms meet higher.
      const clearance = (join: number) => {
        let lo = 0;
        let hi = g.cap;
        for (let i = 0; i < 30; i++) {
          const y = (lo + hi) / 2;
          if (edgeAt(g.diag, 0, g.cap, w / 2, join, y, -1) < w / 2 - g.v / 2) hi = y;
          else lo = y;
        }
        return lo - 1.4;
      };
      const lowest = 1.5 * g.h + 1.6;
      let join = 6;
      while (clearance(join) - g.h / 2 < lowest && join < g.cap - 3) join += 0.1;
      const upper = Math.max(lowest, Math.min(4.75, clearance(join) - g.h / 2));
      const lower = upper - g.h - 1.6 - g.h < 1.25 ? g.h / 2 : Math.min(1.75 + g.h / 2, upper - g.h - 1.6);
      return [...yArms(g, w, g.cap, join), bar(w / 2 - reach, w / 2 + reach, upper), bar(w / 2 - reach, w / 2 + reach, lower)];
    },
  },
  { name: 'copyright', unicode: 0xa9, lsb: 1, rsb: 1, draw: (g) => enclosed(g, smallC, 10) },
  { name: 'registered', unicode: 0xae, lsb: 1, rsb: 1, draw: (g) => enclosed(g, smallR, 9.5) },
  { name: 'published', unicode: 0x2117, lsb: 1, rsb: 1, draw: (g) => enclosed(g, smallP, 9.5) },
  {
    name: 'ordfeminine',
    unicode: 0xaa,
    lsb: 1,
    rsb: 1,
    draw: (g) => ordinal(g, (s) => {
      const w = s.wide(7.5);
      const t = s.top(s.xHeight);
      return [[open(p(0, t), p(w, t, true), p(w, 0)), box(0, w, s.bottom(0), s.y(5.25), LEFT)], w];
    }),
  },
  {
    name: 'ordmasculine',
    unicode: 0xba,
    lsb: 1,
    rsb: 1,
    draw: (g) => ordinal(g, (s) => [[box(0, s.wide(8), s.bottom(0), s.top(s.xHeight), ALL)], s.wide(8)]),
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
      return [bar(0, w, g.top(g.cap)), stem(w / 2, 0, g.cap), bar(w / 2 - crossbarReach(g) - 0.75, w / 2 + crossbarReach(g) + 0.75, g.cap / 2)];
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
      return [open(p(0, 13), p(0, b, true), p(g.wide(3.5), b)), bar(-crossbarReach(g), g.wide(3.5), g.top(g.xHeight)), bar(-crossbarReach(g), crossbarReach(g), (g.xHeight + 0.55) / 2)];
    },
  },
];
