/**
 * The IPA letters GF Phonetics IPA Standard adds to GF Latin African (3.1): turned, reversed and hooked forms of letters
 * the font already draws, each built from that letter so it is spaced and joined as the letter is.
 */
import type { PlacedDef } from './composites';
import { ALL, bar, box, type DrawContext, type GlyphDef, mirror, OVERHANG, open, p, ring, rotate180, solid, stem, withPen } from './draw';
import { superiorOf } from './glyphs-figures';
import { GREEK } from './glyphs-greek';
import type { Stroke } from './geometry';
import { DRAWN_SIGNS, letter } from './glyphs-core';
import { hookRight, LATIN_EXTRA } from './glyphs-latin';

type Draw = (g: DrawContext) => Stroke[];

const latin = (name: string): GlyphDef => LATIN_EXTRA.find((d) => d.name === name) ?? DRAWN_SIGNS.find((d) => d.name === name) ?? letter(name);
const draw = (name: string): Draw => (g) => latin(name).draw(g);

/** A stem that runs below the baseline and turns right: the retroflex hook, as ʈ ɖ ɽ have it. */
const tail = (g: DrawContext, x: number, top: number): Stroke => {
  const b = g.bottom(-3);
  return open(p(x, top), p(x, b, true), p(x + 2.5, b));
};
/** The rhotic hook of ɚ ɝ: from the letter's right side a short arm out and up, a stroke and a gap clear of the bar inside. */
const rhotic = (g: DrawContext, x: number): Stroke => {
  const y = Math.max(g.y(6.5), g.xHeight - 5.25 + g.h + 2);
  const arm = 2.5 + g.v;
  return open(p(x, y), p(x + arm, y, true), p(x + arm, y + Math.max(2.5, 1.5 * g.h + 1)));
};
const strike = (g: DrawContext, x: number, y: number): Stroke => bar(x - g.v / 2 - OVERHANG, x + g.v / 2 + OVERHANG, y);

const R = (g: DrawContext) => g.wide(5);

