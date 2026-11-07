import { alternateDefs, swashDefs } from './alternates';
import type { GlyphDef, SpaceDef } from './draw';
import { AFRICAN } from './glyphs-african';
import { BOX_DRAWING, DINGBATS, ORNAMENTS } from './glyphs-dingbats';
import { DRAWN_SIGNS, FIGURES, LOWER, NOTDEF, ON_LETTERS, PUNCTUATION, SERVICEMARK, TRADEMARK, UPPER } from './glyphs-core';
import { CYRILLIC, CYRILLIC_LOCL } from './glyphs-cyrillic';
import { figureSets, figureVariants, signScripts, tabularSigns } from './glyphs-figures';
import { GREEK } from './glyphs-greek';
import { smallCaps } from './glyphs-smallcaps';
import { LATIN_EXTRA } from './glyphs-latin';
import { LATIN1 } from './glyphs-latin1';
import { MORE } from './glyphs-more';
import { PLUS } from './glyphs-plus';
import { SYMBOLS } from './glyphs-symbols';

const DRAWN: GlyphDef[] = [
  NOTDEF,
  ...UPPER,
  ...LOWER,
  ...FIGURES,
  ...figureVariants(FIGURES),
  ...PUNCTUATION,
  TRADEMARK,
  SERVICEMARK,
  ...ON_LETTERS,
  ...DRAWN_SIGNS,
  ...PLUS,
  ...SYMBOLS,
  ...MORE,
  ...LATIN_EXTRA,
  ...LATIN1,
  ...AFRICAN,
  ...CYRILLIC,
  ...CYRILLIC_LOCL,
  ...GREEK,
  ...DINGBATS,
  ...BOX_DRAWING,
  ...ORNAMENTS,
];

export const GLYPHS: GlyphDef[] = [...DRAWN, ...alternateDefs(DRAWN), ...swashDefs(DRAWN), ...figureSets(FIGURES), ...tabularSigns(DRAWN), ...signScripts(DRAWN), ...smallCaps(DRAWN)];

/** Spaces, in grid units of a 20-unit em: the quads and fixed spaces as Unicode defines them, the figure space as wide as a tabular figure, the punctuation space as a period. */
export const SPACES: SpaceDef[] = [
  { name: 'space', unicode: 0x20, advance: 5 },
  { name: 'uni00A0', unicode: 0xa0, advance: 5 },
  { name: 'enquad', unicode: 0x2000, advance: 10 },
  { name: 'emquad', unicode: 0x2001, advance: 20 },
  { name: 'enspace', unicode: 0x2002, advance: 10 },
  { name: 'emspace', unicode: 0x2003, advance: 20 },
  { name: 'threeperemspace', unicode: 0x2004, advance: 20 / 3 },
  { name: 'fourperemspace', unicode: 0x2005, advance: 5 },
  { name: 'sixperemspace', unicode: 0x2006, advance: 20 / 6 },
  { name: 'figurespace', unicode: 0x2007, advance: 'tabular' },
  { name: 'punctuationspace', unicode: 0x2008, advance: { like: 'period' } },
  { name: 'thinspace', unicode: 0x2009, advance: 4 },
  { name: 'hairspace', unicode: 0x200a, advance: 2 },
  { name: 'uni202F', unicode: 0x202f, advance: 4 },
  { name: 'uni205F', unicode: 0x205f, advance: 20 * (4 / 18) },
  { name: 'uni200B', unicode: 0x200b, advance: 0 },
  { name: 'uni200C', unicode: 0x200c, advance: 0 },
  { name: 'uni200D', unicode: 0x200d, advance: 0 },
  { name: 'uni2060', unicode: 0x2060, advance: 0 },
  { name: 'uniFEFF', unicode: 0xfeff, advance: 0 },
];
