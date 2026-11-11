import { browser } from 'wxt/browser';
import { actionIconPaths } from '../lib/action-icon';

/**
 * An update's progress drawn into the toolbar icon: the mark fills with green along its own spiral, from the
 * outer end at the top right to the centre. Chrome and Edge show the framed icon on any toolbar, the black mark
 * on its white plate, so one green reads in light and dark themes alike.
 */

const COLOR = '#1a7f37';
const SIZES = [16, 32, 48] as const;

/** `geld-logomark-grid.svg`, which the framed icons are drawn from (scripts/brand-icons.mjs): keep in step. */
const MARK = 'M14 0H3L0 3V14H11L14 11V4H5L4 5V10H9L10 9V8H6V6H12V10L10 12H2V4L4 2H14Z';
/** The framed icon is the mark plus one grid unit of plate all round. */
const PLATE_UNITS = 16;
const BAND = 2;

/** `framed()` in scripts/brand-icons.mjs: the mark's 3-unit cut grown by one unit keeps its cuts concentric. */
function platePath(): string {
  const leg = 3 + (2 - Math.SQRT2);
  return `M${leg} 0H${PLATE_UNITS}V${PLATE_UNITS - leg}L${PLATE_UNITS - leg} ${PLATE_UNITS}H0V${leg}Z`;
}

/** The middle of the mark's 2-unit band, in grid units, from its outer end to its inner one. */
export const SPIRAL: readonly (readonly [number, number])[] = [
  [14, 1],
  [1, 1],
  [1, 13],
  [13, 13],
  [13, 5],
  [5, 5],
  [5, 9],
  [10, 9],
];

/** The spiral's points up to `share` of its length: the green part of the mark. */
export function spiralTo(share: number): readonly (readonly [number, number])[] {
  const clamped = Math.min(1, Math.max(0, share));
  const lengths = SPIRAL.slice(1).map(([x, y], at) => {
    const [px, py] = SPIRAL[at] ?? [x, y];
    return Math.abs(x - px) + Math.abs(y - py);
  });
  let left = clamped * lengths.reduce((sum, length) => sum + length, 0);
  const first = SPIRAL[0];
  if (first === undefined || left <= 0) return [];
  const points: [number, number][] = [[first[0], first[1]]];
  for (const [at, length] of lengths.entries()) {
    const from = SPIRAL[at];
    const to = SPIRAL[at + 1];
    if (from === undefined || to === undefined) break;
    if (left >= length) {
      points.push([to[0], to[1]]);
      left -= length;
      continue;
    }
    const part = left / length;
    points.push([from[0] + (to[0] - from[0]) * part, from[1] + (to[1] - from[1]) * part]);
    break;
  }
  return points;
}

/** Whole percents, so a download reporting every chunk repaints the icon at most a hundred times. */
export function progressKey(share: number | null): string {
  return share === null ? 'none' : `progress:${Math.round(Math.min(1, Math.max(0, share)) * 100)}`;
}

function context2d(size: number): OffscreenCanvasRenderingContext2D {
  const context = new OffscreenCanvas(size, size).getContext('2d');
  if (context === null) throw new Error('No 2D context for the toolbar icon.');
  return context;
}

/**
 * Plate and mark are drawn here rather than over the framed PNG: green laid over the PNG's black left a dark
 * fringe on every anti-aliased edge. The green goes onto the mark's own layer (`source-atop`), so it takes the
 * mark's edges exactly, its 45° cuts included.
 */
function draw(size: (typeof SIZES)[number], share: number): ImageData {
  const unit = size / PLATE_UNITS;
  const mark = context2d(size);
  mark.setTransform(unit, 0, 0, unit, unit, unit);
  mark.fillStyle = '#000000';
  mark.fill(new Path2D(MARK));
  const points = spiralTo(share);
  if (points.length > 1) {
    mark.globalCompositeOperation = 'source-atop';
    mark.strokeStyle = COLOR;
    // Wider than the band, so the mark's own edges bound the green; the gaps between bands are wider than the overhang.
    mark.lineWidth = BAND + 1;
    mark.lineCap = 'butt';
    mark.lineJoin = 'miter';
    mark.beginPath();
    for (const [at, [x, y]] of points.entries()) {
      if (at === 0) mark.moveTo(x, y);
      else mark.lineTo(x, y);
    }
    mark.stroke();
  }
  const icon = context2d(size);
  icon.setTransform(unit, 0, 0, unit, 0, 0);
  icon.fillStyle = '#ffffff';
  icon.fill(new Path2D(platePath()));
  icon.setTransform(1, 0, 0, 1, 0, 0);
  icon.drawImage(mark.canvas, 0, 0);
  return icon.getImageData(0, 0, size, size);
}

let painted: string | null = null;
let wanted: number | null = null;
let draining = false;

async function paint(share: number | null): Promise<void> {
  const key = progressKey(share);
  if (key === painted) return;
  if (share === null) {
    await browser.action.setIcon({ path: actionIconPaths('framed') });
  } else {
    const imageData: Record<string, ImageData> = {};
    for (const size of SIZES) imageData[String(size)] = draw(size, share);
    await browser.action.setIcon({ imageData });
  }
  painted = key;
}

/**
 * `share` of the update done, 0 to 1, or null for the plain icon. Paints run one at a time and only the latest
 * asked for is painted next, so a fast download never queues up frames. A paint that fails ends the run
 * unrecorded, so the next request for that state tries again rather than this one looping.
 */
export function showIconProgress(share: number | null): void {
  wanted = share;
  if (draining) return;
  draining = true;
  void drain().catch(() => undefined);
}

async function drain(): Promise<void> {
  try {
    while (progressKey(wanted) !== painted) await paint(wanted);
  } finally {
    draining = false;
  }
}
