import { AFRICAN_ALIASES } from './glyphs-african';
import { CYRILLIC_ALIASES } from './glyphs-cyrillic';
import { GREEK_ALIASES, GREEK_TONOS, GREEK_TONOS_CAPS } from './glyphs-greek';
import { VIETNAMESE_PAIRS } from './marks';
import { FRACTIONS } from './glyphs-figures';

/** A precomposed letter: a base and the marks stacked on it, each attaching to the anchor its mark names. */
export interface AccentedDef {
  name: string;
  unicode?: number;
  base: string;
  marks: string[];
}

/** A glyph made of other glyphs set side by side or offset, in grid units (Ĳ, ŀ, ŉ, the spacing accents). */
export interface PlacedDef {
  name: string;
  unicode: number;
  parts: { glyph: string; dx?: number; dy?: number; after?: boolean }[];
  /** Advance in grid units; when absent, the sum of the parts set `after` one another. */
  advance?: number;
}

const MARK_SUFFIX: Record<number, { mark: string; suffix: string }> = {
  0x300: { mark: 'gravecomb', suffix: 'grave' },
  0x301: { mark: 'acutecomb', suffix: 'acute' },
  0x302: { mark: 'circumflexcomb', suffix: 'circumflex' },
  0x303: { mark: 'tildecomb', suffix: 'tilde' },
  0x304: { mark: 'macroncomb', suffix: 'macron' },
  0x306: { mark: 'brevecomb', suffix: 'breve' },
  0x307: { mark: 'dotaccentcomb', suffix: 'dotaccent' },
  0x308: { mark: 'dieresiscomb', suffix: 'dieresis' },
  0x309: { mark: 'hookabovecomb', suffix: 'hookabove' },
  0x30a: { mark: 'ringcomb', suffix: 'ring' },
  0x30b: { mark: 'hungarumlautcomb', suffix: 'hungarumlaut' },
  0x30c: { mark: 'caroncomb', suffix: 'caron' },
  0x30d: { mark: 'verticallineabovecomb', suffix: 'verticallineabove' },
  0x30f: { mark: 'dblgravecomb', suffix: 'dblgrave' },
  0x311: { mark: 'breveinvertedcomb', suffix: 'breveinverted' },
  0x323: { mark: 'dotbelowcomb', suffix: 'dotbelow' },
  0x326: { mark: 'commaaccentcomb', suffix: 'commaaccent' },
  0x327: { mark: 'cedillacomb', suffix: 'cedilla' },
  0x328: { mark: 'ogonekcomb', suffix: 'ogonek' },
  0x31b: { mark: 'horncomb', suffix: 'horn' },
  0x324: { mark: 'dieresisbelowcomb', suffix: 'dieresisbelow' },
  0x325: { mark: 'ringbelowcomb', suffix: 'ringbelow' },
  0x32d: { mark: 'circumflexbelowcomb', suffix: 'circumflexbelow' },
  0x32e: { mark: 'brevebelowcomb', suffix: 'brevebelow' },
  0x330: { mark: 'tildebelowcomb', suffix: 'tildebelow' },
  0x331: { mark: 'macronbelowcomb', suffix: 'macronbelow' },
  0x329: { mark: 'verticallinebelowcomb', suffix: 'verticallinebelow' },
};

/** Marks that attach below the base, so they leave i and j their dots. */
const BELOW = /^(dotbelow|commaaccent|cedilla|ogonek|\w+belowcomb)/;

/** Latvian writes a comma below where Unicode decomposes to a cedilla, and ģ turns it above. */
const LATVIAN_COMMA = new Set([0x122, 0x136, 0x137, 0x13b, 0x13c, 0x145, 0x146, 0x156, 0x157]);
const COMMA_ABOVE = 0x123;
/** ď ľ Ľ ť take the caron as a vertical stroke beside a tall stem. */
const VERTICAL_CARON = new Set([0x10f, 0x13d, 0x13e, 0x165]);

