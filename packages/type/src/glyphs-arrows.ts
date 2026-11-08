/**
 * The rest of the plan's arrows (3.6) and the keyboard keys (⌘ ⌥ ⌃ ⇧ ⇪ ⇥ ⇤ ⏎ ⌫ ⌦ ⎋ ⏏ ⌂ ⌀ ⎈ ⏻ ⏼), which Geld's own
 * UI prints beside text ("⌘ 1-click review"), so they share the arrows' shaft, heads and 45°.
 */
import type { PlacedDef } from './composites';
import { ALL, bar, box, closed, type DrawContext, type GlyphDef, MATH_AXIS, mirror, open, p, rotate, solid, stem, withPen } from './draw';
import type { PathPoint, Stroke } from './geometry';
import { ARROW_LENGTH, arrowRight, doubleArrowRight, HEAD } from './glyphs-plus';

type Heads = { start?: boolean; end?: boolean };

const def = (name: string, unicode: number, draw: (g: DrawContext) => Stroke[], side = 1): GlyphDef => ({ name, unicode, lsb: side, rsb: side, draw });

/** An arrow's head pointing along `dir` from its tip, the arrows' own 45° arms. */
const headAt = (x: number, y: number, dir: 'left' | 'right' | 'up' | 'down', size = HEAD): Stroke => {
  const arms: Record<typeof dir, [[number, number], [number, number]]> = {
    right: [[-size, size], [-size, -size]],
    left: [[size, size], [size, -size]],
    up: [[-size, -size], [size, -size]],
    down: [[-size, size], [size, size]],
  };
  const [[ax, ay], [bx, by]] = arms[dir];
  return open(p(x + ax, y + ay), p(x, y), p(x + bx, y + by));
};

/** A path whose last point is an arrow's tip: the shaft stops inside the head, as the straight arrows' does. */
function bent(points: [number, number][], dir: 'left' | 'right' | 'up' | 'down', cut = false): Stroke[] {
  const [x, y] = points.at(-1)!;
  const back = { left: [HEAD / 2, 0], right: [-HEAD / 2, 0], up: [0, -HEAD / 2], down: [0, HEAD / 2] }[dir];
  const shaft = [...points.slice(0, -1).map(([px, py], i) => p(px, py, cut && i > 0)), p(x + back[0]!, y + back[1]!)];
  return [open(...shaft), headAt(x, y, dir)];
}

const LONG = 18;

/** Two arrows one above the other (⇄ ⇉), their heads smaller so the pair fits the arrows' height, kept apart at every weight. */
function paired(g: DrawContext, first: Heads, second: Heads, flipSecond: boolean): Stroke[] {
  const size = Math.max(2.5, 1 + 0.75 * g.v);
  const offset = size + g.v / 2 + 0.9;
  const top = arrowRight(first, ARROW_LENGTH, MATH_AXIS + offset, size);
  const low = arrowRight(second, ARROW_LENGTH, MATH_AXIS - offset, size);
  return [...top, ...(flipSecond ? mirror(low, ARROW_LENGTH / 2) : low)];
}

const DASH = 2;
const dashGap = (g: DrawContext) => Math.max(1.25, g.v * 0.6);
/** The dashed arrow's length: three dashes and their gaps, then the head. */
const dashedLength = (g: DrawContext) => 3 * DASH + 3 * dashGap(g) + HEAD;

/** A dashed arrow (⇢): the shaft in three dashes, the head whole. */
function dashed(g: DrawContext): Stroke[] {
  const gap = dashGap(g);
  const out: Stroke[] = [];
  for (let i = 0, x = 0; i < 3; i++, x += DASH + gap) out.push(bar(x, x + DASH, MATH_AXIS));
  const end = dashedLength(g);
  out.push(bar(end - HEAD - 0.01, end - HEAD / 2, MATH_AXIS), headAt(end, MATH_AXIS, 'right'));
  return out;
}

