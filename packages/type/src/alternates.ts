import { bar, box, diagonal, type DrawContext, dot, edgeAt, type GlyphDef, INSIDE, level, meeting, open, p, rotate, spanOf, stem, withPen } from './draw';
import type { Stroke } from './geometry';

/**
 * Alternates (6.1, 6.2): each an unencoded glyph named for the stylistic set it belongs to (`a.ss01`), spaced and
 * anchored as its character, with a character variant of its own (`cv01`) so one letter can change without its set;
 * `salt` takes every glyph's first alternate and `aalt` lists them all. Accented letters follow their base (á.ss01).
 * An alternate that would draw as its default in a style (the italic's l is tailed already) is only in the other one,
 * decided per style, since every master of a variable font needs the same glyphs.
 */

/** The stylistic sets, in the font with these names, so apps show them. */
export const STYLISTIC_SETS: Record<string, string> = {
  ss01: 'Single-storey a',
  ss02: 'Double-storey g',
  ss03: 'Distinct l, I, 0 and 1',
  ss04: 'Open digits',
  ss05: 'Alternate R, K and M',
  ss06: 'Straight y and j tails',
  ss07: 'Octagonal dots',
  ss08: 'Italic exit strokes',
  ss17: 'Circled numerals',
};

export interface Alternate {
  /** The glyph it stands in for. */
  glyph: string;
  /** The set whose tag names it; a variant in no set is named for its cv. */
  set?: keyof typeof STYLISTIC_SETS;
  cv: string;
  label: string;
  draw?: (g: DrawContext, base: GlyphDef) => Stroke[];
  /** The italic's own form; otherwise the roman form, slanted. */
  italic?: (g: DrawContext, base: GlyphDef) => Stroke[];
  lsb?: number;
  rsb?: number;
  /** The one style it exists in, where the other's default is this form already. */
  only?: 'roman' | 'italic';
}

/** The roman drawing of a glyph whose italic is its own (the roman's straight y in italic). */
const roman = (g: DrawContext, base: GlyphDef) => base.draw(g);
/** The italic's drawing, upright (the italic's single-storey a in roman). */
const italicForm = (g: DrawContext, base: GlyphDef) => base.italic!(g);

