import type { AccentedDef, PlacedDef } from './composites';
import {
  ALL,
  bar,
  box,
  diagonal,
  type DrawContext,
  level,
  type GlyphDef,
  mirror,
  open,
  p,
  RIGHT,
  rotate180,
  spanOf,
  stem,
  vee,
  yArms,
  crossbarReach,
  crossing,
  kaWithTail,
  tailAfter,
  tailAfterLeg,
  tailReach,
  withPen,
  INSIDE,
} from './draw';
import type { Stroke } from './geometry';
import { METRICS } from './grid';
import { letter } from './glyphs-core';

/**
 * Cyrillic. Capitals are drawn with every height a share of the cap height, so most lowercase
 * letters are the same skeletons as small capitals (в к м н т и л д ж ш…), as Cyrillic is written.
 */

type Draw = (g: DrawContext) => Stroke[];

/** A short tail below the baseline at x: Ц Щ Җ Қ Ң Ҳ Ҷ and their lowercase. */
const descender = (g: DrawContext, x: number): Stroke => stem(x, -2.75, g.h);

const pe: Draw = (g) => {
  const w = g.wide(9.5);
  return [open(p(0, 0), p(0, g.top(g.cap)), p(w, g.top(g.cap)), p(w, 0))];
};
const ge: Draw = (g) => [open(p(g.wide(9), g.top(g.cap)), p(0, g.top(g.cap)), p(0, 0))];
const softSign = (g: DrawContext, bowl = g.y(8)): Stroke[] => [stem(0, 0, g.cap), box(0, g.wide(9), g.bottom(0), bowl, RIGHT)];
const che = (g: DrawContext, w = g.wide(9)): Stroke[] => {
  const m = g.y(7);
  return [open(p(0, g.cap), p(0, m, true), p(w, m)), stem(w, 0, g.cap)];
};
const ii: Draw = (g) => {
  const w = g.wide(9.5);
  const e = g.foot(w, g.cap);
  return [stem(0, 0, g.cap), stem(w, 0, g.cap), diagonal(g, e - g.v / 2, 0, w + g.v / 2 - e, g.cap)];
};
const el: Draw = (g) => {
  const w = g.wide(9.5);
  const x = g.wide(2.5);
  const t = g.top(g.cap);
  const b = g.bottom(0);
  return [open(p(-0.75, b), p(x, b, true), p(x, t), p(w, t), p(w, 0))];
};
const de: Draw = (g) => {
  const w = g.wide(9.5);
  const x = g.wide(2);
  const t = g.top(g.cap);
  const b = g.bottom(0);
  const tail = tailReach(g);
  return [level(open(p(0, b), p(x, Math.max(g.y(4), g.h + g.y(2.5))), p(x, t), p(w, t), p(w, b)), true, false), open(p(-tail, -2.75), p(-tail, b), p(w + tail, b), p(w + tail, -2.75))];
};
const zhe: Draw = (g) => {
  const w = g.wide(15);
  const c = w / 2;
  const y0 = g.cap / 2;
  const arm = (dir: 1 | -1) => {
    const reach = c + dir * (c + g.v / 2 - g.foot(c, g.cap - y0));
    return [diagonal(g, c, y0, reach, g.cap, [false, true]), diagonal(g, c, y0, reach, 0, [false, true])];
  };
  return [stem(c, 0, g.cap), ...arm(1), ...arm(-1)];
};
const sha: Draw = (g) => {
  const w = g.wide(14);
  return [stem(0, 0, g.cap), stem(w / 2, 0, g.cap), stem(w, 0, g.cap), bar(0, w, g.bottom(0))];
};
const tse: Draw = (g) => {
  const w = g.wide(9.5);
  return [stem(0, 0, g.cap), stem(w, 0, g.cap), ...tailAfter(g, w, 0)];
};
const ef: Draw = (g) => {
  const w = g.wide(12);
  return [box(0, w, g.y(2.5), g.y(11.5), ALL), stem(w / 2, -0.5, g.cap + 0.5)];
};
const e: Draw = (g) => {
  const w = g.wide(10);
  const strokes = [open(p(w, g.y(9)), p(w, g.top(g.cap), true), p(0, g.top(g.cap), true), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.y(5)))];
  return [...mirror(strokes, w / 2), bar(w * 0.3, w, g.cap / 2)];
};
/** З: the two bowls of 3, terminals kept an aperture clear of the middle bar. */
const ze: Draw = (g) => {
  const w = g.wide(9);
  const t = g.top(g.cap);
  const b = g.bottom(0);
  const m = g.cap / 2;
  const reach = g.h / 2 + g.aperture;
  return [
    open(p(0, Math.max(g.y(10), m + reach)), p(0, t, true), p(w, t, true), p(w, m), p(w * 0.35, m)),
    open(p(w, m), p(w, b, true), p(0, b, true), p(0, Math.min(g.y(4), m - reach))),
  ];
};

