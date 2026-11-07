import type { PlacedDef } from './composites';
import {
  ALL,
  chevronLeft,
  diagonal,
  bar,
  box,
  DASH_AXIS,
  dot,
  type DrawContext,
  type GlyphDef,
  inPen,
  LEFT,
  mirror,
  open,
  p,
  RIGHT,
  rotate180,
  shift,
  stem,
  vee,
  yArms,
} from './draw';
import type { Stroke } from './geometry';
import { DRAWN_SIGNS, letter } from './glyphs-core';
import { smallPen, superiorOf } from './glyphs-figures';
import { GREEK } from './glyphs-greek';
import { hookLeft, hookRight, LATIN_EXTRA } from './glyphs-latin';
import { SYMBOLS } from './glyphs-symbols';

/**
 * The rest of GF Latin African: hooked, barred, turned and tailed letters, clicks, tone marks'
 * modifier letters and the circled A. Most are a letter with one stroke added or the letter turned.
 */

type Draw = (g: DrawContext) => Stroke[];

const latin = (name: string): GlyphDef => LATIN_EXTRA.find((d) => d.name === name) ?? DRAWN_SIGNS.find((d) => d.name === name) ?? letter(name);
const draw = (name: string): Draw => (g) => latin(name).draw(g);

/** A stroke through a stem at x, reaching past it on both sides. */
const strike = (g: DrawContext, x: number, y: number, reach = 1.25): Stroke => bar(x - g.v / 2 - reach, x + g.v / 2 + reach, y);
/** A stem that runs below the baseline and turns right: the retroflex hook of ʈ ɖ ɽ. */
const tail = (g: DrawContext, x: number, top: number): Stroke => {
  const b = g.bottom(-3);
  return open(p(x, top), p(x, b, true), p(x + 2.5, b));
};
/** A terminal that rises from the top right and turns right: Ƈ ƈ Ɠ. */
const hookUp = (w: number, t: number, rise: number) => [p(w + 2.5, t + rise), p(w, t + rise, true)];

const cHook = (g: DrawContext, w: number, height: number, lowEnd: number): Stroke[] => {
  const t = g.top(height);
  const b = g.bottom(0);
  return [open(...hookUp(w, t, 3), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, lowEnd))];
};
const glottalSmall: Draw = (g) => {
  const w = g.wide(6.5);
  const t = g.top(g.xHeight);
  const arm = Math.min(g.y(5), g.xHeight - g.h * 1.5 - g.aperture);
  return [open(p(0, g.y(7.5)), p(0, t, true), p(w, t, true), p(w, arm, true), p(w / 2, arm, true), p(w / 2, 0))];
};
const circled =
  (inner: Draw, width: number, lower: boolean): Draw =>
  (g) => {
    const w = g.wide(13);
    const small = g.sub(g.cap * 0.45, smallPen(g.v), lower);
    const top = lower ? small.xHeight : small.cap;
    return [box(0, w, g.bottom(-1), g.top(g.cap + 1), ALL), ...shift(inPen(small, inner(small)), w / 2 - small.wide(width) / 2, (g.cap - top) / 2)];
  };