/** Letters that lose their dot under a mark above, Ukrainian і and Serbian ј included. */
const DOTLESS: Record<string, string> = { i: 'dotlessi', j: 'dotlessj', 'i-cy': 'dotlessi', 'je-cy': 'dotlessj' };

/** Ά Έ Ή Ί Ό Ύ Ώ set their tonos before the capital, so they are placed, not stacked. */
const TONOS_BESIDE = new Set(GREEK_TONOS_CAPS.map(([, unicode]) => unicode));

const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();

/**
 * Precomposed letters in the given ranges, from Unicode's own decompositions, so every one of
 * them is a base glyph plus mark glyphs. Code points with no decomposition, or whose base is not
 * drawn yet, are left to be drawn and reported by the coverage test.
 */
export function accentedFromUnicode(ranges: [number, number][], names: Map<number, string>, caseMarks: Set<string>): AccentedDef[] {
  const out: AccentedDef[] = [];
  for (const [from, to] of ranges)
    for (let cp = from; cp <= to; cp++) {
      if (names.has(cp) || TONOS_BESIDE.has(cp)) continue;
      const [baseChar, ...markChars] = [...String.fromCodePoint(cp).normalize('NFD')];
      if (!baseChar || markChars.length === 0) continue;
      const baseCp = baseChar.codePointAt(0)!;
      const baseName = names.get(baseCp);
      if (!baseName) continue;
      const upper = isUpper(baseChar);
      let suffix = '';
      const marks: string[] = [];
      let top = false;
      for (const m of markChars) {
        const mcp = m.codePointAt(0)!;
        const known = MARK_SUFFIX[mcp];
        if (!known) {
          marks.length = 0;
          break;
        }
        let mark = known.mark;
        let name = known.suffix;
        if (mcp === 0x327 && LATVIAN_COMMA.has(cp)) {
          mark = 'commaaccentcomb';
          name = 'commaaccent';
        }
        if (mcp === 0x327 && cp === COMMA_ABOVE) {
          mark = 'commaturnedabovecomb';
          name = 'commaaccent';
        }
        if (mcp === 0x30c && VERTICAL_CARON.has(cp)) mark = 'caronvertcomb';
        if (upper && caseMarks.has(mark)) mark = `${mark}.case`;
        if (!BELOW.test(mark)) top = true;
        marks.push(mark);
        suffix += name;
      }
      if (marks.length === 0) continue;
      for (const [first, second] of VIETNAMESE_PAIRS) {
        const plain = (m: string) => m.replace(/\.case$/, '');
        const i = marks.findIndex((m, k) => plain(m) === first && plain(marks[k + 1] ?? '') === second);
        if (i >= 0) marks.splice(i, 2, `${first}_${second}${marks[i]!.endsWith('.case') ? '.case' : ''}`);
      }
      const base = (top && DOTLESS[baseName]) || baseName;
      out.push({ name: baseName.replace(/(-cy)?$/, `${suffix}$1`), unicode: cp, base, marks });
    }
  return out;
}