const ie: Draw = (g) => {
  const w = g.wide(10);
  return [open(p(w, g.y(9)), p(w, g.top(g.cap), true), p(0, g.top(g.cap), true), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.y(5))), bar(0, w * 0.7, g.cap / 2)];
};
const yu: Draw = (g) => {
  const x = g.v + 2;
  const w = g.wide(9);
  return [stem(0, 0, g.cap), bar(0, x, g.cap / 2), box(x, x + w, g.bottom(0), g.top(g.cap), ALL)];
};
const ya: Draw = (g) => {
  const r = letter('R');
  const w = g.wide(9.5);
  return mirror(r.draw(g), w / 2);
};
const be: Draw = (g) => {
  const w = g.wide(10);
  const t = g.top(g.cap);
  const m = g.y(8);
  return [open(p(w - 1, t), p(0, t)), stem(0, 0, g.cap), box(0, w, g.bottom(0), m, RIGHT)];
};
const shha: Draw = (g) => {
  const w = g.wide(9);
  const m = g.y(8);
  return [stem(0, 0, g.cap), open(p(0, m), p(w, m, true), p(w, 0))];
};
const tshe: Draw = (g) => {
  const w = g.wide(10);
  const x = g.wide(3);
  const m = g.y(8);
  return [bar(0, g.wide(7), g.top(g.cap)), stem(x, 0, g.cap), open(p(x, m), p(w, m, true), p(w, 0))];
};
const dje: Draw = (g) => {
  const w = g.wide(10);
  const x = g.wide(3);
  const m = g.y(8);
  const b = g.bottom(-3);
  return [bar(0, g.wide(7), g.top(g.cap)), stem(x, 0, g.cap), open(p(x, m), p(w, m, true), p(w, b, true), p(w - 2.5, b))];
};
const dzhe: Draw = (g) => {
  const w = g.wide(9.5);
  return [open(p(0, g.cap), p(0, g.bottom(0)), p(w, g.bottom(0)), p(w, g.cap)), stem(w / 2, -2.75, g.h)];
};
const lje: Draw = (g) => {
  const lw = g.wide(8);
  return [...el(g).map((s) => ({ ...s, points: s.points.map((q) => ({ ...q, x: q.x * (lw / g.wide(9.5)) })) })), box(lw, lw + g.wide(6), g.bottom(0), g.y(8), RIGHT)];
};
const nje: Draw = (g) => {
  const w = g.wide(7.5);
  return [stem(0, 0, g.cap), stem(w, 0, g.cap), bar(0, w, g.y(8) - g.h / 2), box(w, w + g.wide(6), g.bottom(0), g.y(8), RIGHT)];
};
const u: Draw = (g) => {
  const w = g.wide(10.5);
  const y = g.y(4.5);
  // The short arm ends square on the long one's centreline, its corners inside it.
  const meet = crossing([0, g.cap], [w * 0.5, y], [w, g.cap], [w * 0.15, 0]);
  return [diagonal(g, 0, g.cap, meet[0], meet[1], [true, false]), diagonal(g, w, g.cap, w * 0.15, 0)];
};
const gheUp: Draw = (g) => [open(p(g.wide(9), g.cap + 2.5), p(g.wide(9), g.top(g.cap)), p(0, g.top(g.cap)), p(0, 0))];
const gheBar: Draw = (g) => [...ge(g), bar(-crossbarReach(g), g.wide(4.5), g.cap / 2)];
const ue: Draw = (g) => {
  const w = g.wide(11);
  return yArms(g, w, g.cap, g.y(6));
};
/** Ҕ: Г with a hook from the middle that turns under the baseline, as ђ's does. */
const gheHook: Draw = (g) => {
  const m = g.y(7);
  const w = g.wide(8.5);
  const b = g.bottom(-3);
  return [...ge(g), open(p(0, m), p(w, m, true), p(w, b, true), p(w - 2.5, b))];
};
/** Ҝ: K with a short upright stroke through its upper arm. */
const kaStroke: Draw = (g) => {
  const x = g.v + 1.6;
  const w = g.wide(9.5);
  const y0 = g.y(4.5);
  const reach = w + g.v / 2 - g.foot(w, g.cap - y0);
  // Through K's arm, clearing its edges by 1.25 where they come nearest the stroke's ends.
  const along = (at: number) => y0 + ((g.cap - y0) * at) / reach;
  const half = (Math.hypot(g.diag.v * reach, g.diag.h * (g.cap - y0)) / Math.hypot(reach, g.cap - y0) / 2) * (Math.hypot(reach, g.cap - y0) / reach);
  // The leg leaves the arm further out than K's, so the stroke crosses the arm alone.
  const t = 0.6;
  return [
    stem(0, 0, g.cap),
    withPen(level(open(p(0, y0), p(reach, g.cap)), false, true), g.diag),
    diagonal(g, reach * t, along(reach * t), reach, 0, [false, true]),
    // With no room to clear the arm below the cap (heavy weights) the stroke ends inside it, showing only below.
    stem(x, along(x - g.v / 2) - half - 1.25, along(x + g.v / 2) + half + 1.25 <= g.cap ? along(x + g.v / 2) + half + 1.25 : along(x - g.v / 2) + half - INSIDE),
  ];
};
/** Ҹ: a wider Ч with a short upright stroke through the middle of its bar. */
const cheStroke: Draw = (g) => {
  const w = g.wide(11);
  const m = g.y(7);
  return [...che(g, w), stem(w / 2, m - g.h / 2 - 1.5, m + g.h / 2 + 1.5)];
};
const oBarred: Draw = (g) => {
  const w = g.wide(10);
  return [box(0, w, g.bottom(0), g.top(g.cap), ALL), bar(0, w, g.cap / 2)];
};
const hardSign: Draw = (g) => [bar(-g.wide(2.5), 0, g.top(g.cap)), ...softSign(g)];
const yeru: Draw = (g) => {
  const w = g.wide(8);
  return [stem(0, 0, g.cap), box(0, w, g.bottom(0), g.y(8), RIGHT), stem(w + g.v + 1.8, 0, g.cap)];
};
const shcha: Draw = (g) => {
  const w = g.wide(14);
  return [...sha(g).slice(0, 3), ...tailAfter(g, w, 0)];
};

