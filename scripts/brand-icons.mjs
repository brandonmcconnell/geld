#!/usr/bin/env node
/**
 * Draws the extension's and the Safari app's icons from the logomarks in
 * `assets/brand/`: `pnpm brand:icons` after a mark changes.
 *
 * `geld-logomark.svg` is drawn on a 24 × 25 grid, so at 32px it is drawn at
 * 1px per unit and every straight edge lands on a pixel. At 16px a unit is
 * under a pixel, so the 16px icons draw `geld-logomark-grid.svg`, the same
 * mark on a 14-unit grid where every band, gap and block is 2 units, at 1px
 * per unit. Keep the marks in step.
 *
 * The toolbar icon is the grid mark on a white plate of its own shape, one
 * unit wider all round, at 1, 2 and 3px per unit: it reads on light and dark
 * toolbars alike, whatever theme the browser wears, and fills its box.
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

/** The tile the extension's icons sit on: white, its corners rounded by a fifth of its side. */
const TILE_RADIUS = 0.2;
/** The mark's height on that tile from 128px up, as a share of the tile's side. */
const MARK_ON_TILE = 0.62;
/** The corner cuts of `geld-logomark-grid.svg`, in its units: mirror the mark. */
const GRID_CUT = 3;
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
 * A `size` px toolbar icon: the grid mark at `scale` px per unit on a white plate that is the mark's own outline
 * grown by one unit all round. Growing a 45° cut by `d` lengthens its legs by `d(2 − √2)`, so the plate's cuts stay
 * concentric with the mark's.
 */
function framed(size, mark, scale) {
  const side = mark.width + 2;
  const cut = GRID_CUT + 2 - Math.SQRT2;
  const plate = `M${cut} 0H${side}V${side - cut}L${side - cut} ${side}H0V${cut}Z`;
  const body = mark.paths.map((d) => `<path d="${d}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="scale(${scale})"><path d="${plate}" fill="#ffffff"/><g transform="translate(1 1)" fill="#000000">${body}</g></g></svg>`;
  return sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 }).toBuffer();
}

async function write(file, buffer) {
  await writeFile(file, buffer);
  console.log(path.relative(ROOT, file));
}

const light = await readMark('geld-logomark.svg');
const grid = await readMark('geld-logomark-grid.svg');

// Toolbar: the framed grid mark, one icon for light and dark toolbars alike, filling its box.
if (grid.width !== grid.height) throw new Error('geld-logomark-grid.svg must be square');
for (const size of [16, 32, 48]) {
  await write(path.join(EXTENSION_ICONS, 'action', `${size}.png`), await framed(size, grid, size / (grid.width + 2)));
}

// Safari tints toolbar icons as templates from their alpha alone, so it keeps the bare black mark.
await write(path.join(EXTENSION_ICONS, 'action', 'black-16.png'), await icon(16, grid, { scale: 1, snap: true }));
await write(path.join(EXTENSION_ICONS, 'action', 'black-32.png'), await icon(32, light, { scale: 1, snap: true }));
await write(path.join(EXTENSION_ICONS, 'action', 'black-48.png'), await icon(48, light, { scale: 44 / light.height }));

// The extension's icons: the mark on its white tile.
const tiles = new Map();
tiles.set(16, await icon(16, grid, { scale: 1, tile: true, snap: true }));
tiles.set(32, await icon(32, light, { scale: 1, tile: true, snap: true }));
for (const size of [128, 256, 512]) tiles.set(size, await icon(size, light, { scale: (MARK_ON_TILE * size) / light.height, tile: true }));
for (const [size, buffer] of tiles) await write(path.join(EXTENSION_ICONS, `${size}.png`), buffer);

// The Safari app shows the extension's icon on its page and its launch screen.
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
