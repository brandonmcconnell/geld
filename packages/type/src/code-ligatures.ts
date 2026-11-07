/**
 * Code ligatures (5.3, D12, D13), off by default in Geld Sans: in `dlig`, and each group in its own stylistic set.
 * Each character keeps a glyph of its own, so the caret, selection and deletion stay per character: every character
 * but the last becomes a blank spacer, and the last draws the whole shape back over them. The shape is an existing
 * glyph (≤ for <=) or the characters' own glyphs set tighter (:: &&), as components, so Geld Dark Sans and the italic
 * follow; together the pieces are narrower than the characters set apart, as the arrows are.
 */

export type CodeGroup = 'arrows' | 'comparison' | 'logic' | 'comments' | 'scope' | 'shifts' | 'prose' | 'symbols';

/**
 * Each group's stylistic set and the name an app shows for it, whether dlig takes it, and what it may not touch:
 * code sequences no other operator character, dashes no further hyphen, symbol forms no letter or figure (f(c), a[x]).
 */
export const CODE_GROUPS: Record<CodeGroup, { feature?: string; label?: string; dlig: boolean; apart: 'operators' | 'hyphens' | 'words' }> = {
  arrows: { feature: 'ss11', label: 'Squiggle arrows', dlig: true, apart: 'operators' },
  comparison: { feature: 'ss12', label: 'Comparison and equality ligatures', dlig: true, apart: 'operators' },
  logic: { feature: 'ss13', label: 'Logic, pipe and increment ligatures', dlig: true, apart: 'operators' },
  comments: { feature: 'ss14', label: 'Comment, markup and hash ligatures', dlig: true, apart: 'operators' },
  scope: { feature: 'ss15', label: 'Scope and range ligatures', dlig: true, apart: 'operators' },
  shifts: { feature: 'ss16', label: 'Shift and bind ligatures', dlig: true, apart: 'operators' },
  prose: { feature: 'ss10', label: 'Dashes from hyphens', dlig: false, apart: 'hyphens' },
  symbols: { dlig: true, apart: 'words' },
};

export interface CodePart {
  glyph: string;
  /** Moved up so the glyph's ink is centred on the math axis (the colons of :: and :=). */
  centre?: boolean;
}

export interface CodeLigature {
  text: string;
  group: CodeGroup;
  /** One glyph that draws the whole sequence; otherwise the characters' own glyphs. */
  whole?: string;
  parts?: CodePart[];
  /** The white between two parts' ink, in grid units; below zero they overlap and join (== into one long =). */
  joint?: number;
  /** Taken wherever it is typed, whatever stands beside it: (TM) after a name, where (c) beside a word is code. */
  free?: boolean;
}

const c = (glyph: string, centre = false): CodePart => (centre ? { glyph, centre } : { glyph });