const UPPER: GlyphDef[] = [
  { name: 'Btopbar', unicode: 0x182, lsb: 1.5, rsb: 1.25, draw: (g) => [bar(0, g.wide(10), g.top(g.cap)), stem(0, 0, g.cap), box(0, g.wide(10), g.bottom(0), g.y(8), RIGHT)] },
  { name: 'Chook', unicode: 0x187, lsb: 1.25, rsb: 0.5, draw: (g) => cHook(g, g.wide(10), g.cap, g.y(5)) },
  { name: 'Fhook', unicode: 0x191, lsb: 1.5, rsb: 0.5, draw: (g) => [open(p(g.wide(10), g.top(g.cap)), p(0, g.top(g.cap)), p(0, g.bottom(-3), true), p(-2.5, g.bottom(-3))), bar(0, g.wide(8.5), g.cap / 2)] },
  {
    name: 'Ghook',
    unicode: 0x193,
    lsb: 1.25,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(10);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      const y = g.top(Math.max(g.cap / 2, 2 * g.h + 1.6));
      return [open(...hookUp(w, t, 3), p(w, t, true), p(0, t, true), p(0, b, true), p(w, b, true), p(w, y), p(w * 0.4, y))];
    },
  },
  { name: 'Gammaafrican', unicode: 0x194, lsb: 0.3, rsb: 0.3, draw: (g) => yArms(g, g.wide(10.5), g.cap, g.y(2), -3) },
  { name: 'Iotaafrican', unicode: 0x196, lsb: 1.5, rsb: 0.75, draw: (g) => [open(p(0, g.cap), p(0, g.bottom(0), true), p(g.wide(3), g.bottom(0)))] },
  { name: 'Istroke', unicode: 0x197, lsb: 1.5, rsb: 1.5, draw: (g) => [stem(0, 0, g.cap), strike(g, 0, g.cap / 2, 1.5)] },
  { name: 'Mturned', unicode: 0x19c, lsb: 1.5, rsb: 1.5, draw: (g) => rotate180(draw('M')(g), g.wide(11) / 2, g.cap / 2) },
  { name: 'Phook', unicode: 0x1a4, lsb: 0.5, rsb: 1.25, draw: (g) => [...draw('P')(g), hookLeft(g, g.cap)] },
  {
    name: 'Thook',
    unicode: 0x1ac,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(11);
      const t = g.top(g.cap);
      return [open(p(0, t - 3), p(0, t, true), p(w, t)), stem(w / 2, 0, g.cap)];
    },
  },
  {
    name: 'Tretroflexhook',
    unicode: 0x1ae,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(11);
      return [bar(0, w, g.top(g.cap)), tail(g, w / 2, g.cap)];
    },
  },
  { name: 'Upsilonafrican', unicode: 0x1b1, lsb: 0.75, rsb: 0.75, draw: (g) => rotate180(draw('Ohm')(g), g.wide(11) / 2, g.cap / 2) },
  {
    name: 'Vhook',
    unicode: 0x1b2,
    lsb: 1.5,
    rsb: 0.75,
    draw: (g) => {
      const w = g.wide(10);
      const b = g.bottom(0);
      const t = g.top(g.cap);
      return [open(p(0, g.cap), p(0, b, true), p(w, b, true), p(w, t, true), p(w - 2.5, t))];
    },
  },
  { name: 'Ezhreversed', unicode: 0x1b8, lsb: 1, rsb: 1, draw: (g) => mirror(draw('Ezh')(g), g.wide(9) / 2) },
  { name: 'Bstroke', unicode: 0x243, lsb: 0.5, rsb: 1.25, draw: (g) => [...draw('B')(g), bar(-g.v / 2 - 1.5, 2, g.cap / 2)] },
  {
    name: 'Ubar',
    unicode: 0x244,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(10);
      return [...draw('U')(g), bar(-1.5, w + 1.5, Math.max(g.y(5.5), g.h * 1.5 + 1.6))];
    },
  },
  { name: 'Jstroke', unicode: 0x248, lsb: 1, rsb: 0.5, draw: (g) => [...draw('J')(g), strike(g, g.wide(8), g.y(8))] },
  { name: 'Rstroke', unicode: 0x24c, lsb: 0.5, rsb: 0.3, draw: (g) => [...draw('R')(g), strike(g, 0, g.y(3))] },
  { name: 'Pstroke', unicode: 0x2c63, lsb: 0.5, rsb: 1.25, draw: (g) => [...draw('P')(g), strike(g, 0, Math.min(g.y(3), g.y(6) - g.h - 1.6))] },
  { name: 'Rtail', unicode: 0x2c64, lsb: 1.5, rsb: 0.3, draw: (g) => [tail(g, 0, g.cap), ...draw('R')(g).slice(1)] },
  {
    name: 'Alpha-latin',
    unicode: 0x2c6d,
    lsb: 1.25,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(10);
      return [stem(w, 0, g.cap), box(0, w, g.bottom(0), g.top(g.cap), LEFT)];
    },
  },
  { name: 'Aturned', unicode: 0x2c6f, lsb: 0.3, rsb: 0.3, draw: (g) => rotate180(draw('A')(g), g.wide(10) / 2, g.cap / 2) },
  {
    name: 'Whook',
    unicode: 0x2c72,
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(15);
      return [...draw('W')(g), bar(w - g.v / 2, w + 2.5, g.top(g.cap))];
    },
  },
  {
    name: 'Hturned',
    unicode: 0xa78d,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(9);
      const t = g.top(g.y(8));
      return rotate180([stem(0, 0, g.cap), open(p(0, t), p(w, t, true), p(w, 0))], w / 2, g.cap / 2);
    },
  },
  { name: 'Hhook', unicode: 0xa7aa, lsb: 0.5, rsb: 1.5, draw: (g) => [...draw('H')(g), hookLeft(g, g.cap)] },
  {
    name: 'Ismallcap',
    unicode: 0xa7ae,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(5.5);
      return [stem(w / 2, 0, g.cap), bar(0, w, g.top(g.cap)), bar(0, w, g.bottom(0))];
    },
  },
  {
    name: 'Jcrossedtail',
    unicode: 0xa7b2,
    lsb: 0.5,
    rsb: 1.5,
    draw: (g) => {
      const b = g.bottom(-4);
      return [open(p(0, g.cap), p(0, b, true), p(-2.75, b)), strike(g, 0, g.y(2))];
    },
  },
  { name: 'Beta-latin', unicode: 0xa7b4, lsb: 1.5, rsb: 1.25, draw: (g) => [stem(0, -3.5, g.cap), ...draw('B')(g)] },
  {
    name: 'Omega-latin',
    unicode: 0xa7b6,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(13);
      return [open(p(0, g.cap), p(0, g.bottom(0), true), p(w, g.bottom(0), true), p(w, g.cap)), stem(w / 2, 0, g.y(9))];
    },
  },
  { name: 'Dshortstroke', unicode: 0xa7c7, lsb: 0.5, rsb: 1.25, draw: (g) => [box(0, g.wide(10), g.bottom(0), g.top(g.cap), RIGHT), strike(g, 0, g.cap / 2, 1)] },
  {
    name: 'Ramshorn',
    unicode: 0xa7cb,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(10);
      const b = g.bottom(g.y(4));
      return [open(p(0, g.cap), p(0, b, true), p(w, b, true), p(w, g.cap)), stem(w / 2, -3, b)];
    },
  },
  { name: 'Acircle', unicode: 0x24b6, lsb: 1, rsb: 1, draw: circled(draw('A'), 10, false) },
];