/** Glyphs made of glyphs placed by hand: the Dutch IJ, the Catalan middle dot, ŉ, Đ, the spacing accents. */
export const PLACED: PlacedDef[] = [
  { name: 'IJ', unicode: 0x132, parts: [{ glyph: 'I', after: true }, { glyph: 'J', after: true }] },
  { name: 'ij', unicode: 0x133, parts: [{ glyph: 'i', after: true }, { glyph: 'j', after: true, dx: -0.75 }] },
  { name: 'napostrophe', unicode: 0x149, parts: [{ glyph: 'quoteright', after: true, dx: -0.5 }, { glyph: 'n', after: true, dx: -0.5 }] },
  { name: 'Ldot', unicode: 0x13f, parts: [{ glyph: 'L' }, { glyph: 'periodcentered', dx: 5, dy: 2 }] },
  { name: 'ldot', unicode: 0x140, parts: [{ glyph: 'l', after: true }, { glyph: 'periodcentered', after: true, dx: -0.5, dy: 2 }] },
  { name: 'Dcroat', unicode: 0x110, parts: [{ glyph: 'Eth', after: true }] },
  { name: 'apostrophemod', unicode: 0x2bc, parts: [{ glyph: 'quoteright', after: true }] },
  { name: 'rupee', unicode: 0x20a8, parts: [{ glyph: 'R', after: true }, { glyph: 's', after: true, dx: -0.5 }] },
  { name: 'uni00AD', unicode: 0xad, parts: [{ glyph: 'hyphen', after: true }] },
  ...(
    [
      ['DZcaron', 0x1c4, 'D', 'Zcaron'],
      ['Dzcaron', 0x1c5, 'D', 'zcaron'],
      ['dzcaron', 0x1c6, 'd', 'zcaron'],
      ['LJ', 0x1c7, 'L', 'J'],
      ['Lj', 0x1c8, 'L', 'j'],
      ['lj', 0x1c9, 'l', 'j'],
      ['NJ', 0x1ca, 'N', 'J'],
      ['Nj', 0x1cb, 'N', 'j'],
      ['nj', 0x1cc, 'n', 'j'],
      ['DZ', 0x1f1, 'D', 'Z'],
      ['Dz', 0x1f2, 'D', 'z'],
      ['dz', 0x1f3, 'd', 'z'],
    ] as const
  ).map(([name, unicode, a, b]) => ({ name, unicode, parts: [{ glyph: a, after: true }, { glyph: b, after: true }] })),
  ...FRACTIONS.map(([name, unicode, numerator, denominator]) => ({
    name,
    unicode,
    parts: [{ glyph: `${numerator}superior`, after: true }, { glyph: 'fraction', after: true }, { glyph: `${denominator}.dnom`, after: true }],
  })),
];

/** Spacing accents: the combining mark, centred on a five-unit advance over the x-height. */
export const SPACING_ACCENTS: { name: string; unicode: number; mark: string; below?: boolean }[] = [
  { name: 'grave', unicode: 0x60, mark: 'gravecomb' },
  { name: 'acute', unicode: 0xb4, mark: 'acutecomb' },
  { name: 'dieresis', unicode: 0xa8, mark: 'dieresiscomb' },
  { name: 'macron', unicode: 0xaf, mark: 'macroncomb' },
  { name: 'cedilla', unicode: 0xb8, mark: 'cedillacomb', below: true },
  { name: 'circumflex', unicode: 0x2c6, mark: 'circumflexcomb' },
  { name: 'caron', unicode: 0x2c7, mark: 'caroncomb' },
  { name: 'breve', unicode: 0x2d8, mark: 'brevecomb' },
  { name: 'dotaccent', unicode: 0x2d9, mark: 'dotaccentcomb' },
  { name: 'ring', unicode: 0x2da, mark: 'ringcomb' },
  { name: 'ogonek', unicode: 0x2db, mark: 'ogonekcomb', below: true },
  { name: 'tilde', unicode: 0x2dc, mark: 'tildecomb' },
  { name: 'hungarumlaut', unicode: 0x2dd, mark: 'hungarumlautcomb' },
];

/** Glyphs that are another glyph under a second code point (Cyrillic and Greek letters shared with Latin), placed before the accented letters that use them. */
export const ALIASES: PlacedDef[] = [...CYRILLIC_ALIASES, ...GREEK_ALIASES, ...AFRICAN_ALIASES];

export { GREEK_TONOS };

export const LATIN_RANGES: [number, number][] = [
  [0xc0, 0xff],
  [0x100, 0x17f],
  [0x180, 0x24f],
  [0x370, 0x3ff],
  [0x400, 0x4ff],
  [0x1e00, 0x1eff],
  [0x2c60, 0x2c7f],
  [0xa720, 0xa7ff],
  [0xab30, 0xab6f],
];