/** A white arrow (⇨, and ⇧ the Shift key): an outlined shaft and a 45° head, one stroke all round. */
function whiteArrow(g: DrawContext, length = 12): PathPoint[] {
  const s = Math.max(1.75, g.v / 2 + 1);
  const h = s + Math.max(2.5, g.v + 1.25);
  const y = MATH_AXIS;
  return [p(0, y - s), p(length - h, y - s), p(length - h, y - h), p(length, y), p(length - h, y + h), p(length - h, y + s), p(0, y + s)];
}

/** A broken ring (⏻ ⎋ ↻): the cut square ∅ is drawn in, open at its top between `from` and `to`. */
function brokenRing(g: DrawContext, size: number, from: number, to: number): Stroke {
  const [t, b] = [MATH_AXIS + size / 2 - g.h / 2, MATH_AXIS - size / 2 + g.h / 2];
  return open(p(from, t), p(0, t, true), p(0, b, true), p(size, b, true), p(size, t, true), p(to, t));
}

const ringSize = (g: DrawContext) => Math.max(10, 2 * g.h + 6);

/** The turning arrows' ring: wider, so its gap and a smaller head stay clear of the cut corners. */
const turnSize = (g: DrawContext) => ringSize(g) + 2 + g.v;
/** The turning arrows' head: its arms reach clearly past the ring's bar at every weight. */
const turnHead = (g: DrawContext) => Math.max(2.5, g.h + 1);

