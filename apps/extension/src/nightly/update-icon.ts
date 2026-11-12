import { browser } from 'wxt/browser';
import { actionIconPaths } from '../lib/action-icon';

/**
 * The toolbar icon while a newer build waits or installs: the mark with its inner spiral turned into an arrow
 * pointing down, black while it waits, then filling with green from the outer end at the top right, around the
 * spiral and down the arrow, as the update runs. Chrome and Edge show the framed icon on any toolbar, the mark
 * on its white plate, so one green reads in light and dark themes alike.
 *
 * The icon is rasterized here rather than drawn on a canvas. A green copy of the mark laid over the black one
 * leaves a dark fringe on every anti-aliased edge, and a stroke along the band misses the corners where its
 * 45° cuts make it wider. Each of 64 samples per pixel is tested against the exact polygon and coloured by how
 * far along the band it lies, so the green takes the mark's own edges and only the front between green and
 * black is a new edge.
 */

export type UpdateIcon = { readonly kind: 'plain' } | { readonly kind: 'ready' } | { readonly kind: 'progress'; readonly share: number };

type Point = readonly [number, number];

const GREEN = [26, 127, 55] as const;
const SIZES = [16, 32, 48] as const;
const SAMPLES = 8;
/** The framed icon is the mark plus one grid unit of plate all round (`framed()` in scripts/brand-icons.mjs). */
const PLATE_UNITS = 16;

/**
 * `geld-logomark-grid.svg` (`M14 0H3L0 3V14H11L14 11V4H5L4 5V10…`) with the band that comes in from the right
 * edge turning down at the middle into an arrow, `…V4H7L6 5V8H4L6 10H8L10 8H8V6H12V10…`. The arrow keeps the
 * mark's 2-unit band and 2-unit gaps and cuts its head at 45°, as the mark cuts its corners.
 */
export const DOWNLOAD_MARK: readonly Point[] = [
  [14, 0],
  [3, 0],
  [0, 3],
  [0, 14],
  [11, 14],
  [14, 11],
  [14, 4],
  [7, 4],
  [6, 5],
  [6, 8],
  [4, 8],
  [6, 10],
  [8, 10],
  [10, 8],
  [8, 8],
  [8, 6],
  [12, 6],
  [12, 10],
  [10, 12],
  [2, 12],
  [2, 4],
  [4, 2],
  [14, 2],
];

/**
 * The band's legs, from its outer end to the arrow's tip, along its middle. A point of the mark belongs to the
 * first leg whose strip holds it (`inner` and `outer` from the middle, toward and away from the centre) and
 * that it has not turned past. The outer legs reach 2 inward for the corners their 45° cuts widen, and the
 * last reaches 3 for the arrow's head.
 */
interface Leg {
  readonly from: Point;
  readonly to: Point;
  readonly inner: number;
  readonly outer: number;
}

export const LEGS: readonly Leg[] = [
  { from: [14, 1], to: [1, 1], inner: 2, outer: 1.5 },
  { from: [1, 1], to: [1, 13], inner: 2, outer: 1.5 },
  { from: [1, 13], to: [13, 13], inner: 2, outer: 1.5 },
  { from: [13, 13], to: [13, 5], inner: 2, outer: 1.5 },
  { from: [13, 5], to: [7, 5], inner: 2, outer: 1.5 },
  { from: [7, 5], to: [7, 10], inner: 3, outer: 3 },
];

function direction(leg: Leg): Point {
  const length = Math.hypot(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]);
  return [(leg.to[0] - leg.from[0]) / length, (leg.to[1] - leg.from[1]) / length];
}

function lengthOf(leg: Leg): number {
  return Math.hypot(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]);
}

export const BAND_LENGTH = /* @__PURE__ */ LEGS.reduce((sum, leg) => sum + lengthOf(leg), 0);