/** Lowercase letters all: drawn in the lowercase context, with its lighter horizontals, as the letters they come from. */
const IPA_DEFS: GlyphDef[] = [
  { name: 'rturned', unicode: 0x279, lsb: 0.5, rsb: 1.5, draw: (g) => rotate180(draw('r')(g), R(g) / 2, g.xHeight / 2) },
  { name: 'rturnedlongleg', unicode: 0x27a, lsb: 0.5, rsb: 1.5, draw: (g) => [bar(0, R(g), g.bottom(0)), stem(R(g), 0, g.ascender)] },
  { name: 'rturnedhook', unicode: 0x27b, lsb: 0.5, rsb: 0.5, draw: (g) => [bar(0, R(g), g.bottom(0)), tail(g, R(g), g.xHeight)] },
  {
    name: 'rfishhook',
    unicode: 0x27e,
    lsb: 1.5,
    rsb: 0.5,
    draw: (g) => {
      const t = g.top(g.xHeight);
      return [open(p(0, 0), p(0, t, true), p(R(g), t, true), p(R(g), t - 2.5))];
    },
  },
  { name: 'wturned', unicode: 0x28d, lsb: 0.3, rsb: 0.3, draw: (g) => rotate180(draw('w')(g), g.wide(12) / 2, g.xHeight / 2) },
  { name: 'yturned', unicode: 0x28e, lsb: 0.3, rsb: 0.3, draw: (g) => rotate180(draw('y')(g), g.wide(8.5) / 2, g.xHeight / 2) },
  { name: 'tturned', unicode: 0x287, lsb: 0.5, rsb: 0.5, draw: (g) => rotate180(draw('t')(g), g.wide(3.5) / 2, g.xHeight / 2) },
  { name: 'kturned', unicode: 0x29e, lsb: 1, rsb: 1.5, draw: (g) => rotate180(draw('k')(g), g.wide(7.5) / 2, g.xHeight / 2) },
  {
    name: 'mturnedlongleg',
    unicode: 0x270,
    lsb: 1.4,
    rsb: 1.5,
    draw: (g) => [...rotate180(draw('m')(g), g.wide(6.5), g.xHeight / 2), stem(2 * g.wide(6.5), g.descender, g.xHeight / 2)],
  },
  { name: 'lretroflexhook', unicode: 0x26d, lsb: 1.5, rsb: 0.5, draw: (g) => [tail(g, 0, g.ascender)] },
  {
    name: 'nretroflexhook',
    unicode: 0x273,
    lsb: 1.5,
    rsb: 0.5,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      return [stem(0, 0, g.xHeight), open(p(0, t), p(w, t, true), p(w, g.bottom(-3), true), p(w + 2.5, g.bottom(-3)))];
    },
  },
  {
    // ʂ s whose last stroke turns down into the hook where s rises into its terminal.
    name: 'sretroflexhook',
    unicode: 0x282,
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const w = g.wide(7);
      // Below its base the hook has two cut corners, so it reaches a unit further down than ʈ's.
      const [t, b, d] = [g.top(g.xHeight), g.bottom(0), g.bottom(-4)];
      return [open(p(w, g.y(7.5)), p(w, t, true), p(0, t, true), p(0, g.y(5), true), p(w, g.y(5), true), p(w, b, true), p(0, b, true), p(0, d, true), p(2.5, d))];
    },
  },
  // ʐ z with the hook down from the end of its base, the stem flush with the bar's end.
  { name: 'zretroflexhook', unicode: 0x290, lsb: 0.75, rsb: 0.5, draw: (g) => [...draw('z')(g), tail(g, g.wide(7.5) - g.v / 2, g.h / 2)] },
  {
    name: 'mhook',
    unicode: 0x271,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(6.5);
      const t = g.top(g.xHeight);
      const d = g.bottom(g.descender);
      return [stem(0, 0, g.xHeight), open(p(0, t), p(w, t), p(w, 0)), open(p(w, t), p(2 * w, t, true), p(2 * w, d, true), p(2 * w - 2.5, d))];
    },
  },
  {
    name: 'henghook',
    unicode: 0x267,
    lsb: 1.5,
    rsb: 1.5,
    draw: (g) => {
      const w = g.wide(7);
      const t = g.top(g.xHeight);
      const d = g.bottom(g.descender);
      return [hookRight(g, 0), open(p(0, t), p(w, t, true), p(w, d, true), p(w - 2.5, d))];
    },
  },
  {
    name: 'dotlessjstroke',
    unicode: 0x25f,
    lsb: 0.5,
    rsb: 1,
    draw: (g) => [open(p(0, g.xHeight), p(0, g.bottom(g.descender), true), p(-2.5, g.bottom(g.descender))), strike(g, 0, g.xHeight / 2)],
  },
  {
    name: 'dotlessjstrokehook',
    unicode: 0x284,
    lsb: 0.5,
    rsb: 0.5,
    draw: (g) => {
      const [d, t] = [g.bottom(g.descender), g.top(g.ascender)];
      return [open(p(-2.5, d), p(0, d, true), p(0, t, true), p(g.v / 2 + 2.5, t)), strike(g, 0, g.xHeight / 2)];
    },
  },
  { name: 'ereversed', unicode: 0x258, lsb: 1.25, rsb: 1, draw: (g) => mirror(draw('e')(g), g.wide(8) / 2) },
  { name: 'eopenreversed', unicode: 0x25c, lsb: 1, rsb: 1.25, draw: (g) => mirror(draw('eopen')(g), g.wide(7) / 2) },
  {
    // ɞ ɜ closed on its left: one cut frame with ɜ's middle stroke reaching in from the right.
    name: 'eopenreversedclosed',
    unicode: 0x25e,
    lsb: 1.5,
    rsb: 1.25,
    draw: (g) => {
      const w = g.wide(7);
      // Three horizontals in the x-height: the middle one thins where a full one would close the counters.
      const middle = Math.min(g.h, g.xHeight - 2 * g.h - 2 * 1.45);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), ALL), withPen(bar(Math.max(w * 0.35, g.v / 2 + 1.45), w, g.xHeight / 2), { ...g.pen, h: middle })];
    },
  },
  { name: 'schwahook', unicode: 0x25a, lsb: 1, rsb: 0.5, draw: (g) => [...draw('schwa')(g), rhotic(g, g.wide(8))] },
  { name: 'eopenreversedhook', unicode: 0x25d, lsb: 1, rsb: 0.5, draw: (g) => [...mirror(draw('eopen')(g), g.wide(7) / 2), rhotic(g, g.wide(7))] },
  {
    name: 'glottalstopstroke',
    unicode: 0x2a1,
    lsb: 1,
    rsb: 1,
    draw: (g) => [...draw('glottalstop')(g), strike(g, g.wide(7.5) / 2, g.y(3))],
  },
  {
    name: 'glottalstopstrokereversed',
    unicode: 0x2a2,
    lsb: 1,
    rsb: 1,
    draw: (g) => mirror([...draw('glottalstop')(g), strike(g, g.wide(7.5) / 2, g.y(3))], g.wide(7.5) / 2),
  },
];

