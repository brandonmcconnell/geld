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

export function smallCaps(defs: GlyphDef[]): GlyphDef[] {
  const find = (name: string) => defs.find((d) => d.name === name);
  const letters = LETTERS.flatMap(([lower, unicode, upper]): GlyphDef[] => {
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

/** Small capitals built from parts: ĳ, and the Turkish dotted i that `smcp` gives Turkish and Azeri text. */
export const SMALL_CAP_PLACED: PlacedDef[] = [{ name: 'ij.sc', parts: [{ glyph: 'i.sc', after: true }, { glyph: 'j.sc', after: true }] }];
export const SMALL_CAP_EXTRA_ACCENTED: AccentedDef[] = [{ name: 'idotaccent.sc', base: 'i.sc', marks: ['dotaccentcomb'] }];