export const ALTERNATES: Alternate[] = [
  { glyph: 'a', set: 'ss01', cv: 'cv01', label: 'Single-storey a', draw: italicForm, only: 'roman' },
  {
    glyph: 'g',
    set: 'ss02',
    cv: 'cv02',
    label: 'Double-storey g',
    rsb: 0.75,
    draw: (g) => {
      // Four horizontals in fourteen units: at heavy weights they are lighter than the stems, or the counters close.
      const pen = { ...g.pen, h: Math.min(g.h, 2.4) };
      const h = pen.h;
      const w = g.wide(8);
      const bowl = g.wide(6.25);
      const top = g.xHeight - h / 2;
      const split = 4;
      const loopTop = 1.5;
      // Square where the link and the ear join, so they meet the bowl's ink rather than its cut corners.
      return [
        withPen(box(0, bowl, split + h / 2, top, [false, true, false, true]), pen),
        // The ear stands out from the bowl by at least a stem, so it reads as an ear rather than a step.
        withPen(bar(bowl - g.v, Math.max(w, bowl + g.v / 2 + Math.max(2, g.v)), top), pen),
        withPen(stem(0, loopTop, split + h / 2), pen),
        withPen(box(0, w, g.descender + h / 2, loopTop, [true, true, true, false]), pen),
      ];
    },
  },
  { glyph: 'l', set: 'ss03', cv: 'cv03', label: 'Tailed l', only: 'roman', draw: (g) => [open(p(0, g.ascender), p(0, g.bottom(0), true), p(g.wide(2.5), g.bottom(0)))] },
  {
    glyph: 'I',
    set: 'ss03',
    cv: 'cv04',
    label: 'Barred I',
    lsb: 1,
    rsb: 1,
    draw: (g) => {
      const s = g.wide(2.5);
      return [stem(0, 0, g.cap), bar(-s, s, g.top(g.cap)), bar(-s, s, g.bottom(0))];
    },
  },
  {
    glyph: 'zero',
    set: 'ss03',
    cv: 'cv05',
    label: 'Slashed zero',
    draw: (g, base) => {
      const w = g.wide(9);
      return [...base.draw(g), diagonal(g, w * 0.3, g.cap * 0.28, w * 0.7, g.cap * 0.72)];
    },
  },
  {
    glyph: 'one',
    set: 'ss03',
    cv: 'cv06',
    label: 'One with a base',
    rsb: 1,
    draw: (g, base) => {
      const x = g.wide(3);
      const half = g.wide(3.25);
      return [...base.draw(g), bar(x - half, x + half, g.bottom(0))];
    },
  },
  {
    glyph: 'j',
    set: 'ss06',
    cv: 'cv07',
    label: 'Straight j',
    lsb: 1.5,
    draw: (g) => [stem(0, g.descender, g.xHeight), dot(g, 0, g.xHeight + g.y(1.5))],
  },
  { glyph: 'y', set: 'ss06', cv: 'cv08', label: 'Straight y', italic: roman, only: 'italic' },

  // ss04 open digits.
  {
    glyph: 'four',
    set: 'ss04',
    cv: 'cv09',
    label: 'Open 4',
    draw: (g) => {
      const w = g.wide(10);
      const y = g.y(4.5);
      return [stem(w * 0.72, 0, g.cap), open(p(0, g.cap), p(0, y, true), p(w, y))];
    },
  },
  {
    glyph: 'six',
    set: 'ss04',
    cv: 'cv10',
    label: 'Straight-backed 6',
    draw: (g) => sixStraight(g),
  },
  {
    glyph: 'nine',
    set: 'ss04',
    cv: 'cv11',
    label: 'Straight-backed 9',
    draw: (g) => rotate(sixStraight(g), 180, g.wide(9) / 2, g.cap / 2),
  },
  {
    glyph: 'three',
    set: 'ss04',
    cv: 'cv12',
    label: 'Flat-topped 3',
    draw: (g) => {
      const w = g.wide(9);
      const m = g.y(8);
      const x0 = w - spanOf(g.diag, w * 0.55, g.cap - m);
      const x1 = w * 0.4;
      const b = g.bottom(0);
      return [
        bar(0, edgeAt(g.diag, x0, g.cap, x1, m - g.h / 2, g.cap - g.h, 1) - INSIDE, g.top(g.cap)),
        // The diagonal lands on the lower bar's bottom edge, and the bar starts inside it.
        diagonal(g, x0, g.cap, x1, m - g.h / 2),
        open(p(edgeAt(g.diag, x0, g.cap, x1, m - g.h / 2, m + g.h / 2, -1) + INSIDE, m), p(w, m, true), p(w, b, true), p(0, b, true), p(0, g.y(4))),
      ];
    },
  },

  // ss05 alternate R, K and M.
  {
    glyph: 'R',
    set: 'ss05',
    cv: 'cv13',
    label: 'R with its leg from the stem',
    draw: (g) => {
      const w = g.wide(9.5);
      const bowl = g.y(6);
      const reach = w + g.v / 2 - g.foot(w, bowl);
      return [stem(0, 0, g.cap), box(0, w, bowl, g.top(g.cap), [false, true, true, false]), withPen(level(open(p(0, bowl), p(reach, 0)), false, true), g.diag)];
    },
  },
  {
    glyph: 'K',
    set: 'ss05',
    cv: 'cv14',
    label: 'K with both arms from the stem',
    draw: (g) => {
      const w = g.wide(9.5);
      const y0 = g.cap / 2;
      const reach = w + g.v / 2 - g.foot(w, g.cap - y0);
      return [stem(0, 0, g.cap), withPen(level(open(p(0, y0), p(reach, g.cap)), false, true), g.diag), withPen(level(open(p(0, y0), p(reach, 0)), false, true), g.diag)];
    },
  },
  {
    glyph: 'M',
    set: 'ss05',
    cv: 'cv15',
    label: 'Splayed M',
    lsb: 0.3,
    rsb: 0.3,
    draw: (g) => {
      const w = g.wide(12);
      const d = g.wide(1.75);
      // The lowercase w turned over: each tip is two diagonals meeting level, as w's feet are.
      const inner = g.y(3.5);
      return [...meeting(g, [0, 0], [w / 2, inner], d, g.cap), ...meeting(g, [w / 2, inner], [w, 0], w - d, g.cap)];
    },
  },

  // ss08 italic exit strokes: a short foot to the right where the last stem meets the baseline.
  { glyph: 'n', set: 'ss08', cv: 'cv16', label: 'Italic n with an exit', only: 'italic', draw: (g) => { const w = g.wide(7); const t = g.top(g.xHeight); const b = g.bottom(0); return [open(p(0, 0), p(0, t), p(w, t, true), p(w, b, true), p(w + exit(g), b))]; } },
  {
    glyph: 'm',
    set: 'ss08',
    cv: 'cv17',
    label: 'Italic m with an exit',
    only: 'italic',
    draw: (g) => {
      const w = g.wide(6.5);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return [stem(0, 0, g.xHeight), open(p(0, t), p(w, t), p(w, 0)), open(p(w, t), p(2 * w, t, true), p(2 * w, b, true), p(2 * w + exit(g), b))];
    },
  },
  { glyph: 'h', set: 'ss08', cv: 'cv18', label: 'Italic h with an exit', only: 'italic', draw: (g) => { const w = g.wide(7); const t = g.top(g.xHeight); const b = g.bottom(0); return [stem(0, 0, g.ascender), open(p(0, t), p(w, t, true), p(w, b, true), p(w + exit(g), b))]; } },
  { glyph: 'i', set: 'ss08', cv: 'cv19', label: 'Italic i with an exit', only: 'italic', draw: (g) => [open(p(0, g.xHeight), p(0, g.bottom(0), true), p(exit(g), g.bottom(0))), dot(g, 0, g.xHeight + g.y(1.5))] },
  { glyph: 'u', set: 'ss08', cv: 'cv20', label: 'Italic u with an exit', only: 'italic', draw: (g) => { const w = g.wide(7); const b = g.bottom(0); return [open(p(0, g.xHeight), p(0, b, true), p(w + exit(g), b)), stem(w, 0, g.xHeight)]; } },
];

