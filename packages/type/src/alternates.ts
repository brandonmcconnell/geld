import { bar, box, crossbarReach, mirror, solid, yArms, yStemTop, diagonal, type DrawContext, dot, edgeAt, type GlyphDef, INSIDE, level, meeting, open, p, rotate, spanOf, stem, withPen } from './draw';
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

  // Character variants in no set (6.2).
  {
    glyph: 'G',
    cv: 'cv21',
    label: 'G without a bar',
    draw: (g) => {
      const w = g.wide(10);
      const y = g.top(Math.max(g.cap / 2, 2 * g.h + 1.6));
      return [open(p(w, g.y(9)), p(w, g.top(g.cap), true), p(0, g.top(g.cap), true), p(0, g.bottom(0), true), p(w, g.bottom(0)), p(w, y))];
    },
  },
  {
    glyph: 'J',
    cv: 'cv22',
    label: 'J with a top bar',
    draw: (g, base) => {
      const w = g.wide(8);
      return [...base.draw(g), bar(w - g.wide(3.5), w + g.v / 2, g.top(g.cap))];
    },
  },
  {
    glyph: 'Q',
    cv: 'cv23',
    label: 'Q with an upright tail',
    draw: (g) => {
      const w = g.wide(10);
      return [box(0, w, g.bottom(0), g.top(g.cap), [true, true, true, true]), stem(w / 2, -2.75, g.h / 2)];
    },
  },
  {
    glyph: 'W',
    cv: 'cv24',
    label: 'Crossed W',
    draw: (g) => {
      const w = g.wide(15);
      return [...meeting(g, [0, g.cap], [w * 0.66, g.cap], w * 0.33, 0), ...meeting(g, [w * 0.34, g.cap], [w, g.cap], w * 0.67, 0)];
    },
  },
  {
    glyph: 't',
    cv: 'cv25',
    label: 't with a square foot',
    draw: (g) => {
      const b = g.bottom(0);
      return [open(p(0, g.y(13)), p(0, b), p(g.wide(3.5), b)), bar(-crossbarReach(g), g.wide(3.5), g.top(g.xHeight))];
    },
  },
  { glyph: 'f', cv: 'cv26', label: 'Descending f', draw: italicForm, only: 'roman' },
  {
    glyph: 'seven',
    cv: 'cv27',
    label: '7 with a crossbar',
    draw: (g, base) => {
      const w = g.wide(9);
      const x = (w - spanOf(g.diag, w * 0.65, g.cap) + w * 0.35) / 2;
      // As long as the diagonal is wide at its middle, and as far again past it each side as an overhang must be.
      const half = g.diag.v + 1.75;
      return [...base.draw(g), bar(x - half, x + half, g.cap / 2)];
    },
  },
  {
    glyph: 'dollar',
    cv: 'cv28',
    label: 'Dollar with stubs',
    draw: (g) => {
      const w = g.wide(9.5);
      const t = g.top(g.cap);
      const b = g.bottom(0);
      return [
        open(p(w, 10), p(w, t, true), p(0, t, true), p(0, g.cap / 2, true), p(w, g.cap / 2, true), p(w, b, true), p(0, b, true), p(0, 4)),
        stem(w / 2, -2, g.h / 2),
        stem(w / 2, g.cap - g.h / 2, 16),
      ];
    },
  },
  {
    glyph: 'numbersign',
    cv: 'cv29',
    label: 'Slanted number sign',
    draw: (g) => {
      const w = g.wide(9);
      const lean = 1.5;
      // Each bar is centred on the slanted stems at its own height, standing out past them as the upright sign's do.
      const at = (y: number) => lean * ((y - 7) / 6);
      // The stems lean across a bar's own height too, so a heavy bar reaches further to stand out at its top and bottom.
      const extra = 0.25 + (lean * g.h) / 12;
      return [
        diagonal(g, w * 0.3 - lean, 1, w * 0.3 + lean, 13),
        diagonal(g, w * 0.7 - lean, 1, w * 0.7 + lean, 13),
        bar(at(4.75) - extra, w + at(4.75) + extra, 4.75),
        bar(at(9.25) - extra, w + at(9.25) + extra, 9.25),
      ];
    },
  },
  { glyph: 'quotesingle', cv: 'cv30', label: 'Slanted straight quotes', draw: (g) => [diagonal(g, 0.75, g.cap - 4, 1.75, g.cap)] },
  { glyph: 'quotedbl', cv: 'cv30', label: 'Slanted straight quotes', draw: (g) => [diagonal(g, 0.75, g.cap - 4, 1.75, g.cap), diagonal(g, g.v + 2.25, g.cap - 4, g.v + 3.25, g.cap)] },
  {
    glyph: 'asterisk',
    cv: 'cv31',
    label: 'Five-armed asterisk',
    draw: (g) => {
      const c = { x: 2.6, y: 11 };
      const r = Math.max(2.75, 1.4 * g.diag.v + 0.5);
      const round = { v: g.diag.v, h: g.diag.v };
      return [90, 162, 234, 306, 18].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return withPen(open(p(c.x, c.y), p(c.x + r * Math.cos(a), c.y + r * Math.sin(a))), round);
      });
    },
  },
  {
    glyph: 'germandbls',
    cv: 'cv32',
    label: 'Flat-topped ß, as the capital',
    draw: (g) => {
      const w = g.wide(7);
      const w2 = g.wide(8);
      const t = g.top(g.ascender);
      const b = g.bottom(0);
      const m = g.y(6.5);
      const low = m - g.h / 2;
      const turn = g.y(10.5);
      const start = edgeAt(g.pen, w, turn, w * 0.4, low, m + g.h / 2, -1) + INSIDE;
      return [level(open(p(0, 0), p(0, t, true), p(w, t, true), p(w, turn), p(w * 0.4, low)), false, true), open(p(start, m), p(w2, m, true), p(w2, b, true), p(w * 0.45, b))];
    },
  },
  {
    glyph: 'percent',
    cv: 'cv33',
    label: 'Percent with solid dots',
    draw: (g) => {
      const w = g.wide(12);
      const size = Math.max(g.v, g.h) + Math.max(1.6, 4.4 - Math.max(g.v, g.h));
      const e = g.foot(w, g.cap);
      const square = (x: number, y: number) => solid([p(x, y, true), p(x + size, y, true), p(x + size, y + size, true), p(x, y + size, true)]);
      return [square(0, g.cap - size - g.h / 2), square(w - size, g.h / 2), diagonal(g, w - e, g.cap, e, 0)];
    },
  },
  {
    glyph: 'question',
    cv: 'cv34',
    label: 'Question mark with a 45° hook',
    draw: (g) => {
      const w = g.wide(7.5);
      const t = g.top(g.cap);
      const x = w / 2;
      const arm = Math.min(8.5, g.cap - g.h * 1.5 - g.aperture);
      // 45° where there is room; at heavy weights the drop stops a stem above the dot's gap, so the stem stays.
      const drop = Math.min(w - x, arm - (g.dot + 1.5) - g.v);
      return [open(p(0, g.y(10.5)), p(0, t, true), p(w, t, true), p(w, arm), p(x, arm - drop), p(x, g.dot + 1.5)), dot(g, x, 0)];
    },
  },
  {
    glyph: 'paragraph',
    cv: 'cv35',
    label: 'Pilcrow with an open bowl',
    draw: (g) => {
      const w = g.wide(8);
      const t = g.top(g.cap);
      return [stem(w * 0.55, -2, g.cap), stem(w, -2, g.cap), bar(w * 0.55, w, t), open(p(w * 0.55, t), p(0, t, true), p(0, g.y(7), true), p(w * 0.55, g.y(7)))];
    },
  },
  { glyph: 'braceleft', cv: 'cv36', label: 'Braces with a flat middle', draw: (g) => flatBrace(g) },
  { glyph: 'braceright', cv: 'cv36', label: 'Braces with a flat middle', draw: (g) => mirror(flatBrace(g), g.wide(4.5) / 2) },
];