const LOWER_DEFS: GlyphDef[] = [
  { name: 'bstroke', unicode: 0x180, lsb: 0.5, rsb: 1.25, draw: (g) => [...draw('b')(g), bar(-g.v / 2 - 1, 3, 12.5)] },
  { name: 'btopbar', unicode: 0x183, lsb: 1.5, rsb: 1.25, draw: (g) => [...draw('b')(g), bar(0, g.wide(6), g.top(g.ascender))] },
  { name: 'chook', unicode: 0x188, lsb: 1.25, rsb: 0.5, draw: (g) => cHook(g, g.wide(7.5), g.xHeight, 3) },
  { name: 'florin', unicode: 0x192, lsb: 0.5, rsb: 0.5, draw: (g) => (letter('f').italic ?? letter('f').draw)(g) },
  { name: 'phook', unicode: 0x1a5, lsb: 1.5, rsb: 1.25, draw: (g) => [stem(0, g.descender, g.xHeight), hookRight(g, 0), box(0, g.wide(8), g.bottom(0), g.top(g.xHeight), RIGHT)] },
  {
    name: 'thook',
    unicode: 0x1ad,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const b = g.bottom(0);
      const t = g.top(14.5);
      return [open(p(2.5, t), p(0, t, true), p(0, b, true), p(g.wide(3.5), b)), bar(-g.v / 2 - 1.25, g.wide(3.5), g.top(g.xHeight))];
    },
  },
  { name: 'ezhreversed', unicode: 0x1b9, lsb: 1, rsb: 1, draw: (g) => mirror(draw('ezh')(g), g.wide(7.5) / 2) },
  { name: 'glottalstopsmall', unicode: 0x242, lsb: 1, rsb: 1, draw: glottalSmall },
  { name: 'jstroke', unicode: 0x249, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('j')(g), strike(g, 0, 3.5)] },
  { name: 'rstroke', unicode: 0x24d, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('r')(g), strike(g, 0, 4)] },
  { name: 'aturned', unicode: 0x250, lsb: 1.25, rsb: 1.5, draw: (g) => rotate180(draw('a')(g), g.wide(7.5) / 2, g.xHeight / 2) },
  {
    name: 'dtail',
    unicode: 0x256,
    lsb: 1.25,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(8);
      return [tail(g, w, g.ascender), box(0, w, g.bottom(0), g.top(g.xHeight), LEFT)];
    },
  },
  {
    name: 'ghook',
    unicode: 0x260,
    lsb: 1.25,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(8);
      const d = g.bottom(g.descender);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), LEFT), open(...hookUp(w, g.top(g.xHeight), 3.5), p(w, d, true), p(0, d, true), p(0, -1.5))];
    },
  },
  {
    name: 'ramshorn',
    unicode: 0x264,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(8);
      const b = g.bottom(3);
      return [open(p(0, g.xHeight), p(0, b, true), p(w, b, true), p(w, g.xHeight)), stem(w / 2, g.descender, b)];
    },
  },
  {
    name: 'hturned',
    unicode: 0x265,
    lsb: 1.4,
    rsb: 1.5,
    draw: (g) => rotate180(draw('h')(g), g.wide(7) / 2, g.xHeight / 2),
  },
  {
    name: 'hhook',
    unicode: 0x266,
    lsb: 1.5,
    rsb: 1.4,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      return [hookRight(g, 0), open(p(0, t), p(w, t, true), p(w, 0))];
    },
  },
  { name: 'istroke', unicode: 0x268, lsb: 1, rsb: 1, draw: (g) => [...draw('i')(g), strike(g, 0, g.xHeight / 2)] },
  { name: 'mturned', unicode: 0x26f, lsb: 1.4, rsb: 1.5, draw: (g) => rotate180(draw('m')(g), g.wide(6.5), g.xHeight / 2) },
  {
    name: 'rtail',
    unicode: 0x27d,
    lsb: 1.5,
    rsb: 0.5,
    draw: (g) => [tail(g, 0, g.xHeight), bar(0, g.wide(5), g.top(g.xHeight))],
  },
  {
    name: 'tretroflexhook',
    unicode: 0x288,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => [tail(g, 0, 13), bar(-g.v / 2 - 1.25, g.wide(3.5), g.top(g.xHeight))],
  },
  { name: 'ubar', unicode: 0x289, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('u')(g), bar(-1.25, g.wide(7) + 1.25, Math.max(g.y(4.5), g.h * 1.5 + 1.6))] },
  { name: 'vturned', unicode: 0x28c, lsb: 0.3, rsb: 0.3, draw: (g) => vee(g, 0, g.wide(8.5), 0, g.xHeight) },
  { name: 'jcrossedtail', unicode: 0x29d, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('j')(g), strike(g, 0, 1.5)] },
  { name: 'pstroke', unicode: 0x1d7d, lsb: 0.5, rsb: 1.25, draw: (g) => [...draw('p')(g), strike(g, 0, -2.75)] },
  { name: 'whook', unicode: 0x2c73, lsb: 0.3, rsb: 0.3, draw: (g) => [...draw('w')(g), bar(g.wide(12) - g.v / 2, g.wide(12) + 2, g.top(g.xHeight))] },
  {
    name: 'dshortstroke',
    unicode: 0xa7c8,
    lsb: 1.25,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(8);
      return [...draw('d')(g), strike(g, w, 12.5, 1)];
    },
  },
  { name: 'acircle', unicode: 0x24d0, lsb: 1, rsb: 1, draw: circled((g) => (letter('a').italic ?? letter('a').draw)(g), 7.5, true) },
];