/** A stroke through the middle of a letter, from the tilde's own wave in a lighter pen, as ᵽ's stroke is, so its notches stay open at Black: ᵬ ᵭ ᵮ. */
const tildeAcross = (g: DrawContext, x: number, y: number): Stroke => {
  const s = 1.75;
  const pen = { ...g.pen, v: Math.min(g.v, 1.6), h: Math.min(g.h, 1.6) };
  return withPen(open(p(x - 1.5 * s, y - s / 2), p(x - 0.5 * s, y + s / 2, true), p(x + 0.5 * s, y - s / 2, true), p(x + 1.5 * s, y + s / 2)), pen);
};

/** Letters with a tilde through their middle (GF Phonetics), each at its stem or its middle. */
const MIDDLE_TILDE: [string, number, string, (g: DrawContext) => number, (g: DrawContext) => number][] = [
  // On b and d through the ascender above the bowl, as ɫ has it.
  ['bmiddletilde', 0x1d6c, 'b', () => 0, (g) => (g.xHeight + g.ascender) / 2],
  ['dmiddletilde', 0x1d6d, 'd', (g) => g.wide(8), (g) => (g.xHeight + g.ascender) / 2],
  ['fmiddletilde', 0x1d6e, 'f', () => 0, (g) => g.y(5)],
  ['mmiddletilde', 0x1d6f, 'm', (g) => g.wide(6.5), (g) => g.xHeight / 2],
  ['nmiddletilde', 0x1d70, 'n', () => 0, (g) => g.xHeight / 2],
  ['pmiddletilde', 0x1d71, 'p', () => 0, (g) => g.xHeight / 2],
  ['rmiddletilde', 0x1d72, 'r', () => 0, (g) => g.xHeight / 2],
  ['rfishhookmiddletilde', 0x1d73, 'rfishhook', () => 0, (g) => g.xHeight / 2],
  ['smiddletilde', 0x1d74, 's', (g) => g.wide(7) / 2, (g) => g.xHeight / 2],
  ['tmiddletilde', 0x1d75, 't', () => 0, (g) => g.xHeight / 2],
  ['zmiddletilde', 0x1d76, 'z', (g) => g.wide(7.5) / 2, (g) => g.xHeight / 2],
];

const LIGHTER = 0.75;

/** Chao tone letters ˥ to ˩: a stem the cap height tall on the right, its tick at one of five levels. */
const toneBar = (name: string, unicode: number, level: number): GlyphDef => ({
  name,
  unicode,
  lsb: 1,
  rsb: 1,
  draw: (g) => {
    const w = 3.5;
    const y = g.bottom(0) + ((g.top(g.cap) - g.bottom(0)) * level) / 4;
    return [stem(w, 0, g.cap), bar(0, w, y)];
  },
});

/** ː ˑ: triangles pointing at each other, the upper alone for the half-long mark. */
const triangle = (g: DrawContext, y: number, down: boolean): Stroke => {
  const a = 1 + g.v / 2;
  return solid(down ? [p(-a, y + a), p(a, y + a), p(0, y)] : [p(-a, y - a), p(a, y - a), p(0, y)], 0.001);
};

