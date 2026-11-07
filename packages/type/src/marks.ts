import { ALL, bar, box, comma, diagonal, dot, type DrawContext, level, open, p, rotate180, shift, spanOf, withPen } from './draw';
import { expandStroke, type Stroke } from './geometry';

/** Where a mark attaches: the base's anchor of the same name, matched by the mark's `_name` anchor at its origin. */
export type Attachment = 'top' | 'bottom' | 'ogonek' | 'topright' | 'horn' | 'center';

/**
 * A combining mark, drawn around its attachment point (0, 0): marks above stand on it, marks
 * below hang from it. `height` is how tall a mark above may be: smaller over capitals.
 */
export interface MarkDef {
  name: string;
  unicode?: number;
  attach: Attachment;
  /** A `.case` version for capitals, flatter and closer. */
  caseForm?: boolean;
  /** Hangs clear below the base: placed by its own outline so its top is BELOW_GAP under the baseline at every weight. */
  hang?: boolean;
  draw(g: DrawContext, height: number): Stroke[];
}

/** How tall marks above are over lowercase and over capitals. */
export const MARK_HEIGHT = { lower: 2.6, case: 2.1 } as const;
/** The gap between a base and a mark above it. */
export const MARK_GAP = { lower: 1.25, case: 1 } as const;

/** Accents are drawn a little lighter than the letters they sit on. */
const accentPen = (g: DrawContext) => ({ v: g.v * 0.9, h: g.h * 0.9 });
/**
 * Marks with a counter or a turn in their small height (tilde, breve, hook above): their strokes stop
 * growing past about Regular, or at Black the stroke alone is taller than the mark and it closes up,
 * and their cuts are half the letters', which would eat the mark's short uprights.
 */
/** Circumflex and caron: the arms stop growing at Black, and spread with the pen, so the opening under the apex stays open. */
const chevronPen = (g: DrawContext) => ({ v: Math.min(g.v * 0.9, 2.4), h: Math.min(g.h * 0.9, 2.4) });
const chevronHalf = (g: DrawContext) => Math.max(2.2, chevronPen(g).v * 0.6 + 1.1);
const smallMarkPen = (g: DrawContext) => ({ v: Math.min(g.v * 0.9, 2), h: Math.min(g.h * 0.9, 1.3), cut: 1 });

const acute = (g: DrawContext, height: number, dx = 0): Stroke =>
  withPen(level(open(p(dx - 0.9, 0), p(dx + 0.9, height))), accentPen(g));