export const ARROWS_MORE: GlyphDef[] = [
  def('longleftarrow', 0x27f5, () => mirror(arrowRight({ end: true }, LONG), LONG / 2)),
  def('longrightarrow', 0x27f6, () => arrowRight({ end: true }, LONG)),
  def('longleftrightarrow', 0x27f7, () => arrowRight({ start: true, end: true }, LONG)),
  def('longleftdblarrow', 0x27f8, (g) => {
    const { strokes, length } = doubleArrowRight(g, { end: true }, LONG + 2);
    return mirror(strokes, length / 2);
  }),
  def('longrightdblarrow', 0x27f9, (g) => doubleArrowRight(g, { end: true }, LONG + 2).strokes),
  def('longleftrightdblarrow', 0x27fa, (g) => doubleArrowRight(g, { start: true, end: true }, LONG + 2).strokes),
  def('arrowrightoverleft', 0x21c4, (g) => paired(g, { end: true }, { end: true }, true)),
  def('arrowupleftofdown', 0x21c5, (g) => rotate(paired(g, { end: true }, { end: true }, true), 90, ARROW_LENGTH / 2, MATH_AXIS)),
  def('arrowleftoverright', 0x21c6, (g) => mirror(paired(g, { end: true }, { end: true }, true), ARROW_LENGTH / 2)),
  def('arrowleftpaired', 0x21c7, (g) => mirror(paired(g, { end: true }, { end: true }, false), ARROW_LENGTH / 2)),
  def('arrowuppaired', 0x21c8, (g) => rotate(paired(g, { end: true }, { end: true }, false), 90, ARROW_LENGTH / 2, MATH_AXIS)),
  def('arrowrightpaired', 0x21c9, (g) => paired(g, { end: true }, { end: true }, false)),
  def('arrowdownpaired', 0x21ca, (g) => rotate(paired(g, { end: true }, { end: true }, false), -90, ARROW_LENGTH / 2, MATH_AXIS)),
  def('arrowleftdashed', 0x21e0, (g) => mirror(dashed(g), dashedLength(g) / 2)),
  def('arrowupdashed', 0x21e1, (g) => rotate(dashed(g), 90, dashedLength(g) / 2, MATH_AXIS)),
  def('arrowrightdashed', 0x21e2, (g) => dashed(g)),
  def('arrowdowndashed', 0x21e3, (g) => rotate(dashed(g), -90, dashedLength(g) / 2, MATH_AXIS)),
  // ⇤ ⇥ (Tab): the arrow's tip on a bar as tall as the head.
  // The bar stands just past the tip, so the head's outer point lies inside it and its arms meet clear of it.
  def('arrowlefttobar', 0x21e4, (g) => [...mirror(arrowRight(), ARROW_LENGTH / 2), stem(-g.v / 2, MATH_AXIS - HEAD - 0.5, MATH_AXIS + HEAD + 0.5)]),
  def('arrowrighttobar', 0x21e5, (g) => [...arrowRight(), stem(ARROW_LENGTH + g.v / 2, MATH_AXIS - HEAD - 0.5, MATH_AXIS + HEAD + 0.5)]),
  def('arrowleftwhite', 0x21e6, (g) => [closed(...whiteArrow(g).map((q) => p(12 - q.x, q.y)))]),
  def('arrowupwhite', 0x21e7, (g) => rotate([closed(...whiteArrow(g))], 90, 6, MATH_AXIS)),
  def('arrowrightwhite', 0x21e8, (g) => [closed(...whiteArrow(g))]),
  def('arrowdownwhite', 0x21e9, (g) => rotate([closed(...whiteArrow(g))], -90, 6, MATH_AXIS)),
  // ⇪ (Caps Lock): ⇧ shortened over a rectangle.
  def('capslock', 0x21ea, (g) => {
    const s = Math.max(1.75, g.v / 2 + 1);
    // Between the outlines' centre lines: a stroke and 1.4 units of white.
    const gap = g.h + 1.4;
    const arrow = rotate([closed(...whiteArrow(g, 9))], 90, 4.5, MATH_AXIS);
    const shift = (q: PathPoint) => ({ ...q, x: q.x + (6 - 4.5), y: q.y + 2.25 });
    const raised = arrow.map((st) => ({ ...st, points: st.points.map(shift) }));
    const bottom = MATH_AXIS - 4.5 + 2.25 - gap;
    return [...raised, closed(p(6 - s, bottom), p(6 + s, bottom), p(6 + s, bottom - 2 * s + g.h / 2), p(6 - s, bottom - 2 * s + g.h / 2))];
  }),
  // ↩ ↪: the arrow, its tail hooked up and back, the hook's corners cut where it would curve.
  def('arrowhookleft', 0x21a9, () => {
    const y = MATH_AXIS - 1.5;
    return [open(p(ARROW_LENGTH - 4, y + 4.5), p(ARROW_LENGTH, y + 4.5, true), p(ARROW_LENGTH, y, true), p(HEAD / 2, y)), headAt(0, y, 'left')];
  }),
  def('arrowhookright', 0x21aa, () => {
    const y = MATH_AXIS - 1.5;
    return mirror([open(p(ARROW_LENGTH - 4, y + 4.5), p(ARROW_LENGTH, y + 4.5, true), p(ARROW_LENGTH, y, true), p(HEAD / 2, y)), headAt(0, y, 'left')], ARROW_LENGTH / 2);
  }),
  // ↰ ↱ ↲ ↳ ↴ ↵ ⤴ ⤵: one stroke turning a right angle into its head.
  def('arrowuptipleft', 0x21b0, () => bent([[9, MATH_AXIS - 5], [9, MATH_AXIS + 3], [0, MATH_AXIS + 3]], 'left')),
  def('arrowuptipright', 0x21b1, () => bent([[0, MATH_AXIS - 5], [0, MATH_AXIS + 3], [9, MATH_AXIS + 3]], 'right')),
  def('arrowdowntipleft', 0x21b2, () => bent([[9, MATH_AXIS + 5], [9, MATH_AXIS - 3], [0, MATH_AXIS - 3]], 'left')),
  def('arrowdowntipright', 0x21b3, () => bent([[0, MATH_AXIS + 5], [0, MATH_AXIS - 3], [9, MATH_AXIS - 3]], 'right')),
  def('arrowrightdown', 0x21b4, () => bent([[0, MATH_AXIS + 3], [8, MATH_AXIS + 3], [8, MATH_AXIS - 5]], 'down')),
  def('arrowcornerdownleft', 0x21b5, () => bent([[9, MATH_AXIS + 5], [9, MATH_AXIS - 2], [0, MATH_AXIS - 2]], 'left')),
  def('arrowrightcurveup', 0x2934, () => bent([[0, MATH_AXIS - 3], [8, MATH_AXIS - 3], [8, MATH_AXIS + 5]], 'up', true)),
  def('arrowrightcurvedown', 0x2935, () => bent([[0, MATH_AXIS + 3], [8, MATH_AXIS + 3], [8, MATH_AXIS - 5]], 'down', true)),
  // ↶ ↷: an arch, cut where it would curve, ending in a head pointing down.
  def('arrowanticlockwisetop', 0x21b6, (g) => bent([[10, MATH_AXIS - 2], [10, MATH_AXIS + 4 - g.h / 2], [2, MATH_AXIS + 4 - g.h / 2], [2, MATH_AXIS - 4]], 'down', true)),
  def('arrowclockwisetop', 0x21b7, (g) => bent([[0, MATH_AXIS - 2], [0, MATH_AXIS + 4 - g.h / 2], [8, MATH_AXIS + 4 - g.h / 2], [8, MATH_AXIS - 4]], 'down', true)),
  // ↺ ↻: the broken ring with a head on one end, turning the way the arrow says.
  def('arrowanticlockwiseopen', 0x21ba, (g) => {
    const size = turnSize(g);
    const [c, t] = [size / 2, MATH_AXIS + size / 2 - g.h / 2];
    return [brokenRing(g, size, c - 1, c + 1 + turnHead(g) / 2), headAt(c + 1, t, 'left', turnHead(g))];
  }),
  def('arrowclockwiseopen', 0x21bb, (g) => {
    const size = turnSize(g);
    const [c, t] = [size / 2, MATH_AXIS + size / 2 - g.h / 2];
    return [brokenRing(g, size, c - 1 - turnHead(g) / 2, c + 1), headAt(c - 1, t, 'right', turnHead(g))];
  }),
  // ➔ the heavy arrow: one solid shape, a broad 45° head on a stout shaft.
  def('heavyarrowright', 0x2794, (g) => {
    const s = 1.25 + g.v / 2;
    const h = s + 3;
    const y = MATH_AXIS;
    return [solid([p(0, y - s), p(12 - h, y - s), p(12 - h, y - h), p(12, y), p(12 - h, y + h), p(12 - h, y + s), p(0, y + s)], 0.001)];
  }),
];