/** Clicks: letters drawn as bars, from the descender to the ascender like |. */
const CLICKS: GlyphDef[] = [
  { name: 'clickdental', unicode: 0x1c0, lsb: 1.5, rsb: 1.5, draw: () => [stem(0, -3.5, 15.5)] },
  { name: 'clicklateral', unicode: 0x1c1, lsb: 1.5, rsb: 1.5, draw: (g) => [stem(0, -3.5, 15.5), stem(g.v + 1.6, -3.5, 15.5)] },
  { name: 'clickalveolar', unicode: 0x1c2, lsb: 1, rsb: 1, draw: (g) => [stem(0, -3.5, 15.5), strike(g, 0, 7.5, 2), strike(g, 0, 4, 2)] },
  {
    name: 'bilabialclick',
    unicode: 0x298,
    lsb: 1.25,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(10);
      return [box(0, w, g.bottom(0), g.top(g.cap), ALL), dot(g, w / 2, g.cap / 2 - g.dot / 2)];
    },
  },
  { name: 'glottalstopreversed', unicode: 0x295, lsb: 1, rsb: 1, draw: (g) => mirror(draw('glottalstop')(g), g.wide(7.5) / 2) },
];

/** Modifier letters, spaced by hand: superscript letters, stress and tone signs. */
const LIGHTER = 0.75;
const MODIFIERS: GlyphDef[] = [
  superiorOf(letter('w'), 'wmod', 0x2b7),
  superiorOf(letter('y'), 'ymod', 0x2b8),
  superiorOf(letter('a'), 'amod', 0x1d43, true, LIGHTER),
  superiorOf(letter('e'), 'emod', 0x1d49, true, LIGHTER),
  superiorOf(latin('eopen'), 'eopenmod', 0x1d4b, true, LIGHTER),
  superiorOf(letter('o'), 'omod', 0x1d52),
  superiorOf(latin('oopen'), 'oopenmod', 0x1d53),
  superiorOf(letter('u'), 'umod', 0x1d58),
  superiorOf(letter('i'), 'isuperior', 0x2071),
  superiorOf(latin('glottalstop'), 'glottalstopmod', 0x2c0, false, LIGHTER),
  superiorOf({ ...latin('glottalstop'), draw: (g) => mirror(draw('glottalstop')(g), g.wide(7.5) / 2) }, 'glottalstopreversedmod', 0x2c1, false, LIGHTER),
  superiorOf({ name: 'glottalstopreversedsmall', lsb: 1, rsb: 1, draw: (g) => mirror(glottalSmall(g), g.wide(6.5) / 2) }, 'glottalstopreversedsmallmod', 0x2e4, true, LIGHTER),
  superiorOf(LOWER_DEFS.find((d) => d.name === 'istroke')!, 'istrokemod', 0x1da4),
  superiorOf(LOWER_DEFS.find((d) => d.name === 'ubar')!, 'ubarmod', 0x1db6),
  { name: 'verticallinemod', unicode: 0x2c8, lsb: 1, rsb: 1, draw: (g) => [stem(0, g.cap - 4, g.cap + 0.5)] },
  { name: 'minusmod', unicode: 0x2d7, lsb: 1, rsb: 1, draw: () => [bar(0, 4, DASH_AXIS)] },
  {
    name: 'equalsmod',
    unicode: 0xa78a,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const d = g.h / 2 + 0.8;
      return [bar(0, 4, DASH_AXIS - d), bar(0, 4, DASH_AXIS + d)];
    },
  },
];

