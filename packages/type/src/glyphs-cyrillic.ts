import type { PlacedDef } from './composites';
import {
  ALL,
  bar,
  box,
  diagonal,
  type DrawContext,
  type GlyphDef,
  mirror,
  open,
  p,
  RIGHT,
  stem,
  yArms,
} from './draw';
import type { Stroke } from './geometry';
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
const che: Draw = (g) => {
  const w = g.wide(9);
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
  return [open(p(x, t), p(w, t), p(w, 0)), open(p(x, t), p(x, b, true), p(-0.75, b))];
};
const de: Draw = (g) => {
  const w = g.wide(9.5);
  const x = g.wide(2);
  const t = g.top(g.cap);
  const b = g.bottom(0);
  return [open(p(x, t), p(w, t), p(w, b)), open(p(x, t), p(x, g.y(3)), p(0, g.y(1.5)), p(0, b)), bar(-1, w + 1, b), descender(g, -1), descender(g, w + 1)];
};
const zhe: Draw = (g) => {
  const w = g.wide(15);
  const c = w / 2;
  const y0 = g.cap / 2;
  const arm = (dir: 1 | -1) => {
    const reach = c + dir * (c + g.v / 2 - g.foot(c, g.cap - y0));
    return [diagonal(g, c, y0, reach, g.cap, [false, true]), diagonal(g, c + dir * 1, y0, reach, 0, [false, true])];
  };
  return [stem(c, 0, g.cap), bar(c - 2.5, c + 2.5, y0), ...arm(1), ...arm(-1)];
};
const sha: Draw = (g) => {
  const w = g.wide(14);
  return [stem(0, 0, g.cap), stem(w / 2, 0, g.cap), stem(w, 0, g.cap), bar(0, w, g.bottom(0))];
};
const tse: Draw = (g) => {
  const w = g.wide(9.5);
  return [stem(0, 0, g.cap), stem(w, 0, g.cap), bar(0, w + 1.5, g.bottom(0)), descender(g, w + 1.5)];
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
  return [diagonal(g, 0, g.cap, w * 0.5, y), diagonal(g, w, g.cap, w * 0.15, 0)];
};
const gheUp: Draw = (g) => [open(p(g.wide(9), g.cap + 2.5), p(g.wide(9), g.top(g.cap)), p(0, g.top(g.cap)), p(0, 0))];
const gheBar: Draw = (g) => [...ge(g), bar(-1.5, g.wide(4.5), g.cap / 2)];
const ue: Draw = (g) => {
  const w = g.wide(11);
  return yArms(g, w, g.cap, g.y(6));
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
  return [...sha(g).slice(0, 3), bar(0, w + 1.5, g.bottom(0)), descender(g, w + 1.5)];
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
  { name: 'Che-cy', unicode: 0x427, lower: 0x447, lsb: 1.5, rsb: 1.5, draw: che },
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
  { name: 'Zhedescender-cy', unicode: 0x496, lower: 0x497, lsb: 0.3, rsb: 0.3, draw: (g) => [...zhe(g), descender(g, g.wide(15) + 0.5)] },
  {
    name: 'Kadescender-cy',
    unicode: 0x49a,
    lower: 0x49b,
    lsb: 1.5,
    rsb: 0.3,
    draw: (g) => [...letter('K').draw(g), descender(g, g.wide(9.5) + 0.5)],
  },
  { name: 'Endescender-cy', unicode: 0x4a2, lower: 0x4a3, lsb: 1.5, rsb: 0.5, draw: (g) => [...letter('H').draw(g), bar(g.wide(9), g.wide(9) + 1.5, g.bottom(0)), descender(g, g.wide(9) + 1.5)] },
  { name: 'Ustraight-cy', unicode: 0x4ae, lsb: 0.3, rsb: 0.3, draw: ue },
  { name: 'Ustraightstroke-cy', unicode: 0x4b0, lsb: 0.3, rsb: 0.3, draw: (g) => [...ue(g), bar(g.wide(11) / 2 - 3, g.wide(11) / 2 + 3, g.y(4))] },
  { name: 'Hadescender-cy', unicode: 0x4b2, lower: 0x4b3, lsb: 0.4, rsb: 0.4, draw: (g) => [...letter('X').draw(g), descender(g, g.wide(10) + 0.5)] },
  { name: 'Chedescender-cy', unicode: 0x4b6, lower: 0x4b7, lsb: 1.5, rsb: 0.5, draw: (g) => [...che(g), bar(g.wide(9), g.wide(9) + 1.5, g.bottom(0)), descender(g, g.wide(9) + 1.5)] },
  { name: 'Shha-cy', unicode: 0x4ba, lsb: 1.5, rsb: 1.5, draw: shha },
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
      return [stem(0, 0, g.ascender), bar(-g.v / 2 - 1, 3, 12.5), open(p(0, t), p(w, t, true), p(w, d, true), p(w - 2.5, d))];
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
      return [stem(0, 0, g.ascender), bar(-g.v / 2 - 1, 3, 12.5), open(p(0, t), p(w, t, true), p(w, 0))];
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
      return [...yArms(g, w, g.xHeight, 0, g.descender), bar(w / 2 - 2.5, w / 2 + 2.5, -1.5)];
    },
  },
];

const lowerName = (name: string) => name.replace(/^./, (c) => c.toLowerCase());

export const CYRILLIC: GlyphDef[] = [
  ...DRAWN.map(({ lower: _lower, ...def }) => def),
  ...DRAWN.filter((d) => d.lower !== undefined).map((d) => ({
    name: lowerName(d.name),
    unicode: d.lower!,
    smallcap: true,
    lsb: d.lsb,
    rsb: d.rsb,
    draw: d.draw,
  })),
  ...SMALL_OF_LATIN.map(([name, unicode, latin]) => {
    const def = letter(latin);
    return { name, unicode, smallcap: true, lsb: def.lsb, rsb: def.rsb, draw: def.draw };
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
  ] as const
).map(([name, unicode, glyph]) => ({ name, unicode, parts: [{ glyph, after: true }] }));

