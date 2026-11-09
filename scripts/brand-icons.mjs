#!/usr/bin/env node
/**
 * Draws the extension's and the Safari app's icons from the logomarks in
 * `assets/brand/`: `pnpm brand:icons` after a mark changes.
 *
 * `geld-logomark.svg` is drawn on a 24 × 25 grid, so at 32px it is drawn at
 * 1px per unit and every straight edge lands on a pixel. Light on dark reads
 * bolder, so the white toolbar icons draw `geld-logomark-white.svg`, its
 * dark-mode cut (every edge 0.2 units in). At 16px a unit is under a pixel, so
 * both colours draw `geld-logomark-grid.svg`, the same mark on a 14-unit grid
 * where every band, gap and block is 2 units, at 1px per unit. Keep the marks
 * in step.
 *
 * Chrome and Edge cannot tell a light toolbar from a dark one, so they get the
 * framed toolbar icon: the black mark on a white plate of its own outline, one
 * grid unit wider all round, filling its box. The extension's own icons wear
 * the same plate.
 *
 * The Mac icons keep the tile Xcode's converter drew around the extension's
 * icon and replace only the icon, which fills the middle 60% of it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_ICONS = path.join(ROOT, 'apps/extension/public/icon');
const SAFARI_APP = path.join(ROOT, 'apps/extension/safari/Geld/Shared (App)');
const APP_ICONSET = path.join(SAFARI_APP, 'Assets.xcassets/AppIcon.appiconset');

/** The Safari app's tile: white, its corners rounded by a fifth of its side. */
const TILE_RADIUS = 0.2;
/** The mark's height on that tile from 128px up, as a share of the tile's side. */
const MARK_ON_TILE = 0.62;
/** The mark's height in the 48px toolbar icon, which has no whole-pixel scale that fits. */
const MARK_AT_48 = 44;
/** The corner cuts of `geld-logomark.svg` and `geld-logomark-grid.svg`, in their units: mirror the marks. */
const MARK_CUT = 6;
const GRID_CUT = 3;
/** The plate's margin around the mark: one unit of the grid mark, as a share of the mark's width. */
const PLATE_MARGIN = 1 / 14;
/** The mark's height on the iOS icon's plain white square, which iOS rounds itself. */
const MARK_ON_SQUARE = 0.5;
/** The extension's icon inside Xcode's Mac tile: centred, at this share of its side. */
const MAC_INNER = 0.6;