const MARKS_ABOVE: MarkDef[] = [
  { name: 'gravecomb', unicode: 0x300, attach: 'top', caseForm: true, draw: (g, h) => [withPen(level(open(p(0.9, 0), p(-0.9, h))), accentPen(g))] },
  { name: 'acutecomb', unicode: 0x301, attach: 'top', caseForm: true, draw: (g, h) => [acute(g, h)] },
  {
    name: 'circumflexcomb',
    unicode: 0x302,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => [diagonal(g, -chevronHalf(g), 0, 0, h), diagonal(g, chevronHalf(g), 0, 0, h)].map((s) => withPen(s, chevronPen(g))),
  },
  {
    name: 'tildecomb',
    unicode: 0x303,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => {
      // Up, a flat top, down, a flat bottom, up: every corner obtuse, so none needs a cut that could close it.
      const pen = smallMarkPen(g);
      const s = Math.min(1.4, Math.max(0.9, h - pen.h - 0.3));
      const a = 2.75;
      const y = pen.h / 2;
      return [withPen(open(p(-a, y), p(-a + s, y + s), p(-s / 2, y + s), p(s / 2, y), p(a - s, y), p(a, y + s)), pen)];
    },
  },
  { name: 'macroncomb', unicode: 0x304, attach: 'top', caseForm: true, draw: (g) => [withPen(bar(-2.4, 2.4, g.h / 2), accentPen(g))] },
  {
    name: 'brevecomb',
    unicode: 0x306,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => {
      const pen = smallMarkPen(g);
      const x = Math.max(2.3, pen.v / 2 + 1);
      return [withPen(open(p(-x, h), p(-x, pen.h / 2, true), p(x, pen.h / 2, true), p(x, h)), pen)];
    },
  },
  { name: 'dotaccentcomb', unicode: 0x307, attach: 'top', caseForm: true, draw: (g) => [dot(g, 0, 0)] },
  {
    name: 'dieresiscomb',
    unicode: 0x308,
    attach: 'top',
    caseForm: true,
    draw: (g) => {
      const x = g.dot / 2 + 0.9;
      return [dot(g, -x, 0), dot(g, x, 0)];
    },
  },
  {
    name: 'hookabovecomb',
    unicode: 0x309,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => {
      // The top of a question mark: a bar, its right side, and a bar back to the middle.
      const pen = smallMarkPen(g);
      const x = Math.max(1.4, pen.v / 2 + 0.8);
      const top = Math.max(h, 2 * pen.h + 0.8);
      return [withPen(open(p(-x, top - pen.h / 2), p(x, top - pen.h / 2, true), p(x, pen.h / 2, true), p(-0.3 * x, pen.h / 2)), pen)];
    },
  },
  {
    name: 'ringcomb',
    unicode: 0x30a,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => {
      const pen = { v: Math.min(g.v * 0.72, 1.7), h: Math.min(g.h * 0.72, 1.7) };
      const size = Math.max(pen.v, pen.h) + (h < MARK_HEIGHT.lower ? 1.3 : 1.6);
      return [withPen(box(-size / 2, size / 2, pen.h / 2, pen.h / 2 + size, ALL), pen)];
    },
  },
  {
    name: 'hungarumlautcomb',
    unicode: 0x30b,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => {
      const dx = 1.1 + g.v * 0.55;
      return [acute(g, h, -dx), acute(g, h, dx)];
    },
  },
  {
    name: 'caroncomb',
    unicode: 0x30c,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => [diagonal(g, -chevronHalf(g), h, 0, 0), diagonal(g, chevronHalf(g), h, 0, 0)].map((s) => withPen(s, chevronPen(g))),
  },
  {
    name: 'dblgravecomb',
    unicode: 0x30f,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => {
      const dx = 1.1 + g.v * 0.55;
      return [-dx, dx].map((x) => withPen(level(open(p(x + 0.9, 0), p(x - 0.9, h))), accentPen(g)));
    },
  },
  {
    name: 'breveinvertedcomb',
    unicode: 0x311,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => [withPen(open(p(-2, 0), p(-2, h - g.h / 2, true), p(2, h - g.h / 2, true), p(2, 0)), accentPen(g))],
  },
  { name: 'verticallineabovecomb', unicode: 0x30d, attach: 'top', caseForm: true, draw: (g, h) => [withPen(open(p(0, 0), p(0, h)), accentPen(g))] },
  { name: 'commaabovecomb', unicode: 0x313, attach: 'top', draw: (g) => comma(g, 0, 0, 0.75) },
  { name: 'commaaboverightcomb', unicode: 0x315, attach: 'topright', draw: (g) => comma(g, 0, 0, 0.65) },
  { name: 'dotaboverightcomb', unicode: 0x358, attach: 'topright', draw: (g) => [dot(g, 0, 0)] },
  { name: 'strokeshortoverlaycomb', unicode: 0x335, attach: 'center', draw: (g) => [withPen(bar(-2.25, 2.25, 0), accentPen(g))] },
  { name: 'commaturnedabovecomb', unicode: 0x312, attach: 'top', draw: (g) => rotate180(comma(g, 0, 0, 0.75), 0, (g.dot * 0.75 - 2.5 * 0.75) / 2) },
  { name: 'dotbelowcomb', unicode: 0x323, attach: 'bottom', hang: true, draw: (g) => [dot(g, 0, 0)] },
  { name: 'verticallinebelowcomb', unicode: 0x329, attach: 'bottom', hang: true, draw: (g) => [withPen(open(p(0, 0), p(0, 2.5)), accentPen(g))] },
  { name: 'commaaccentcomb', unicode: 0x326, attach: 'bottom', hang: true, draw: (g) => comma(g, 0, 0, 0.65) },
  {
    name: 'cedillacomb',
    unicode: 0x327,
    attach: 'bottom',
    draw: (g) => {
      const pen = accentPen(g);
      const top = -1.1 - pen.h / 2;
      const bottom = top - pen.h - 1.2;
      const x = Math.max(1.6, pen.v + 0.9);
      return [withPen(open(p(0, g.h / 2), p(0, top), p(x, top, true), p(x, bottom, true), p(-1.2, bottom)), pen)];
    },
  },
  {
    name: 'ogonekcomb',
    unicode: 0x328,
    attach: 'ogonek',
    draw: (g) => {
      const pen = accentPen(g);
      const bottom = -3.5 + pen.h / 2;
      return [withPen(open(p(0, g.h * 0.75), p(0, bottom, true), p(2.2, bottom)), pen)];
    },
  },
  {
    name: 'caronvertcomb',
    attach: 'topright',
    draw: (g) => [withPen(level(open(p(0.5, 3), p(-0.4, 0))), { v: g.dot * 0.8, h: g.dot * 0.8 })],
  },
  {
    name: 'horncomb',
    unicode: 0x31b,
    attach: 'horn',
    draw: (g) => {
      const pen = accentPen(g);
      return [withPen(open(p(-1, 0), p(2.6, 0, true), p(2.6, 3)), pen)];
    },
  },
];

