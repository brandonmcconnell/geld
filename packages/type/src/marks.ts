import { ALL, bar, box, comma, diagonal, dot, type DrawContext, level, open, p, rotate180, withPen } from './draw';
import type { Stroke } from './geometry';

/** Where a mark attaches: the base's anchor of the same name, matched by the mark's `_name` anchor at its origin. */
export type Attachment = 'top' | 'bottom' | 'ogonek' | 'topright';

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

export const MARKS: MarkDef[] = [
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
    draw: (g, h) => [withPen(open(p(-1.3, h * 0.6), p(-1.3, h, true), p(1, h, true), p(1, h * 0.45, true), p(0, h * 0.45), p(0, 0)), accentPen(g))],
  },
  {
    name: 'ringcomb',
    unicode: 0x30a,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => {
      const pen = { v: g.v * 0.72, h: g.h * 0.72 };
      const size = Math.max(pen.v, pen.h) + (h < MARK_HEIGHT.lower ? 0.8 : 1);
      return [withPen(box(-size / 2, size / 2, pen.h / 2, pen.h / 2 + size, ALL), pen)];
    },
  },
  { name: 'hungarumlautcomb', unicode: 0x30b, attach: 'top', caseForm: true, draw: (g, h) => [acute(g, h, -1.3), acute(g, h, 1.3)] },
  {
    name: 'caroncomb',
    unicode: 0x30c,
    attach: 'top',
    caseForm: true,
    draw: (g, h) => [diagonal(g, -2.2, h, 0, 0), diagonal(g, 2.2, h, 0, 0)].map((s) => withPen(s, accentPen(g))),
  },
  { name: 'commaturnedabovecomb', unicode: 0x312, attach: 'top', draw: (g) => rotate180(comma(g, 0, 0, 0.75), 0, (g.dot * 0.75 - 2.5 * 0.75) / 2) },
  { name: 'dotbelowcomb', unicode: 0x323, attach: 'bottom', draw: (g) => [dot(g, 0, -1.25 - g.dot)] },
  { name: 'commaaccentcomb', unicode: 0x326, attach: 'bottom', draw: (g) => comma(g, 0, -0.6 - g.dot * 0.65, 0.65) },
  {
    name: 'cedillacomb',
    unicode: 0x327,
    attach: 'bottom',
    draw: (g) => {
      const pen = accentPen(g);
      const top = -1 - pen.h / 2;
      const bottom = -3.5 + pen.h / 2;
      return [withPen(open(p(0, 0.5), p(0, top), p(1.6, top, true), p(1.6, bottom, true), p(-1.2, bottom)), pen)];
    },
  },
  {
    name: 'ogonekcomb',
    unicode: 0x328,
    attach: 'ogonek',
    draw: (g) => {
      const pen = accentPen(g);
      const bottom = -3.5 + pen.h / 2;
      return [withPen(open(p(0, 0.5), p(0, bottom, true), p(2.2, bottom)), pen)];
    },
  },
  {
    name: 'caronvertcomb',
    attach: 'topright',
    draw: (g) => [withPen(level(open(p(0.5, 3), p(-0.4, 0))), { v: g.dot * 0.8, h: g.dot * 0.8 })],
  },
];