/** { with its middle a level tick out of an upright, as the brackets are built, rather than a 45° point. */
function flatBrace(g: DrawContext): Stroke[] {
  const x = 1.75 + g.v / 2;
  const w = x + Math.max(g.wide(4.5) - x, 1.5 + g.v / 2 + 1);
  const top = g.top(15.5);
  const bottom = g.bottom(-3.5);
  return [open(p(w, top), p(x, top, true), p(x, bottom, true), p(w, bottom)), bar(0, x, 6)];
}

/**
 * Swashes (6.3): the letter's own drawing with a flourish, spaced and as wide as the letter, the flourish reaching into
 * the space beside it. `swsh` takes the capitals and the descenders, `init` the entry flags on ascenders and `fina` the
 * exits along the baseline; `cswh` puts entries at a word's start and exits at its end, and the capitals whose flourish
 * reaches back (A J M N Y) at a word's start, never where a flourish would run into the next letter.
 */
export type SwashKind = 'swsh' | 'init' | 'fina';
export interface Swash {
  glyph: string;
  kind: SwashKind;
  /** Taken at a word's start by cswh: its flourish reaches back, into the space before the word. */
  starts?: boolean;
  draw: (g: DrawContext, base: GlyphDef) => Stroke[];
}
/** How far a flourish runs past its letter. */
const FLOURISH = 3;
const foot = (g: DrawContext, x: number, toward: number, y = g.bottom(0)) => bar(Math.min(x, toward), Math.max(x, toward), y);

