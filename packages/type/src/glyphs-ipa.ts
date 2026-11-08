/**
 * The IPA letters GF Phonetics IPA Standard adds to GF Latin African (3.1): turned, reversed and hooked forms of letters
 * the font already draws, each built from that letter so it is spaced and joined as the letter is.
 */
import type { PlacedDef } from './composites';
import { ALL, bar, box, type DrawContext, type GlyphDef, mirror, OVERHANG, open, p, rotate180, stem, withPen } from './draw';
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

export const IPA: GlyphDef[] = IPA_DEFS.map((d) => ({ ...d, lower: true }));

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
  ] as const
).map(([name, unicode, glyph]) => ({ name, unicode, parts: [{ glyph, after: true }] }));