/** Capitals with their own drawing; `lower` is the lowercase code point that is the same skeleton as a small capital. */
const DRAWN: { name: string; unicode: number; lower?: number; lsb: number; rsb: number; draw: Draw }[] = [
  { name: 'Be-cy', unicode: 0x411, lsb: 1.5, rsb: 1.25, draw: be },
  { name: 'Ge-cy', unicode: 0x413, lower: 0x433, lsb: 1.5, rsb: 0.5, draw: ge },
  { name: 'De-cy', unicode: 0x414, lower: 0x434, lsb: 0.75, rsb: 0.75, draw: de },
  { name: 'Zhe-cy', unicode: 0x416, lower: 0x436, lsb: 0.3, rsb: 0.3, draw: zhe },
  { name: 'Ze-cy', unicode: 0x417, lower: 0x437, lsb: 1, rsb: 1, draw: ze },
  { name: 'Ii-cy', unicode: 0x418, lower: 0x438, lsb: 1.5, rsb: 1.5, draw: ii },
  { name: 'El-cy', unicode: 0x41b, lower: 0x43b, lsb: 0.75, rsb: 1.5, draw: el },
  { name: 'Pe-cy', unicode: 0x41f, lower: 0x43f, lsb: 1.5, rsb: 1.5, draw: pe },
  { name: 'U-cy', unicode: 0x423, lsb: 0.3, rsb: 0.3, draw: u },
  { name: 'Ef-cy', unicode: 0x424, lower: 0x444, lsb: 1, rsb: 1, draw: ef },
  { name: 'Tse-cy', unicode: 0x426, lower: 0x446, lsb: 1.5, rsb: 0.5, draw: tse },
  { name: 'Che-cy', unicode: 0x427, lower: 0x447, lsb: 1.5, rsb: 1.5, draw: (g) => che(g) },
  { name: 'Sha-cy', unicode: 0x428, lower: 0x448, lsb: 1.5, rsb: 1.5, draw: sha },
  { name: 'Shcha-cy', unicode: 0x429, lower: 0x449, lsb: 1.5, rsb: 0.5, draw: shcha },
  { name: 'Hard-cy', unicode: 0x42a, lower: 0x44a, lsb: 0.5, rsb: 1.25, draw: hardSign },
  { name: 'Yeru-cy', unicode: 0x42b, lower: 0x44b, lsb: 1.5, rsb: 1.5, draw: yeru },
  { name: 'Soft-cy', unicode: 0x42c, lower: 0x44c, lsb: 1.5, rsb: 1.25, draw: (g) => softSign(g) },
  { name: 'Ereversed-cy', unicode: 0x42d, lower: 0x44d, lsb: 1, rsb: 1.25, draw: e },
  { name: 'Iu-cy', unicode: 0x42e, lower: 0x44e, lsb: 1.5, rsb: 1.25, draw: yu },
  { name: 'Ia-cy', unicode: 0x42f, lower: 0x44f, lsb: 0.4, rsb: 1.5, draw: ya },
  { name: 'Dje-cy', unicode: 0x402, lsb: 0.5, rsb: 1.25, draw: dje },
  { name: 'Ie-cy-ukr', unicode: 0x404, lower: 0x454, lsb: 1.25, rsb: 1, draw: ie },
  { name: 'Lje-cy', unicode: 0x409, lower: 0x459, lsb: 0.75, rsb: 1.25, draw: lje },
  { name: 'Nje-cy', unicode: 0x40a, lower: 0x45a, lsb: 1.5, rsb: 1.25, draw: nje },
  { name: 'Tshe-cy', unicode: 0x40b, lsb: 0.5, rsb: 1.5, draw: tshe },
  { name: 'Dzhe-cy', unicode: 0x40f, lower: 0x45f, lsb: 1.5, rsb: 1.5, draw: dzhe },
  { name: 'Gheup-cy', unicode: 0x490, lower: 0x491, lsb: 1.5, rsb: 0.5, draw: gheUp },
  { name: 'Ghestroke-cy', unicode: 0x492, lower: 0x493, lsb: 0.5, rsb: 0.5, draw: gheBar },
  { name: 'Zhedescender-cy', unicode: 0x496, lower: 0x497, lsb: 0.3, rsb: 0.3, draw: (g) => {
      const w = g.wide(15);
      const reach = w + g.v / 2 - g.foot(w / 2, g.cap / 2);
      return [...zhe(g), ...tailAfterLeg(g, reach, spanOf(g.diag, reach - w / 2, g.cap / 2))];
    },
  },
  {
    name: 'Kadescender-cy',
    unicode: 0x49a,
    lower: 0x49b,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => kaWithTail(g, letter('K').draw(g)),
  },
  { name: 'Endescender-cy', unicode: 0x4a2, lower: 0x4a3, lsb: 1.5, rsb: 0.5, draw: (g) => [...letter('H').draw(g), ...tailAfter(g, g.wide(9), g.wide(9))] },
  { name: 'Ustraight-cy', unicode: 0x4ae, lsb: 0.3, rsb: 0.3, draw: ue },
  { name: 'Ustraightstroke-cy', unicode: 0x4b0, lsb: 0.3, rsb: 0.3, draw: (g) => [...ue(g), bar(g.wide(11) / 2 - 3, g.wide(11) / 2 + 3, Math.max(g.h / 2 + 1.4, Math.min(g.y(4), g.y(6) - g.h - 1.2)))] },
  { name: 'Hadescender-cy', unicode: 0x4b2, lower: 0x4b3, lsb: 0.4, rsb: 0.4, draw: (g) => [...letter('X').draw(g), ...tailAfterLeg(g, g.wide(10), spanOf(g.diag, g.wide(10), g.cap))] },
  { name: 'Chedescender-cy', unicode: 0x4b6, lower: 0x4b7, lsb: 1.5, rsb: 0.5, draw: (g) => [...che(g), ...tailAfter(g, g.wide(9), g.wide(9))] },
  { name: 'Shha-cy', unicode: 0x4ba, lsb: 1.5, rsb: 1.5, draw: shha },
  { name: 'Gemiddlehook-cy', unicode: 0x494, lower: 0x495, lsb: 1.5, rsb: 1, draw: gheHook },
  { name: 'Zedescender-cy', unicode: 0x498, lower: 0x499, lsb: 1, rsb: 1, draw: (g) => [...ze(g), descender(g, g.wide(9) / 2)] },
  { name: 'Kaverticalstroke-cy', unicode: 0x49c, lower: 0x49d, lsb: 1.5, rsb: 0.3, draw: kaStroke },
  { name: 'Kabashkir-cy', unicode: 0x4a0, lower: 0x4a1, lsb: 0.5, rsb: 0.3, draw: (g) => [bar(-g.wide(2.5), 0, g.top(g.cap)), ...letter('K').draw(g)] },
  { name: 'Enghe-cy', unicode: 0x4a4, lower: 0x4a5, lsb: 1.5, rsb: 0.5, draw: (g) => [...letter('H').draw(g), bar(g.wide(9), g.wide(9) + g.wide(4), g.top(g.cap))] },
  { name: 'Esdescender-cy', unicode: 0x4aa, lower: 0x4ab, lsb: 1.25, rsb: 1, draw: (g) => [...letter('C').draw(g), descender(g, g.wide(10) / 2)] },
  { name: 'Cheverticalstroke-cy', unicode: 0x4b8, lower: 0x4b9, lsb: 1.5, rsb: 1.5, draw: cheStroke },
  { name: 'Obarred-cy', unicode: 0x4e8, lower: 0x4e9, lsb: 1.25, rsb: 1.25, draw: oBarred },
];