export const KEYS: GlyphDef[] = [
  // ⌘ four loops on the corners of a square, the loops grown with the stroke so they stay open.
  def('command', 0x2318, (g) => {
    const r = Math.max(3.5, Math.max(g.v, g.h) + 2.5);
    const s = 4;
    const y0 = MATH_AXIS - r - s / 2;
    // Each loop is cut on its three outer corners; the inner one is the square's corner, where the lines run on.
    const loop = (x: number, y: number, cuts: [boolean, boolean, boolean, boolean]) => box(x, x + r, y, y + r, cuts);
    return [
      loop(0, y0, [true, true, false, true]),
      loop(r + s, y0, [true, true, true, false]),
      loop(r + s, y0 + r + s, [false, true, true, true]),
      loop(0, y0 + r + s, [true, false, true, true]),
      box(r, r + s, y0 + r, y0 + r + s, [false, false, false, false]),
    ];
  }),
  // ⌥ the switch: a bar, a 45° fall, a bar, and the bar it leaves behind.
  def('option', 0x2325, (g) => {
    const [t, b] = [g.top(MATH_AXIS + 4), g.bottom(MATH_AXIS - 4)];
    const fall = t - b;
    return [open(p(0, t), p(3, t), p(3 + fall, b), p(6 + fall, b)), bar(3 + fall - 0.5, 6 + fall, t)];
  }),
  // ⌃ the up arrowhead alone.
  def('control', 0x2303, () => [headAt(HEAD, MATH_AXIS + 3, 'up')]),
  def('erasetotheleft', 0x232b, (g) => {
    const h = 5 - g.h / 2;
    const y = MATH_AXIS;
    const x = 2.25;
    return [
      closed(p(0, y), p(h, y + h), p(14, y + h), p(14, y - h), p(h, y - h)),
      withPen(open(p(h + 4 - x, y - x), p(h + 4 + x, y + x)), g.diag),
      withPen(open(p(h + 4 - x, y + x), p(h + 4 + x, y - x)), g.diag),
    ];
  }),
  def('erasetotheright', 0x2326, (g) => {
    const h = 5 - g.h / 2;
    const y = MATH_AXIS;
    const x = 2.25;
    return mirror(
      [
        closed(p(0, y), p(h, y + h), p(14, y + h), p(14, y - h), p(h, y - h)),
        withPen(open(p(h + 4 - x, y - x), p(h + 4 + x, y + x)), g.diag),
        withPen(open(p(h + 4 - x, y + x), p(h + 4 + x, y - x)), g.diag),
      ],
      7,
    );
  }),
  // ⎋ (Escape): the ring open at its upper left, an arrow leaving through the gap, its tip outside the ring.
  def('escape', 0x238b, (g) => {
    const size = ringSize(g);
    const c = size / 2;
    const [t, b] = [MATH_AXIS + c - g.h / 2, MATH_AXIS - c + g.h / 2];
    // The head stands clear of the ring: a stroke and a gap above its top, and as far left of its side.
    const [tx, ty] = [-(g.v + 1.2), t + g.h + 1.2];
    const arm = 2.5 + g.v / 2;
    // The shaft stops where its end lies inside both arms, which moves back as the stroke grows.
    const back = (0.75 + g.v / 2) / Math.SQRT2;
    return [
      open(p(c, t), p(size, t, true), p(size, b, true), p(0, b, true), p(0, MATH_AXIS)),
      // At 45° from the tip, which the arms are set to, starting level with the ring's centre.
      withPen(open(p(tx + (c - tx + ty - MATH_AXIS) / 2, ty - (c - tx + ty - MATH_AXIS) / 2), p(tx + back, ty - back)), g.diag),
      open(p(tx, ty - arm), p(tx, ty), p(tx + arm, ty)),
    ];
  }),
  // ⏏ (Eject): an outlined triangle over a bar.
  def('eject', 0x23cf, (g) => {
    const w = Math.max(10, 3 * g.v + 4);
    const b = MATH_AXIS - 1;
    return [closed(p(0, b), p(w / 2, b + w / 2), p(w, b)), bar(0, w, b - g.h - 1.4)];
  }),
  // ⌂ the house, one outline with a 45° roof.
  def('house', 0x2302, (g) => {
    const w = 10;
    const [b, eave] = [g.bottom(0), 5];
    return [closed(p(0, b), p(0, eave), p(w / 2, eave + w / 2), p(w, eave), p(w, b))];
  }),
  // ⎈ (Control on some keyboards): a ring with four spokes through it and four more inside, kept off its cut corners.
  def('helm', 0x2388, (g) => {
    const size = ringSize(g);
    const c = size / 2;
    const r = c + g.v / 2 + 2.25;
    const d = (c - g.h - 0.9 - g.diag.v / 2) * 0.9;
    return [
      box(0, size, MATH_AXIS - c + g.h / 2, MATH_AXIS + c - g.h / 2, ALL),
      bar(c - r, c + r, MATH_AXIS),
      stem(c, MATH_AXIS - r, MATH_AXIS + r),
      withPen(open(p(c - d, MATH_AXIS - d), p(c + d, MATH_AXIS + d)), g.diag),
      withPen(open(p(c - d, MATH_AXIS + d), p(c + d, MATH_AXIS - d)), g.diag),
    ];
  }),
  // ⏻ (Power): the broken ring with the bar through its gap; ⏼ the ring whole, the bar inside.
  def('power', 0x23fb, (g) => {
    const size = ringSize(g);
    const c = size / 2;
    const gap = 1 + g.v;
    return [brokenRing(g, size + 2, c + 1 - gap, c + 1 + gap), stem(c + 1, MATH_AXIS, MATH_AXIS + c + 2.5)];
  }),
  def('poweronoff', 0x23fc, (g) => {
    const size = ringSize(g);
    const c = size / 2;
    return [box(0, size, MATH_AXIS - c + g.h / 2, MATH_AXIS + c - g.h / 2, ALL), stem(c, MATH_AXIS - c + g.h + 1.5, MATH_AXIS + c - g.h - 1.5)];
  }),
];

/** Keys that are another sign under their own code point. */
export const KEYS_ALIASES: PlacedDef[] = [
  { name: 'diameter', unicode: 0x2300, parts: [{ glyph: 'emptyset' }] },
  { name: 'return', unicode: 0x23ce, parts: [{ glyph: 'arrowcornerdownleft' }] },
];