export const SWASHES: Swash[] = [
  {
    glyph: 'A',
    kind: 'swsh',
    starts: true,
    // The foot ends halfway along the leg at the bar's height, so it is inside the leg at its top and its bottom.
    draw: (g, base) => [...base.draw(g), foot(g, ((g.wide(10) / 2) * (g.h / g.cap)) / 2, -FLOURISH)],
  },
  {
    glyph: 'J',
    kind: 'swsh',
    starts: true,
    draw: (g) => {
      const w = g.wide(8);
      return [open(p(w, g.cap), p(w, g.bottom(-3), true), p(-FLOURISH, g.bottom(-3)))];
    },
  },
  {
    glyph: 'K',
    kind: 'swsh',
    draw: (g, base) => {
      const w = g.wide(9.5);
      const reach = w + g.v / 2 - g.foot(w, g.cap - g.y(4.5));
      return [...base.draw(g), foot(g, reach - g.v / 2, reach + FLOURISH)];
    },
  },
  { glyph: 'M', kind: 'swsh', starts: true, draw: (g, base) => [...base.draw(g), foot(g, g.v / 2, -FLOURISH)] },
  { glyph: 'N', kind: 'swsh', starts: true, draw: (g, base) => [...base.draw(g), foot(g, g.v / 2, -FLOURISH)] },
  {
    glyph: 'Q',
    kind: 'swsh',
    draw: (g, base) => {
      // Q's own tail turning along the bottom, one stroke, so the run-on has no joint of its own.
      const w = g.wide(10);
      const x = w * 0.55;
      return [base.draw(g)[0]!, withPen({ ...open(p(x, 3.5), p(x + 5.5, -2), p(x + 5.5 + FLOURISH, -2)), startCap: 'flat' }, g.diag)];
    },
  },
  {
    glyph: 'R',
    kind: 'swsh',
    draw: (g, base) => {
      const w = g.wide(9.5);
      const reach = w + g.v / 2 - g.foot(w * 0.6, g.y(6));
      return [...base.draw(g), foot(g, reach - g.v / 2, reach + FLOURISH)];
    },
  },
  {
    glyph: 'Y',
    kind: 'swsh',
    starts: true,
    draw: (g) => {
      const w = g.wide(11);
      const join = g.y(6);
      const [left, right] = yArms(g, w, g.cap, join);
      const c = w / 2;
      return [left!, right!, open(p(c, yStemTop(g, w, g.cap, join)), p(c, g.bottom(-3), true), p(c - FLOURISH - 1, g.bottom(-3)))];
    },
  },
  // Descenders swept further (swsh).
  {
    glyph: 'g',
    kind: 'swsh',
    draw: (g) => {
      const w = g.wide(8);
      const d = g.bottom(g.descender);
      return [box(0, w, g.bottom(0), g.top(g.xHeight), [true, false, false, true]), open(p(w, g.xHeight), p(w, d, true), p(-FLOURISH, d))];
    },
  },
  {
    glyph: 'j',
    kind: 'swsh',
    draw: (g) => {
      const d = g.bottom(g.descender);
      return [open(p(0, g.xHeight), p(0, d, true), p(-2.5 - FLOURISH, d)), dot(g, 0, g.xHeight + g.y(1.5))];
    },
  },
  { glyph: 'p', kind: 'swsh', draw: (g, base) => [...base.draw(g), foot(g, g.v / 2, -FLOURISH, g.bottom(g.descender))] },
  {
    glyph: 'q',
    kind: 'swsh',
    draw: (g, base) => {
      const w = g.wide(8);
      return [...base.draw(g), foot(g, w - g.v / 2, w + FLOURISH, g.bottom(g.descender))];
    },
  },
  {
    glyph: 'y',
    kind: 'swsh',
    draw: (g, base) => {
      const w = g.wide(8.5);
      const end = w / 2 - (w / 2) * (-g.descender / g.xHeight);
      return [...base.draw(g), foot(g, end + g.foot(w / 2, g.xHeight - g.descender) / 2, end - FLOURISH, g.bottom(g.descender))];
    },
  },
  // Entries on ascenders (init).
  ...['b', 'h', 'k', 'l'].map((glyph): Swash => ({ glyph, kind: 'init', draw: (g, base) => [...base.draw(g), foot(g, g.v / 2, -FLOURISH, g.top(g.ascender))] })),
  {
    glyph: 'd',
    kind: 'init',
    draw: (g, base) => {
      const w = g.wide(8);
      return [...base.draw(g), foot(g, w + g.v / 2, w - FLOURISH - g.v, g.top(g.ascender))];
    },
  },
  // Exits along the baseline (fina).
  { glyph: 'a', kind: 'fina', draw: (g, base) => [...base.draw(g), foot(g, g.wide(7.5) - g.v / 2, g.wide(7.5) + FLOURISH)] },
  { glyph: 'n', kind: 'fina', draw: (g, base) => [...base.draw(g), foot(g, g.wide(7) - g.v / 2, g.wide(7) + FLOURISH)] },
  { glyph: 'm', kind: 'fina', draw: (g, base) => [...base.draw(g), foot(g, 2 * g.wide(6.5) - g.v / 2, 2 * g.wide(6.5) + FLOURISH)] },
  {
    glyph: 'e',
    kind: 'fina',
    draw: (g) => {
      const w = g.wide(8);
      const t = g.top(g.xHeight);
      const b = g.bottom(0);
      return [open(p(0, g.y(5.25)), p(w, g.y(5.25)), p(w, t, true), p(0, t, true), p(0, b, true), p(w + FLOURISH, b))];
    },
  },
  {
    glyph: 't',
    kind: 'fina',
    draw: (g) => {
      const b = g.bottom(0);
      return [open(p(0, g.y(13)), p(0, b, true), p(g.wide(3.5) + FLOURISH, b)), bar(-crossbarReach(g), g.wide(3.5), g.top(g.xHeight))];
    },
  },
];

export const swashName = (s: Swash) => `${s.glyph}.${s.kind}`;

/** The swashes as glyphs, each spaced and as wide as its letter (`like`), the flourish hanging past its sides. */
export function swashDefs(defs: GlyphDef[]): GlyphDef[] {
  const byName = new Map(defs.map((d) => [d.name, d]));
  return SWASHES.flatMap((sw) => {
    const base = byName.get(sw.glyph);
    if (!base) return [];
    const def: GlyphDef = { ...base, name: swashName(sw), like: base.name, draw: (g) => sw.draw(g, base) };
    delete def.unicode;
    delete def.italic;
    return [{ ...def, ...(base.unicode === undefined ? {} : { stands: base.unicode }) }];
  });
}

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