/** Lowercase that is the small capital of a Latin capital: в к м н т. */
const SMALL_OF_LATIN: [string, number, string][] = [
  ['ve-cy', 0x432, 'B'],
  ['ka-cy', 0x43a, 'K'],
  ['em-cy', 0x43c, 'M'],
  ['en-cy', 0x43d, 'H'],
  ['te-cy', 0x442, 'T'],
];

/** Lowercase with forms of their own: б ђ ћ ү ұ. */
const LOWER_OWN: GlyphDef[] = [
  {
    name: 'be-cy',
    unicode: 0x431,
    lower: true,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(8);
      const t = g.top(14);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), [true, true, true, false]), open(p(0, 5), p(0, t, true), p(w, t))];
    },
  },
  {
    name: 'dje-cy',
    unicode: 0x452,
    lower: true,
    lsb: 0.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      const d = g.bottom(g.descender);
      return [stem(0, 0, g.ascender), bar(-crossbarReach(g), Math.max(3, crossbarReach(g)), 12.5), open(p(0, t), p(w, t, true), p(w, d, true), p(w - 2.5, d))];
    },
  },
  {
    name: 'tshe-cy',
    unicode: 0x45b,
    lower: true,
    lsb: 0.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      return [stem(0, 0, g.ascender), bar(-crossbarReach(g), Math.max(3, crossbarReach(g)), 12.5), open(p(0, t), p(w, t, true), p(w, 0))];
    },
  },
  {
    name: 'ustraight-cy',
    unicode: 0x4af,
    lower: true,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(8.5);
      return yArms(g, w, g.xHeight, 0, g.descender);
    },
  },
  {
    name: 'ustraightstroke-cy',
    unicode: 0x4b1,
    lower: true,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(8.5);
      const h = Math.min(g.h, 1.8);
      return [...yArms(g, w, g.xHeight, 0, g.descender), withPen(bar(w / 2 - crossbarReach(g), w / 2 + crossbarReach(g), Math.min(-1.5, g.descender + 1.25 + h / 2)), { ...g.pen, h })];
    },
  },
];