/** The gap between the baseline and the top of a mark hanging below it. */
export const BELOW_GAP = 1.1;

function belowMarks(): MarkDef[] {
  const below = (name: string, unicode: number, above: MarkDef['draw'], height = 2) => ({
    name,
    unicode,
    attach: 'bottom' as const,
    hang: true,
    draw: (g: DrawContext) => above(g, height),
  });
  const find = (name: string) => MARKS_ABOVE.find((m) => m.name === name)!.draw;
  return [
    below('macronbelowcomb', 0x331, find('macroncomb'), 0),
    below('circumflexbelowcomb', 0x32d, find('circumflexcomb')),
    below('dieresisbelowcomb', 0x324, find('dieresiscomb'), 0),
    below('tildebelowcomb', 0x330, find('tildecomb')),
    below('ringbelowcomb', 0x325, find('ringcomb')),
    below('brevebelowcomb', 0x32e, find('brevecomb')),
    below('breveinvertedbelowcomb', 0x32f, find('breveinvertedcomb')),
    below('lowlinecomb', 0x332, (g) => [withPen(bar(-2.75, 2.75, g.h / 2), accentPen(g))], 0),
    below('dblmacronbelowcomb', 0x35f, (g) => [withPen(bar(-2, 8, g.h / 2), accentPen(g))], 0),
  ];
}

/**
 * Vietnamese sets the acute, grave or hook beside the circumflex rather than on top of it, so a
 * letter with both stays within the line. ccmp makes the same pair from typed marks.
 */
export const VIETNAMESE_PAIRS: [string, string][] = [
  ['circumflexcomb', 'acutecomb'],
  ['circumflexcomb', 'gravecomb'],
  ['circumflexcomb', 'hookabovecomb'],
];

function vietnameseMarks(): MarkDef[] {
  const find = (name: string) => MARKS_ABOVE.find((m) => m.name === name)!;
  return VIETNAMESE_PAIRS.map(([first, second]) => ({
    name: `${first}_${second}`,
    attach: 'top' as const,
    caseForm: true,
    draw: (g: DrawContext, height: number) => {
      // The tone mark stands 0.7 clear of the circumflex's arm on its side, measured from both outlines.
      const side = second === 'gravecomb' ? -1 : 1;
      const x = chevronHalf(g);
      const pen = chevronPen(g);
      const lift = height * 0.55;
      const arm = (y: number) => side * (x * (1 - y / height) + spanOf(pen, x, height));
      const tone = find(second).draw(g, height * 0.8);
      const points = tone.flatMap((s) => expandStroke(s, g.pen, 0)).flat();
      const reach = points
        .filter((q) => q.y + lift <= height)
        .map((q) => side * (arm(q.y + lift) + side * 0.7 - q.x))
        .reduce((a, b) => Math.max(a, b), 0);
      return [...find(first).draw(g, height), ...shift(tone, side * Math.max(2.6, reach), lift)];
    },
  }));
}

/** A macron stacked with an acute or grave, either way up, for tone marks. */
function toneMarks(): MarkDef[] {
  const find = (name: string) => MARKS_ABOVE.find((m) => m.name === name)!.draw;
  const stack = (name: string, unicode: number, lower: string, upper: string): MarkDef => ({
    name,
    unicode,
    attach: 'top',
    draw: (g, height) => {
      const short = height * 0.75;
      const low = lower === 'macroncomb' ? g.h : short;
      return [...find(lower)(g, short), ...shift(find(upper)(g, short), 0, low + 0.6)];
    },
  });
  return [
    stack('macronacutecomb', 0x1dc4, 'macroncomb', 'acutecomb'),
    stack('gravemacroncomb', 0x1dc5, 'gravecomb', 'macroncomb'),
    stack('macrongravecomb', 0x1dc6, 'macroncomb', 'gravecomb'),
    stack('acutemacroncomb', 0x1dc7, 'acutecomb', 'macroncomb'),
  ];
}

export const MARKS: MarkDef[] = [...MARKS_ABOVE, ...belowMarks(), ...vietnameseMarks(), ...toneMarks()];
