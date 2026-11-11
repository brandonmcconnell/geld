import { browser } from 'wxt/browser';
import { actionIconPaths } from '../lib/action-icon';

/**
 * The nightly build's mark on the toolbar icon, drawn into the icon itself: Chrome's own badge holds only text,
 * and it stays the tab's hidden-file count. `progress` is the share of an update done, 0 to 1.
 */
export type IconBadge = { readonly kind: 'none' } | { readonly kind: 'available' } | { readonly kind: 'progress'; readonly share: number } | { readonly kind: 'done' };

export const NO_BADGE: IconBadge = { kind: 'none' };

const COLOR = '#1a7f37';
/** Grey, so the unfilled part of the ring shows on a light toolbar and a dark one alike. */
const TRACK = 'rgba(140, 149, 159, 0.55)';
const SIZES = [16, 32] as const;
const BASE_PATHS = { 16: '/icon/action/framed-16.png', 32: '/icon/action/framed-32.png' } as const;

/** Whole percents, so a download reporting every chunk repaints the icon at most a hundred times. */
export function badgeKey(badge: IconBadge): string {
  return badge.kind === 'progress' ? `progress:${Math.round(Math.min(1, Math.max(0, badge.share)) * 100)}` : badge.kind;
}

/** Proportions of the icon's side, so every size draws the same shape. */
export interface BadgeGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly disc: number;
  readonly ring: number;
  readonly ringWidth: number;
  readonly cut: number;
}

/** Top right: Chrome draws the tab's count over the bottom right, and the two must not cover each other. */
export function badgeGeometry(size: number, withRing: boolean): BadgeGeometry {
  const outer = size * 0.38;
  const ringWidth = size * 0.085;
  const disc = outer - ringWidth - size * 0.04;
  return { cx: size - outer, cy: outer, disc, ring: outer - ringWidth / 2, ringWidth, cut: (withRing ? outer : disc) + size * 0.06 };
}

const bases = /* @__PURE__ */ new Map<number, Promise<ImageBitmap>>();

function base(size: (typeof SIZES)[number]): Promise<ImageBitmap> {
  let bitmap = bases.get(size);
  if (bitmap === undefined) {
    bitmap = fetch(browser.runtime.getURL(BASE_PATHS[size]))
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob));
    bitmap.catch(() => bases.delete(size));
    bases.set(size, bitmap);
  }
  return bitmap;
}

function glyph(context: OffscreenCanvasRenderingContext2D, size: number, kind: 'arrow' | 'check', { cx, cy, disc }: BadgeGeometry): void {
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(1.2, size * 0.09);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (kind === 'check') {
    context.moveTo(cx - disc * 0.48, cy + disc * 0.02);
    context.lineTo(cx - disc * 0.14, cy + disc * 0.38);
    context.lineTo(cx + disc * 0.5, cy - disc * 0.36);
    context.stroke();
    return;
  }
  context.moveTo(cx, cy - disc * 0.55);
  context.lineTo(cx, cy);
  context.stroke();
  // A filled head: at 16px a stroked one is two pixels wide and reads as a plus.
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.moveTo(cx - disc * 0.58, cy - disc * 0.08);
  context.lineTo(cx + disc * 0.58, cy - disc * 0.08);
  context.lineTo(cx, cy + disc * 0.62);
  context.closePath();
  context.fill();
}

async function draw(size: (typeof SIZES)[number], badge: Exclude<IconBadge, { kind: 'none' }>): Promise<ImageData> {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No 2D context for the toolbar icon.');
  context.drawImage(await base(size), 0, 0, size, size);
  const geometry = badgeGeometry(size, badge.kind === 'progress');
  const { cx, cy, disc, ring, ringWidth, cut } = geometry;
  context.globalCompositeOperation = 'destination-out';
  context.beginPath();
  context.arc(cx, cy, cut, 0, Math.PI * 2);
  context.fill();
  context.globalCompositeOperation = 'source-over';
  if (badge.kind === 'progress') {
    context.lineWidth = ringWidth;
    context.strokeStyle = TRACK;
    context.beginPath();
    context.arc(cx, cy, ring, 0, Math.PI * 2);
    context.stroke();
    const share = Math.min(1, Math.max(0, badge.share));
    if (share > 0) {
      context.strokeStyle = COLOR;
      context.beginPath();
      context.arc(cx, cy, ring, -Math.PI / 2, -Math.PI / 2 + share * Math.PI * 2);
      context.stroke();
    }
  }
  context.fillStyle = COLOR;
  context.beginPath();
  context.arc(cx, cy, disc, 0, Math.PI * 2);
  context.fill();
  glyph(context, size, badge.kind === 'done' ? 'check' : 'arrow', geometry);
  return context.getImageData(0, 0, size, size);
}

let painted: string | null = null;
let wanted: IconBadge = NO_BADGE;
let draining = false;

async function paint(badge: IconBadge): Promise<void> {
  const key = badgeKey(badge);
  if (key === painted) return;
  if (badge.kind === 'none') {
    await browser.action.setIcon({ path: actionIconPaths('framed') });
  } else {
    const imageData: Record<string, ImageData> = {};
    for (const size of SIZES) imageData[String(size)] = await draw(size, badge);
    await browser.action.setIcon({ imageData });
  }
  painted = key;
}

/** Paints run one at a time and only the latest asked for is painted next, so a fast download never queues up frames. */
export function showIconBadge(badge: IconBadge): void {
  wanted = badge;
  if (draining) return;
  draining = true;
  void drain();
}

async function drain(): Promise<void> {
  try {
    while (badgeKey(wanted) !== painted) {
      const next = wanted;
      try {
        await paint(next);
      } catch {
        painted = badgeKey(next);
      }
    }
  } finally {
    draining = false;
  }
}