const lowerName = (name: string) => name.replace(/^./, (c) => c.toLowerCase());

/** The italic's cursive lowercase, where Cyrillic italic is not the roman slanted: и п т ц read as u n m and u with a tail. */
const ITALIC_LOWER: Record<string, Draw> = {
  'ii-cy': (g) => letter('u').draw(g),
  'pe-cy': (g) => letter('n').draw(g),
  'te-cy': (g) => letter('m').draw(g),
  'tse-cy': (g) => {
    const w = g.wide(7);
    return [...letter('u').draw(g), ...tailAfter(g, w, w)];
  },
};

export const CYRILLIC: GlyphDef[] = [
  ...DRAWN.map(({ lower: _lower, ...def }) => def),
  ...DRAWN.filter((d) => d.lower !== undefined).map((d) => ({
    name: lowerName(d.name),
    unicode: d.lower!,
    smallcap: true,
    lsb: d.lsb,
    rsb: d.rsb,
    draw: d.draw,
    italic: ITALIC_LOWER[lowerName(d.name)],
  })),
  ...SMALL_OF_LATIN.map(([name, unicode, latin]) => {
    const def = letter(latin);
    return { name, unicode, smallcap: true, lsb: def.lsb, rsb: def.rsb, draw: def.draw, italic: ITALIC_LOWER[name] };
  }),
  ...LOWER_OWN,
];

