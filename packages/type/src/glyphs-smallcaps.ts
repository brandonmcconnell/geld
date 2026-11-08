import type { AccentedDef, PlacedDef } from './composites';
import { type GlyphDef, inPen, SMALL_CAP_BREADTH } from './draw';

/**
 * Small capitals (D14): every lowercase letter of GF Latin Core as its capital drawn on the
 * x-height (`smallcap`: 0.82 of the capital's width, the lowercase pen), named `<lowercase>.sc`
 * and spaced and anchored as the lowercase letter. Accented ones are the base's small capital
 * with the lowercase marks; figures and & ! ¡ follow for `c2sc`.
 */

const LETTERS: [string, number, string][] = [
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c): [string, number, string] => [c, c.codePointAt(0)!, c.toUpperCase()]),
  ['ae', 0xe6, 'AE'],
  ['oe', 0x153, 'OE'],
  ['oslash', 0xf8, 'Oslash'],
  ['eth', 0xf0, 'Eth'],
  ['dcroat', 0x111, 'Eth'],
  ['thorn', 0xfe, 'Thorn'],
  ['hbar', 0x127, 'Hbar'],
  ['lslash', 0x142, 'Lslash'],
  ['eng', 0x14b, 'Eng'],
  ['tbar', 0x167, 'Tbar'],
  ['germandbls', 0xdf, 'Germandbls'],
  ['kgreenlandic', 0x138, 'K'],
  ['dotlessi', 0x131, 'I'],
  ['schwa', 0x259, 'Schwa'],
  ['saltillo', 0xa78c, 'Saltillo'],
];

/** ? and ¿ are left out: on the x-height at Black their bowl, gap and dot need more than its 10 units. */
const SIGNS = ['ampersand', 'exclam', 'exclamdown'];
const FIGURES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** Figures on the x-height lighten past SemiBold so 5 6 9 keep their counters, as the small figures do. */
const lighter =
  (draw: GlyphDef['draw']): GlyphDef['draw'] =>
  (g) => {
    const light = g.sub(g.cap, 1 - Math.max(0, g.v - 2) * 0.1, true, SMALL_CAP_BREADTH);
    return inPen(light, draw(light));
  };

/** Latin's lowercase beyond the list: IPA, African and Extended-B letters whose capital is drawn too (ɛ ɔ ɲ ɓ ꞌ), for languages that use them. */
const LATIN_LOWER = /^[\u0180-\u02af\u1d00-\u1dbf\u1e00-\u1eff\u2c60-\u2c7f\ua720-\ua7ff\uab30-\uab6f]$/u;
/** Capitals whose bars and counters do not fit the x-height at heavy weights (Ʊ's counter, the bars of Ƀ Ǥ Ꝉ Ɍ Ᵽ). */
const NO_SMALL_CAP = new Set(['upsilon-latin', 'btopbar', 'gstroke', 'lmiddletilde', 'rstroke', 'pstroke']);
function moreLetters(defs: GlyphDef[]): [string, number, string][] {
  const listed = new Set([...LETTERS.map(([lower]) => lower), ...NO_SMALL_CAP]);
  const byUnicode = new Map(defs.flatMap((d) => (d.unicode === undefined ? [] : [[d.unicode, d.name] as const])));
  return defs.flatMap((d): [string, number, string][] => {
    if (d.unicode === undefined || listed.has(d.name)) return [];
    const char = String.fromCodePoint(d.unicode);
    const upper = char.toUpperCase();
    if (!LATIN_LOWER.test(char) || !/\p{Ll}/u.test(char) || [...upper].length !== 1 || upper === char) return [];
    const capital = byUnicode.get(upper.codePointAt(0)!);
    return capital ? [[d.name, d.unicode, capital]] : [];
  });
}

export function smallCaps(defs: GlyphDef[]): GlyphDef[] {
  const find = (name: string) => defs.find((d) => d.name === name);
  const letters = [...LETTERS, ...moreLetters(defs)].flatMap(([lower, unicode, upper]): GlyphDef[] => {
    const def = find(upper);
    return def ? [{ name: `${lower}.sc`, stands: unicode, smallcap: true, lsb: def.lsb, rsb: def.rsb, draw: def.draw }] : [];
  });
  const others = [...FIGURES, ...SIGNS].flatMap((name): GlyphDef[] => {
    const def = find(name);
    if (!def) return [];
    const figure = FIGURES.includes(name);
    return [{ name: `${name}.sc`, ...(def.unicode === undefined ? {} : { stands: def.unicode }), smallcap: true, lsb: def.lsb, rsb: def.rsb, draw: figure ? lighter(def.draw) : def.draw }];
  });
  return [...letters, ...others];
}

/** The small capital a lowercase base takes: dotless i and j are i and j. */
export const smallCapBase = (base: string) => (base === 'dotlessj' ? 'j.sc' : base === 'dotlessi' ? 'i.sc' : `${base}.sc`);

/** Accented small capitals: each accented lowercase letter's base small capital with the same marks. */
export function accentedSmallCaps(accented: AccentedDef[], has: (name: string) => boolean): AccentedDef[] {
  return accented.flatMap((def) => {
    if (def.unicode === undefined || !/\p{Ll}/u.test(String.fromCodePoint(def.unicode))) return [];
    const base = smallCapBase(def.base);
    return has(base) && !def.marks.some((m) => m.endsWith('.case')) ? [{ name: `${def.name}.sc`, base, marks: def.marks }] : [];
  });
}

/** Small capitals built from parts: ĳ, ŀ and ſ, and the Turkish dotted i that `smcp` gives Turkish and Azeri text. */
export const SMALL_CAP_PLACED: PlacedDef[] = [
  { name: 'ij.sc', parts: [{ glyph: 'i.sc', after: true }, { glyph: 'j.sc', after: true }] },
  // Catalan ŀ is Ŀ small: the middle dot inside the small L, as Ŀ has it (5 units in) at the small capital's breadth.
  { name: 'ldot.sc', parts: [{ glyph: 'l.sc' }, { glyph: 'periodcentered', dx: 5 * SMALL_CAP_BREADTH }] },
  // The long s is an s, and its small capital is s's.
  { name: 'longs.sc', parts: [{ glyph: 's.sc', after: true }] },
];
export const SMALL_CAP_EXTRA_ACCENTED: AccentedDef[] = [{ name: 'idotaccent.sc', base: 'i.sc', marks: ['dotaccentcomb'] }];