/** A diagonal stroke through a whole letter, from below its left foot to above its right shoulder: Ⱥ Ȼ Ⱦ. */
const slash = (g: DrawContext, w: number, height: number): Stroke => diagonal(g, w * 0.15, -1, w * 0.85, height + 1);
/** A tilde across a stem at height y: ɫ Ɫ. */
const tildeAcross = (x: number, y: number): Stroke => {
  const s = 1.5;
  return open(p(x - 1.5 * s, y - s / 2), p(x - 0.5 * s, y + s / 2, true), p(x + 0.5 * s, y - s / 2, true), p(x + 1.5 * s, y + s / 2));
};
/** A short stroke out of the right side of a stem, where a stroke across it would close a counter: Ǥ ǥ. */
const spur = (g: DrawContext, x: number, y: number): Stroke => bar(x - g.v / 2, x + g.v / 2 + 1.75, y);
const quoteRight = SYMBOLS.find((d) => d.name === 'quoteright')!;

/** GF Latin Beyond and the transliteration sets: barred, slashed and belted letters, half rings. */
const BEYOND_UPPER: GlyphDef[] = [
  { name: 'Gstroke', unicode: 0x1e4, lsb: 1.25, rsb: 0.5, draw: (g) => [...draw('G')(g), spur(g, g.wide(10), g.top(Math.max(g.cap / 2, 2 * g.h + 1.6)))] },
  { name: 'Astroke', unicode: 0x23a, lsb: 0.3, rsb: 0.3, draw: (g) => [...draw('A')(g), slash(g, g.wide(10), g.cap)] },
  { name: 'Cstroke', unicode: 0x23b, lsb: 1.25, rsb: 1, draw: (g) => [...draw('C')(g), slash(g, g.wide(10), g.cap)] },
  { name: 'Lbar', unicode: 0x23d, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('L')(g), strike(g, 0, g.cap / 2, 1.5)] },
  { name: 'Tdiagonalstroke', unicode: 0x23e, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('T')(g), slash(g, g.wide(11), g.cap)] },
  { name: 'Lmiddletilde', unicode: 0x2c62, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('L')(g), tildeAcross(0, g.cap / 2)] },
  { name: 'Yturned', unicode: 0x2144, lsb: 0.3, rsb: 0.3, draw: (g) => rotate180(draw('Y')(g), g.wide(11) / 2, g.cap / 2) },
];
const BEYOND_LOWER: GlyphDef[] = [
  { name: 'lbar', unicode: 0x19a, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('l')(g), strike(g, 0, g.y(7.5))] },
  { name: 'lambdastroke', unicode: 0x19b, lsb: 0.3, rsb: 0.3, draw: (g) => [...GREEK.find((d) => d.name === 'lambda')!.draw(g), bar(0.5, 5, g.y(11.5))] },
  { name: 'gstroke', unicode: 0x1e5, lsb: 1.25, rsb: 0.5, draw: (g) => [...draw('g')(g), spur(g, g.wide(8), -1.75)] },
  { name: 'cstroke', unicode: 0x23c, lsb: 1.25, rsb: 1, draw: (g) => [...draw('c')(g), slash(g, g.wide(7.5), g.xHeight)] },
  { name: 'lmiddletilde', unicode: 0x26b, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('l')(g), tildeAcross(0, g.y(7.5))] },
  {
    name: 'lbelt',
    unicode: 0x26c,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const y = g.y(6.5);
      const left = -(g.v + 2.2);
      const top = y + g.h + 2.2;
      return [...draw('l')(g), open(p(g.v / 2 + 1.5, y), p(left, y, true), p(left, top, true), p(0, top))];
    },
  },
  { name: 'astroke', unicode: 0x2c65, lsb: 0.3, rsb: 0.3, draw: (g) => [...draw('a')(g), slash(g, g.wide(7.5), g.xHeight)] },
  { name: 'tdiagonalstroke', unicode: 0x2c66, lsb: 0.5, rsb: 0.5, draw: (g) => [...draw('t')(g), slash(g, g.wide(4), g.y(13) - 1)] },
];
/** ʾ: a small half ring opening left, drawn as a 45° angle like the parentheses. */
const halfRing = (g: DrawContext): Stroke[] => mirror(chevronLeft(g, 2, g.cap - 2), 1);
const BEYOND_MODIFIERS: GlyphDef[] = [
  superiorOf(letter('z'), 'zmod', 0x1dbb),
  superiorOf({ ...GREEK.find((d) => d.name === 'theta')!, lower: true }, 'thetamod', 0x1dbf, true, LIGHTER),
  superiorOf(letter('N'), 'Nmod', 0x1d3a, false),
  superiorOf(letter('n'), 'nsuperior', 0x207f),
  { name: 'commareversedmod', unicode: 0x2bd, lsb: 1.25, rsb: 1.25, draw: (g) => mirror(quoteRight.draw(g), 0) },
  { name: 'ringhalfrightmod', unicode: 0x2be, lsb: 1, rsb: 1, draw: halfRing },
  { name: 'ringhalfleftmod', unicode: 0x2bf, lsb: 1, rsb: 1, draw: (g) => mirror(halfRing(g), 1) },
];