/** Cyrillic letters that are the Latin glyph, shared as a component. */
export const CYRILLIC_ALIASES: PlacedDef[] = (
  [
    ['A-cy', 0x410, 'A'],
    ['Ve-cy', 0x412, 'B'],
    ['Ie-cy', 0x415, 'E'],
    ['Ka-cy', 0x41a, 'K'],
    ['Em-cy', 0x41c, 'M'],
    ['En-cy', 0x41d, 'H'],
    ['O-cy', 0x41e, 'O'],
    ['Er-cy', 0x420, 'P'],
    ['Es-cy', 0x421, 'C'],
    ['Te-cy', 0x422, 'T'],
    ['Ha-cy', 0x425, 'X'],
    ['Dze-cy', 0x405, 'S'],
    ['I-cy', 0x406, 'I'],
    ['Je-cy', 0x408, 'J'],
    ['Schwa-cy', 0x4d8, 'Schwa'],
    ['a-cy', 0x430, 'a'],
    ['ie-cy', 0x435, 'e'],
    ['o-cy', 0x43e, 'o'],
    ['er-cy', 0x440, 'p'],
    ['es-cy', 0x441, 'c'],
    ['u-cy', 0x443, 'y'],
    ['ha-cy', 0x445, 'x'],
    ['dze-cy', 0x455, 's'],
    ['i-cy', 0x456, 'i'],
    ['je-cy', 0x458, 'j'],
    ['shha-cy', 0x4bb, 'h'],
    ['schwa-cy', 0x4d9, 'schwa'],
    ['Palochka-cy', 0x4c0, 'I'],
    ['palochka-cy', 0x4cf, 'I'],
    ['Aie-cy', 0x4d4, 'AE'],
    ['aie-cy', 0x4d5, 'ae'],
  ] as const
).map(([name, unicode, glyph]) => ({ name, unicode, parts: [{ glyph, after: true }] }));

export type LoclLanguage = 'BGR' | 'SRB' | 'MKD';