async function readMark(file) {
  const svg = await readFile(path.join(ROOT, 'assets/brand', file), 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const [, , width, height] = (viewBox ?? '').split(/\s+/).map(Number);
  const paths = [...svg.matchAll(/<path\s+d="([^"]+)"/g)].map((match) => match[1]);
  if (!width || !height || paths.length === 0) throw new Error(`${file} needs a viewBox and paths`);
  return { width, height, paths };
}

/** A `size` px icon holding `mark` at `scale` px per unit, centred, its offset rounded down to a whole pixel when `snap`. */
function icon(size, mark, { scale, fill = '#000000', tile = false, background, snap = false }) {
  const round = snap ? Math.floor : (n) => n;
  const x = round((size - mark.width * scale) / 2);
  const y = round((size - mark.height * scale) / 2);
  const radius = TILE_RADIUS * size;
  const behind = [
    background === undefined ? '' : `<rect width="${size}" height="${size}" fill="${background}"/>`,
    tile ? `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#ffffff"/>` : '',
  ].join('');
  const body = mark.paths.map((d) => `<path d="${d}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${behind}<g transform="translate(${x} ${y}) scale(${scale})" fill="${fill}">${body}</g></svg>`;
  const image = sharp(Buffer.from(svg), { density: 72 });
  // App Store Connect refuses an iOS icon with an alpha channel, even a fully opaque one.
  return (background === undefined ? image : image.removeAlpha()).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * A `size` px icon: `mark` on a white plate that is its outline grown by `PLATE_MARGIN` all round, as large as fits,
 * centred. Growing a 45° cut by `d` lengthens its legs by `d(2 − √2)`, so the plate's cuts stay concentric with the mark's.
 */
function framed(size, mark, cut) {
  const d = PLATE_MARGIN * mark.width;
  const width = mark.width + 2 * d;
  const height = mark.height + 2 * d;
  const scale = size / Math.max(width, height);
  const leg = cut + d * (2 - Math.SQRT2);
  const plate = `M${leg} 0H${width}V${height - leg}L${width - leg} ${height}H0V${leg}Z`;
  const x = (size - width * scale) / 2;
  const y = (size - height * scale) / 2;
  const body = mark.paths.map((path) => `<path d="${path}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(${x} ${y}) scale(${scale})"><path d="${plate}" fill="#ffffff"/><g transform="translate(${d} ${d})" fill="#000000">${body}</g></g></svg>`;
  return sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 }).toBuffer();
}

async function write(file, buffer) {
  await writeFile(file, buffer);
  console.log(path.relative(ROOT, file));
}

const light = await readMark('geld-logomark.svg');
const dark = await readMark('geld-logomark-white.svg');
const grid = await readMark('geld-logomark-grid.svg');

// Toolbar: the bare mark, black for light toolbars, white (the dark-mode cut) for dark ones.
for (const [color, fill, mark] of [['black', '#000000', light], ['white', '#ffffff', dark]]) {
  await write(path.join(EXTENSION_ICONS, 'action', `${color}-16.png`), await icon(16, grid, { scale: 1, fill, snap: true }));
  await write(path.join(EXTENSION_ICONS, 'action', `${color}-32.png`), await icon(32, mark, { scale: 1, fill, snap: true }));
  await write(path.join(EXTENSION_ICONS, 'action', `${color}-48.png`), await icon(48, mark, { scale: MARK_AT_48 / mark.height, fill }));
}

// Chrome and Edge's toolbar, and the extension's own icons: the framed mark, the grid mark at 1, 2 and 3px per unit.
for (const size of [16, 32, 48]) {
  const buffer = await framed(size, grid, GRID_CUT);
  await write(path.join(EXTENSION_ICONS, 'action', `framed-${size}.png`), buffer);
  if (size !== 48) await write(path.join(EXTENSION_ICONS, `${size}.png`), buffer);
}
for (const size of [128, 256, 512]) await write(path.join(EXTENSION_ICONS, `${size}.png`), await framed(size, light, MARK_CUT));

// The Safari app keeps the mark on its rounded white tile, on its page, its launch screen and inside Xcode's Mac tile.
const tiles = new Map();
for (const size of [256, 512]) tiles.set(size, await icon(size, light, { scale: (MARK_ON_TILE * size) / light.height, tile: true }));
await write(path.join(SAFARI_APP, 'Resources/Icon.png'), tiles.get(512));
await write(path.join(SAFARI_APP, 'Assets.xcassets/LargeIcon.imageset/256.png'), tiles.get(256));

// Mac: Xcode's tile, the extension's icon replaced in its middle.
const iconset = JSON.parse(await readFile(path.join(APP_ICONSET, 'Contents.json'), 'utf8'));
for (const image of iconset.images) {
  if (image.idiom !== 'mac' || image.filename === undefined) continue;
  const file = path.join(APP_ICONSET, image.filename);
  const side = Number(image.size.split('x')[0]) * Number(image.scale.replace('x', ''));
  const inner = Math.round(MAC_INNER * side);
  const offset = Math.round((side - inner) / 2);
  const resized = await sharp(tiles.get(512)).resize(inner, inner, { kernel: 'lanczos3' }).toBuffer();
  await write(file, await sharp(await readFile(file)).composite([{ input: resized, left: offset, top: offset }]).png({ compressionLevel: 9 }).toBuffer());
}

// iOS: a plain white square, which iOS masks to its own shape.
await write(path.join(APP_ICONSET, 'universal-icon-1024@1x.png'), await icon(1024, light, { scale: (MARK_ON_SQUARE * 1024) / light.height, background: '#ffffff' }));