export const AFRICAN: GlyphDef[] = [
  ...UPPER,
  ...BEYOND_UPPER,
  ...[...LOWER_DEFS, ...BEYOND_LOWER].map((def) => ({ ...def, lower: true })),
  ...CLICKS,
  ...MODIFIERS,
  ...BEYOND_MODIFIERS,
];

/** Letters that are another glyph under a second code point. */
export const AFRICAN_ALIASES: PlacedDef[] = (
  [
    ['Dafrican', 0x189, 'Eth'],
    ['Obarred', 0x19f, 'Obarred-cy'],
    ['obarred', 0x275, 'obarred-cy'],
    ['gamma-latin', 0x263, 'gamma'],
    ['iota-latin', 0x269, 'iota'],
    ['omega-latin', 0xa7b7, 'omega'],
    ['beta-latin', 0xa7b5, 'beta'],
    ['Vturned', 0x245, 'Lambda'],
    ['Glottalstop', 0x241, 'glottalstop'],
    ['clickretroflex', 0x1c3, 'exclam'],
    ['commaturnedmod', 0x2bb, 'quoteleft'],
    ['apostrophedblmod', 0x2ee, 'quotedblright'],
    ['colonmod', 0xa789, 'colon'],
    ['Saltillo', 0xa78b, 'quotesingle'],
    ['saltillo', 0xa78c, 'quotesingle'],
    ['primemod', 0x2b9, 'minute'],
    ['chi-latin', 0xab53, 'chi'],
  ] as const
).map(([name, unicode, glyph]) => ({ name, unicode, parts: [{ glyph, after: true }] }));
