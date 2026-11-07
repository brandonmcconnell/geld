import { ALL, bar, box, comma, diagonal, dot, type DrawContext, level, open, p, rotate180, shift, withPen } from './draw';
import type { Stroke } from './geometry';

/** Where a mark attaches: the base's anchor of the same name, matched by the mark's `_name` anchor at its origin. */
export type Attachment = 'top' | 'bottom' | 'ogonek' | 'topright' | 'horn';

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
    draw: (g, h) => [diagonal(g, -2.2, 0, 0, h), diagonal(g, 2.2, 0, 0, h)].map((s) => withPen(s, accentPen(g))),
  },
  {
    name: 'tildecomb',
    unicode: 0x303,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => {
      const s = Math.max(1, h - g.h);
      const y = g.h / 2;
      return [withPen(open(p(-1.5 * s, y), p(-0.5 * s, y + s, true), p(0.5 * s, y, true), p(1.5 * s, y + s)), accentPen(g))];
    },
  },
  { name: 'macroncomb', unicode: 0x304, attach: 'top', caseForm: true, draw: (g) => [withPen(bar(-2.4, 2.4, g.h / 2), accentPen(g))] },
  {
    name: 'brevecomb',
    unicode: 0x306,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => [withPen(open(p(-2, h), p(-2, g.h / 2, true), p(2, g.h / 2, true), p(2, h)), accentPen(g))],
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
    draw: (g, h) => [withPen(open(p(-1.1, h), p(1.1, h, true), p(1.1, 0)), accentPen(g))],
  },
  {
    name: 'ringcomb',
    unicode: 0x30a,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => {
      const pen = { v: g.v * 0.72, h: g.h * 0.72 };
      const size = Math.max(pen.v, pen.h) + (h < MARK_HEIGHT.lower ? 1.1 : 1.3);
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
    draw: (g, h) => [diagonal(g, -2.2, h, 0, 0), diagonal(g, 2.2, h, 0, 0)].map((s) => withPen(s, accentPen(g))),
  },
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
    draw: (g: DrawContext, height: number) => [
      ...find(first).draw(g, height),
      ...shift(find(second).draw(g, height * 0.8), second === 'gravecomb' ? -2.6 : 2.6, height * 0.55),
    ],
  }));
}

export const MARKS: MarkDef[] = [...MARKS_ABOVE, ...belowMarks(), ...vietnameseMarks()];