/** Longest first within a group, since a group's rules are tried in order and the first that fits wins. */
export const CODE_LIGATURES: CodeLigature[] = [
  // Squiggle arrows: ~~> is ⇝ itself, ~> its one-wave form.
  { text: '~~>', group: 'arrows', whole: 'rightsquigglearrow' },
  { text: '<~~', group: 'arrows', whole: 'leftsquigglearrow' },
  { text: '~>', group: 'arrows', whole: 'rightsquigglearrow.short' },
  { text: '<~', group: 'arrows', whole: 'leftsquigglearrow.short' },

  { text: '!==', group: 'comparison', parts: [c('equal'), c('notequal'), c('equal')], joint: -0.75 },
  { text: '=/=', group: 'comparison', parts: [c('equal'), c('notequal'), c('equal')], joint: -0.75 },
  { text: '===', group: 'comparison', parts: [c('equal'), c('equal'), c('equal')], joint: -0.75 },
  { text: '<=>', group: 'comparison', parts: [c('less'), c('equal'), c('greater')], joint: 0.35 },
  { text: '<=', group: 'comparison', whole: 'lessequal' },
  { text: '>=', group: 'comparison', whole: 'greaterequal' },
  { text: '!=', group: 'comparison', whole: 'notequal' },
  { text: '/=', group: 'comparison', whole: 'notequal' },
  { text: '==', group: 'comparison', parts: [c('equal'), c('equal')], joint: -0.75 },
  { text: '=~', group: 'comparison', parts: [c('equal'), c('asciitilde')], joint: 0.5 },
  { text: '!~', group: 'comparison', parts: [c('exclam'), c('asciitilde')], joint: 0.5 },

  { text: '||>', group: 'logic', parts: [c('bar'), c('pipe.right')], joint: 0.6 },
  { text: '<||', group: 'logic', parts: [c('pipe.left'), c('bar')], joint: 0.6 },
  { text: '|>', group: 'logic', whole: 'pipe.right' },
  { text: '<|', group: 'logic', whole: 'pipe.left' },
  { text: '+++', group: 'logic', parts: [c('plus'), c('plus'), c('plus')], joint: 0.4 },
  { text: '&&', group: 'logic', parts: [c('ampersand'), c('ampersand')], joint: 0.4 },
  { text: '||', group: 'logic', parts: [c('bar'), c('bar')], joint: 0.8 },
  { text: '!!', group: 'logic', parts: [c('exclam'), c('exclam')], joint: 0.6 },
  { text: '??', group: 'logic', parts: [c('question'), c('question')], joint: 0.5 },
  { text: '?.', group: 'logic', parts: [c('question'), c('period')], joint: 0.4 },
  { text: '?:', group: 'logic', parts: [c('question'), c('colon')], joint: 0.4 },
  { text: '++', group: 'logic', parts: [c('plus'), c('plus')], joint: 0.4 },
  { text: '--', group: 'logic', parts: [c('minus'), c('minus')], joint: -0.75 },

  { text: '<!--', group: 'comments', parts: [c('less'), c('exclam'), c('hyphen'), c('hyphen')], joint: 0.4 },
  { text: '</>', group: 'comments', parts: [c('less'), c('slash'), c('greater')], joint: 0.2 },
  { text: '///', group: 'comments', parts: [c('slash'), c('slash'), c('slash')], joint: -0.5 },
  { text: '/**', group: 'comments', parts: [c('slash'), c('asterisk'), c('asterisk')], joint: 0.3 },
  { text: '</', group: 'comments', parts: [c('less'), c('slash')], joint: 0.2 },
  { text: '/>', group: 'comments', parts: [c('slash'), c('greater')], joint: 0.2 },
  { text: '//', group: 'comments', parts: [c('slash'), c('slash')], joint: -0.5 },
  { text: '/*', group: 'comments', parts: [c('slash'), c('asterisk')], joint: 0.3 },
  { text: '*/', group: 'comments', parts: [c('asterisk'), c('slash')], joint: 0.3 },
  { text: '#!', group: 'comments', parts: [c('numbersign'), c('exclam')], joint: 0.4 },
  { text: '#{', group: 'comments', parts: [c('numbersign'), c('braceleft')], joint: 0.4 },
  { text: '#[', group: 'comments', parts: [c('numbersign'), c('bracketleft')], joint: 0.4 },
  { text: '#(', group: 'comments', parts: [c('numbersign'), c('parenleft')], joint: 0.4 },
  { text: '#?', group: 'comments', parts: [c('numbersign'), c('question')], joint: 0.4 },
  { text: '#_', group: 'comments', parts: [c('numbersign'), c('underscore')], joint: 0.4 },

  { text: '::=', group: 'scope', parts: [c('colon', true), c('colon', true), c('equal')], joint: 0.4 },
  { text: ':::', group: 'scope', parts: [c('colon', true), c('colon', true), c('colon', true)], joint: 0.5 },
  { text: '..<', group: 'scope', parts: [c('period'), c('period'), c('less')], joint: 0.4 },
  { text: '..=', group: 'scope', parts: [c('period'), c('period'), c('equal')], joint: 0.4 },
  { text: '...', group: 'scope', parts: [c('period'), c('period'), c('period')], joint: 0.5 },
  { text: '::', group: 'scope', parts: [c('colon', true), c('colon', true)], joint: 0.5 },
  { text: ':=', group: 'scope', parts: [c('colon', true), c('equal')], joint: 0.4 },
  { text: '=:', group: 'scope', parts: [c('equal'), c('colon', true)], joint: 0.4 },
  { text: '..', group: 'scope', parts: [c('period'), c('period')], joint: 0.5 },

  { text: '<<<', group: 'shifts', parts: [c('less'), c('less'), c('less')], joint: -1.5 },
  { text: '>>>', group: 'shifts', parts: [c('greater'), c('greater'), c('greater')], joint: -1.5 },
  { text: '>>=', group: 'shifts', parts: [c('greater'), c('greater'), c('equal')], joint: -1.5 },
  { text: '=<<', group: 'shifts', parts: [c('equal'), c('less'), c('less')], joint: -1.5 },
  { text: '<<=', group: 'shifts', parts: [c('less'), c('less'), c('equal')], joint: -1.5 },
  { text: '<<', group: 'shifts', parts: [c('less'), c('less')], joint: -1.5 },
  { text: '>>', group: 'shifts', parts: [c('greater'), c('greater')], joint: -1.5 },

  // Prose (ss10): -- and --- as the dashes they stand for.
  { text: '---', group: 'prose', whole: 'emdash' },
  { text: '--', group: 'prose', whole: 'endash' },

  // Symbol forms (dlig); an x between figures becomes × as well (ufo.ts).
  { text: '(tm)', group: 'symbols', whole: 'trademark' },
  { text: '(TM)', group: 'symbols', free: true, whole: 'trademark' },
  { text: '(c)', group: 'symbols', whole: 'copyright' },
  { text: '(C)', group: 'symbols', free: true, whole: 'copyright' },
  { text: '(r)', group: 'symbols', whole: 'registered' },
  { text: '(R)', group: 'symbols', free: true, whole: 'registered' },
  { text: '[ ]', group: 'symbols', whole: 'ballotbox' },
  { text: '[x]', group: 'symbols', whole: 'ballotboxcheck' },
  { text: '[X]', group: 'symbols', whole: 'ballotboxcheck' },
];

/** The characters a code ligature may not touch on either side, so a sequence only stands whole (a::::b, http://). */
export const CODE_OPERATORS = '<>=!/|&:.-+*~?#';

const SHORT: Record<string, string> = {
  '<': 'lt', '>': 'gt', '=': 'eq', '!': 'ex', '/': 'sl', '|': 'br', '&': 'am', '?': 'qu', '.': 'dt', ':': 'co',
  '*': 'as', '#': 'ns', '-': 'hy', '+': 'pl', '~': 'ti', '_': 'us', '{': 'cb', '[': 'sb', '(': 'pa',
  ')': 'pr', ']': 'sr', ' ': 'sp', c: 'c', C: 'C', r: 'r', R: 'R', t: 't', T: 'T', m: 'm', M: 'M', x: 'x', X: 'X',
};

/** The glyph each character of a code ligature becomes: `less.c_lteq1`, the `c_` keeping them out of kerning. */
export const codePieceName = (charName: string, lig: CodeLigature, i: number) => `${charName}.c_${[...lig.text].map((ch) => SHORT[ch]).join('')}${i + 1}`;