const IPA_SIGNS: GlyphDef[] = [
  superiorOf(letter('h'), 'hmod', 0x2b0),
  superiorOf(letter('j'), 'jmod', 0x2b2),
  superiorOf(letter('l'), 'lmod', 0x2e1),
  superiorOf(letter('g'), 'gmod', 0x1d4d, true, LIGHTER),
  superiorOf({ ...GREEK.find((d) => d.name === 'gamma')!, lower: true }, 'gammamod', 0x2e0, true, LIGHTER),
  toneBar('extrahightonebarmod', 0x2e5, 4),
  toneBar('hightonebarmod', 0x2e6, 3),
  toneBar('midtonebarmod', 0x2e7, 2),
  toneBar('lowtonebarmod', 0x2e8, 1),
  toneBar('extralowtonebarmod', 0x2e9, 0),
  { name: 'colontriangularmod', unicode: 0x2d0, lsb: 1, rsb: 1, draw: (g) => [triangle(g, g.y(5.5), true), triangle(g, g.y(4.5), false)] },
  { name: 'colontriangularhalfmod', unicode: 0x2d1, lsb: 1, rsb: 1, draw: (g) => [triangle(g, g.y(5.5), true)] },
  { name: 'rhotichookmod', unicode: 0x2de, lsb: 0.5, rsb: 1, draw: (g) => [open(p(0, g.y(6.5)), p(2.5 + g.v / 2, g.y(6.5), true), p(2.5 + g.v / 2, g.y(9.5)))] },
  { name: 'ringlowmod', unicode: 0x2f3, lsb: 1, rsb: 1, draw: (g) => [ring(g, 0, -4, 1.6)] },
  {
    // ‿ the tie under two letters: a shallow bracket below the baseline, its corners cut where it would curve.
    name: 'undertie',
    unicode: 0x203f,
    lsb: 0,
    rsb: 0,
    draw: (g) => {
      const b = g.bottom(-3.5);
      return [open(p(0, 0), p(0, b, true), p(8, b, true), p(8, 0))];
    },
  },
  { name: 'arrowupraisedmod', unicode: 0xa71b, lsb: 1, rsb: 1, draw: (g) => [stem(0, g.cap - 5, g.cap - 1), open(p(-1.75, g.cap - 1.75), p(0, g.cap), p(1.75, g.cap - 1.75))] },
  { name: 'arrowdownraisedmod', unicode: 0xa71c, lsb: 1, rsb: 1, draw: (g) => [stem(0, g.cap - 4, g.cap), open(p(-1.75, g.cap - 3.25), p(0, g.cap - 5), p(1.75, g.cap - 3.25))] },
];

export const IPA: GlyphDef[] = [
  ...IPA_DEFS.map((d) => ({ ...d, lower: true })),
  ...MIDDLE_TILDE.map(([name, unicode, base, x, y]): GlyphDef => {
    const def = IPA_DEFS.find((d) => d.name === base) ?? latin(base);
    return { ...def, name, unicode, lower: true, draw: (g) => [...def.draw(g), tildeAcross(g, x(g), y(g))] };
  }),
  ...IPA_SIGNS,
];

/** IPA letters that are small capitals, or a letter of another script, under their own code points. */
export const IPA_ALIASES: PlacedDef[] = (
  [
    ['Gsmall', 0x262, 'g.sc'],
    ['Rsmall', 0x280, 'r.sc'],
    ['Ysmall', 0x28f, 'y.sc'],
    ['Bsmall', 0x299, 'b.sc'],
    ['Hsmall', 0x29c, 'h.sc'],
    ['Lsmall', 0x29f, 'l.sc'],
    ['Nsmall', 0x274, 'n.sc'],
    ['OEsmall', 0x276, 'oe.sc'],
    ['philatin', 0x278, 'phi'],
    ['Dsmall', 0x1d05, 'd.sc'],
  ] as const
).map(([name, unicode, glyph]) => ({ name, unicode, parts: [{ glyph, after: true }] }));