/** A bar over the x-height where a macron sits, wider than the letter's counter: Serbian italic г п т. */
const overline = (g: DrawContext, x0: number, x1: number): Stroke => bar(x0, x1, g.xHeight + 2.25);
/** ш at the x-height, for the Serbian italic т it carries. */
const shaLower = (g: DrawContext, w = g.wide(11.5)): Stroke[] => [stem(0, 0, g.xHeight), stem(w / 2, 0, g.xHeight), stem(w, 0, g.xHeight), bar(0, w, g.bottom(0))];
/** ш in Bulgarian: an m turned over. */
const shaTurned = (g: DrawContext): Stroke[] => rotate180(letter('m').draw(g), g.wide(6.5), g.xHeight / 2);
const italicOf = (name: string): Draw => {
  const def = letter(name);
  return (g) => (def.italic ?? def.draw)(g);
};

interface LoclForm {
  /** The default glyph it replaces. */
  from: string;
  stands: number;
  languages: LoclLanguage[];
  lsb: number;
  rsb: number;
  /** `lower`: drawn as a lowercase letter; `smallcap`: as a small capital, with any italic drawn as a lowercase letter. */
  as?: 'lower' | 'smallcap';
  draw: Draw;
  italic?: Draw;
}

/**
 * Language forms under `locl`. Bulgarian lowercase draws from handwriting (г a mirrored s, д like g, л a pointed arch,
 * ж and в rising above the x-height, и п т ш like u n m and a turned m, ь ъ ю with a tall stem), and
 * its Л is the arch. Serbian and Macedonian italic г д п т are ı and u with an overline, g, and ш with
 * an overline (Macedonian keeps the Cyrillic г); their roman is the default form.
 */
const LOCL_FORMS: LoclForm[] = [
  { from: 'El-cy', stands: 0x41b, languages: ['BGR'], lsb: 0.4, rsb: 0.4, draw: (g) => vee(g, 0, g.wide(10), 0, g.cap) },
  {
    from: 've-cy',
    stands: 0x432,
    languages: ['BGR'],
    lsb: 1.5,
    rsb: 1.25,
    as: 'lower',
    draw: (g) => {
      const join = g.top(g.xHeight);
      return [stem(0, 0, g.ascender), box(0, g.wide(5), join, g.top(g.ascender), RIGHT), box(0, g.wide(8), g.bottom(0), join, RIGHT)];
    },
  },
  { from: 'ge-cy', stands: 0x433, languages: ['BGR'], lsb: 1, rsb: 1, as: 'lower', draw: (g) => mirror(letter('s').draw(g), g.wide(7) / 2) },
  { from: 'de-cy', stands: 0x434, languages: ['BGR'], lsb: 1.25, rsb: 1.5, as: 'lower', draw: (g) => letter('g').draw(g), italic: italicOf('g') },
  {
    from: 'zhe-cy',
    stands: 0x436,
    languages: ['BGR'],
    lsb: 0.3,
    rsb: 0.3,
    as: 'smallcap',
    draw: (g) => [...zhe(g), stem(g.wide(15) / 2, 0, METRICS.ascender)],
  },
  { from: 'ii-cy', stands: 0x438, languages: ['BGR'], lsb: 1.4, rsb: 1.5, as: 'lower', draw: (g) => letter('u').draw(g) },
  { from: 'ka-cy', stands: 0x43a, languages: ['BGR'], lsb: 1.5, rsb: 0.3, as: 'lower', draw: (g) => letter('k').draw(g), italic: italicOf('k') },
  { from: 'el-cy', stands: 0x43b, languages: ['BGR'], lsb: 0.3, rsb: 0.3, as: 'lower', draw: (g) => vee(g, 0, g.wide(8.5), 0, g.xHeight) },
  { from: 'pe-cy', stands: 0x43f, languages: ['BGR'], lsb: 1.5, rsb: 1.4, as: 'lower', draw: (g) => letter('n').draw(g) },
  { from: 'te-cy', stands: 0x442, languages: ['BGR'], lsb: 1.5, rsb: 1.4, as: 'lower', draw: (g) => letter('m').draw(g) },
  { from: 'tse-cy', stands: 0x446, languages: ['BGR'], lsb: 1.4, rsb: 0.5, as: 'lower', draw: (g) => ITALIC_LOWER['tse-cy']!(g) },
  { from: 'sha-cy', stands: 0x448, languages: ['BGR'], lsb: 1.4, rsb: 1.5, as: 'lower', draw: shaTurned },
  {
    from: 'shcha-cy',
    stands: 0x449,
    languages: ['BGR'],
    lsb: 1.4,
    rsb: 0.5,
    as: 'lower',
    draw: (g) => {
      const w = 2 * g.wide(6.5);
      return [...shaTurned(g), ...tailAfter(g, w, w)];
    },
  },
  { from: 'soft-cy', stands: 0x44c, languages: ['BGR'], lsb: 1.5, rsb: 1.25, as: 'lower', draw: (g) => letter('b').draw(g) },
  { from: 'hard-cy', stands: 0x44a, languages: ['BGR'], lsb: 0.5, rsb: 1.25, as: 'lower', draw: (g) => [bar(-g.wide(2.5), 0, g.top(g.ascender)), ...letter('b').draw(g)] },
  {
    from: 'iu-cy',
    stands: 0x44e,
    languages: ['BGR'],
    lsb: 1.5,
    rsb: 1.25,
    as: 'lower',
    draw: (g) => {
      const x = g.v + 1.6;
      return [stem(0, 0, g.ascender), bar(0, x, g.xHeight / 2), box(x, x + g.wide(8), g.bottom(0), g.top(g.xHeight), ALL)];
    },
  },
  {
    from: 'ge-cy',
    stands: 0x433,
    languages: ['SRB'],
    lsb: 1.5,
    rsb: 0.5,
    as: 'smallcap',
    draw: ge,
    italic: (g) => [stem(0, 0, g.xHeight), overline(g, -2, 2)],
  },
  { from: 'de-cy', stands: 0x434, languages: ['SRB', 'MKD'], lsb: 0.75, rsb: 0.75, as: 'smallcap', draw: de, italic: italicOf('g') },
  {
    from: 'pe-cy',
    stands: 0x43f,
    languages: ['SRB', 'MKD'],
    lsb: 1.5,
    rsb: 1.5,
    as: 'smallcap',
    draw: pe,
    italic: (g) => [...letter('u').draw(g), overline(g, -0.75, g.wide(7) + 0.75)],
  },
  {
    from: 'te-cy',
    stands: 0x442,
    languages: ['SRB', 'MKD'],
    lsb: 1.5,
    rsb: 1.5,
    as: 'smallcap',
    draw: (g) => letter('T').draw(g),
    italic: (g) => [...shaLower(g), overline(g, -0.75, g.wide(11.5) + 0.75)],
  },
];