function inPolygon(x: number, y: number, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let at = 0, before = polygon.length - 1; at < polygon.length; before = at++) {
    const [ax, ay] = polygon[at] ?? [0, 0];
    const [bx, by] = polygon[before] ?? [0, 0];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** How far along the band a point of the mark lies, 0 at the outer end and `BAND_LENGTH` at the tip; null outside the mark. */
export function bandPosition(x: number, y: number): number | null {
  if (!inPolygon(x, y, DOWNLOAD_MARK)) return null;
  let before = 0;
  for (const [at, leg] of LEGS.entries()) {
    const [dx, dy] = direction(leg);
    const across = (x - leg.from[0]) * dy - (y - leg.from[1]) * dx;
    const along = (x - leg.from[0]) * dx + (y - leg.from[1]) * dy;
    const previous = LEGS[at - 1];
    const next = LEGS[at + 1];
    // Past a turn means further along the leg after it than back along the leg before it: the corner's bisector.
    const started = previous === undefined || turnedPast(x, y, previous, leg);
    const ended = next !== undefined && turnedPast(x, y, leg, next);
    if (across <= leg.inner && across >= -leg.outer && started && !ended) return before + Math.min(Math.max(along, 0), lengthOf(leg));
    before += lengthOf(leg);
  }
  return null;
}

function turnedPast(x: number, y: number, from: Leg, to: Leg): boolean {
  const [ax, ay] = direction(from);
  const [bx, by] = direction(to);
  return (x - to.from[0]) * (ax + bx) + (y - to.from[1]) * (ay + by) > 0;
}

function platePolygon(): readonly Point[] {
  const leg = 3 + (2 - Math.SQRT2);
  return [
    [leg, 0],
    [PLATE_UNITS, 0],
    [PLATE_UNITS, PLATE_UNITS - leg],
    [PLATE_UNITS - leg, PLATE_UNITS],
    [0, PLATE_UNITS],
    [0, leg],
  ];
}

const OUTSIDE = -2;
const PLATE = -1;
const sampleMaps = /* @__PURE__ */ new Map<number, Float32Array>();

/** Per sample: outside the icon, on the plate, or on the mark at that band position. Fixed per size, so worked out once. */
function sampleMap(size: number): Float32Array {
  const known = sampleMaps.get(size);
  if (known !== undefined) return known;
  const plate = platePolygon();
  const unit = size / PLATE_UNITS;
  const map = new Float32Array(size * size * SAMPLES * SAMPLES);
  let at = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / unit;
          const y = (py + (sy + 0.5) / SAMPLES) / unit;
          const position = bandPosition(x - 1, y - 1);
          map[at++] = position ?? (inPolygon(x, y, plate) ? PLATE : OUTSIDE);
        }
      }
    }
  }
  sampleMaps.set(size, map);
  return map;
}

/** RGBA, unpremultiplied as `ImageData` wants it; `share` of the band green, 0 for the black arrow. */
export function renderUpdateIcon(size: number, share: number): Uint8ClampedArray<ArrayBuffer> {
  const map = sampleMap(size);
  const reach = Math.min(1, Math.max(0, share)) * BAND_LENGTH;
  const full = share >= 1;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const perPixel = SAMPLES * SAMPLES;
  for (let pixel = 0; pixel < size * size; pixel++) {
    let green = 0;
    let black = 0;
    let white = 0;
    for (let at = pixel * perPixel; at < (pixel + 1) * perPixel; at++) {
      const value = map[at] ?? OUTSIDE;
      if (value === OUTSIDE) continue;
      if (value === PLATE) white++;
      else if (full || value < reach) green++;
      else black++;
    }
    const covered = green + black + white;
    if (covered === 0) continue;
    const out = pixel * 4;
    pixels[out] = (green * GREEN[0] + white * 255) / covered;
    pixels[out + 1] = (green * GREEN[1] + white * 255) / covered;
    pixels[out + 2] = (green * GREEN[2] + white * 255) / covered;
    pixels[out + 3] = (covered / perPixel) * 255;
  }
  return pixels;
}

/** Whole percents, so a download reporting every chunk repaints the icon at most a hundred times. */
export function iconKey(icon: UpdateIcon): string {
  return icon.kind === 'progress' ? `progress:${Math.round(Math.min(1, Math.max(0, icon.share)) * 100)}` : icon.kind;
}

let painted: string | null = null;
let wanted: UpdateIcon = { kind: 'plain' };
let draining = false;

async function paint(icon: UpdateIcon): Promise<void> {
  const key = iconKey(icon);
  if (key === painted) return;
  if (icon.kind === 'plain') {
    await browser.action.setIcon({ path: actionIconPaths('framed') });
  } else {
    const share = icon.kind === 'ready' ? 0 : icon.share;
    const imageData: Record<string, ImageData> = {};
    for (const size of SIZES) imageData[String(size)] = new ImageData(renderUpdateIcon(size, share), size, size);
    await browser.action.setIcon({ imageData });
  }
  painted = key;
}

/**
 * Paints run one at a time and only the latest asked for is painted next, so a fast download never queues up
 * frames. A paint that fails ends the run unrecorded, so the next request for that state tries again rather than
 * this one looping.
 */
export function showUpdateIcon(icon: UpdateIcon): void {
  wanted = icon;
  if (draining) return;
  draining = true;
  void drain().catch(() => undefined);
}

async function drain(): Promise<void> {
  try {
    while (iconKey(wanted) !== painted) await paint(wanted);
  } finally {
    draining = false;
  }
}