/** The exit stroke's length past the stem. */
const exit = (g: DrawContext) => g.wide(2.5);

/** A 6 whose back is one straight diagonal from its bowl (and, turned, the 9). */
function sixStraight(g: DrawContext): Stroke[] {
  const w = g.wide(9);
  const top = g.top(g.y(8));
  const b = g.bottom(0);
  // One stroke: down the back onto the left side, round the bowl, and its top bar ending inside the left side.
  return [level(open(p(w * 0.6, g.cap), p(0, top + g.y(2.5)), p(0, b, true), p(w, b, true), p(w, top, true), p(0, top)), true, false)];
}

/** The set of octagonal dots, drawn rather than listed: every glyph and mark whose dots are octagons in it (master.ts). */
export const OCTAGONAL_DOTS = 'ss07';
/** The set that turns the figures into the circled numerals ⓪ ①–⑨, which are encoded glyphs of their own. */
export const CIRCLED_NUMERALS = 'ss17';

/** Each alternate's glyph name: its set's tag, or its cv's when it is in none. */
export const alternateName = (alt: Alternate) => `${alt.glyph}.${alt.set ?? alt.cv}`;

/** The alternates as glyphs, drawn from their characters' own definitions. */
export function alternateDefs(defs: GlyphDef[]): GlyphDef[] {
  const byName = new Map(defs.map((d) => [d.name, d]));
  return ALTERNATES.flatMap((alt) => {
    const base = byName.get(alt.glyph);
    if (!base) return [];
    const draw = alt.draw ? (g: DrawContext) => alt.draw!(g, base) : base.draw;
    const italic = alt.italic ? (g: DrawContext) => alt.italic!(g, base) : alt.draw ? undefined : base.italic;
    const rest: GlyphDef = { ...base };
    delete rest.unicode;
    delete rest.italic;
    return [
      {
        ...rest,
        name: alternateName(alt),
        ...(base.unicode === undefined ? {} : { stands: base.unicode }),
        lsb: alt.lsb ?? base.lsb,
        rsb: alt.rsb ?? base.rsb,
        draw,
        ...(italic ? { italic } : {}),
      },
    ];
  });
}