const loclName = (form: LoclForm) => `${form.from}.locl${form.languages[0]}`;

export const CYRILLIC_LOCL: GlyphDef[] = LOCL_FORMS.map((form) => ({
  name: loclName(form),
  stands: form.stands,
  ...(form.as === 'lower' ? { lower: true } : form.as === 'smallcap' ? { smallcap: true } : {}),
  lsb: form.lsb,
  rsb: form.rsb,
  draw: form.draw,
  ...(form.italic ? { italic: form.italic } : {}),
}));

/** Accented letters whose base has a language form: Bulgarian й and ѝ on its u-shaped и. */
export const CYRILLIC_LOCL_ACCENTED: AccentedDef[] = [
  { name: 'iibreve-cy.loclBGR', base: 'ii-cy.loclBGR', marks: ['brevecomb'] },
  { name: 'iigrave-cy.loclBGR', base: 'ii-cy.loclBGR', marks: ['gravecomb'] },
];

/** For each language, every glyph it replaces and the form it takes, accented letters included. */
export const LOCL: Record<LoclLanguage, [string, string][]> = {
  BGR: [
    ...LOCL_FORMS.filter((f) => f.languages.includes('BGR')).map((f): [string, string] => [f.from, loclName(f)]),
    ...CYRILLIC_LOCL_ACCENTED.map((a): [string, string] => [a.name.replace(/\.loclBGR$/, ''), a.name]),
  ],
  SRB: LOCL_FORMS.filter((f) => f.languages.includes('SRB')).map((f) => [f.from, loclName(f)]),
  MKD: LOCL_FORMS.filter((f) => f.languages.includes('MKD')).map((f) => [f.from, loclName(f)]),
};
