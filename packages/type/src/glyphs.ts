import type { GlyphDef, SpaceDef } from './draw';
import { DRAWN_SIGNS, FIGURES, LOWER, NOTDEF, ON_LETTERS, PUNCTUATION, TRADEMARK, UPPER } from './glyphs-core';
import { CYRILLIC, CYRILLIC_LOCL } from './glyphs-cyrillic';
import { figureVariants } from './glyphs-figures';
import { GREEK } from './glyphs-greek';
import { LATIN_EXTRA } from './glyphs-latin';
import { LATIN1 } from './glyphs-latin1';
import { PLUS } from './glyphs-plus';
import { SYMBOLS } from './glyphs-symbols';

export const GLYPHS: GlyphDef[] = [
  NOTDEF,
  ...UPPER,
  ...LOWER,
  ...FIGURES,
  ...figureVariants(FIGURES),
  ...PUNCTUATION,
  TRADEMARK,
  ...ON_LETTERS,
  ...DRAWN_SIGNS,
  ...PLUS,
  ...SYMBOLS,
  ...LATIN_EXTRA,
  ...LATIN1,
  ...CYRILLIC,
  ...CYRILLIC_LOCL,
  ...GREEK,
];

export const SPACES: SpaceDef[] = [
  { name: 'space', unicode: 0x20, advance: 5 },
  { name: 'uni00A0', unicode: 0xa0, advance: 5 },
];
