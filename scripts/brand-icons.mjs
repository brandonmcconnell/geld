#!/usr/bin/env node
/**
 * Draws the extension's and the Safari app's icons from the logomark in
 * `assets/brand/geld-logomark.svg`: `pnpm brand:icons` after the mark changes.
 *
 * Sizes from 128px up draw the mark's own paths. Below that its bands, about
 * 3.8 of its 24 units, would fall between pixels, so the small icons draw
 * `geld-logomark-grid.svg`, the same mark on a 14-unit grid where every band,
 * gap and block is 2 units, at a whole or half number of pixels per unit so
 * every straight edge lands on a pixel. Keep the two marks in step.
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
/** The mark's height on that tile, as a share of the tile's side. */
const MARK_ON_TILE = 0.62;
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

/** An SVG of `size` px holding `content` drawn at `scale` px per unit from (`x`, `y`). */
function canvas(size, content, { scale, x, y, fill, tile = false }) {
  const radius = TILE_RADIUS * size;
  const background = tile ? `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#ffffff"/>` : '';
  const body = content.map((d) => `<path d="${d}"/>`).join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background}<g transform="translate(${x} ${y}) scale(${scale})" fill="${fill}">${body}</g></svg>`,
  );
}

function png(svg) {
  return sharp(svg, { density: 72 }).png({ compressionLevel: 9 }).toBuffer();
}

/** The grid mark at `perUnit` px per unit, centred (rounded down to a whole pixel). */
function gridIcon(size, perUnit, fill, tile = false) {
  const offset = Math.floor((size - grid.height * perUnit) / 2);
  return png(canvas(size, grid.paths, { scale: perUnit, x: offset, y: offset, fill, tile }));
}

/** The logomark's own paths, `share` of `size` tall and centred. */
function vectorIcon(mark, size, share, { tile = false, background } = {}) {
  const scale = (share * size) / mark.height;
  const x = (size - mark.width * scale) / 2;
  const y = (size - mark.height * scale) / 2;
  let svg = canvas(size, mark.paths, { scale, x, y, fill: '#000000', tile });
  if (background !== undefined) svg = Buffer.from(svg.toString().replace('<g ', `<rect width="${size}" height="${size}" fill="${background}"/><g `));
  return png(svg);
}

async function write(file, buffer) {
  await writeFile(file, buffer);
  console.log(path.relative(ROOT, file));
}

const mark = await readMark('geld-logomark.svg');
const grid = await readMark('geld-logomark-grid.svg');

// Toolbar: the bare mark at 1, 2 and 3 px per grid unit, black for light toolbars and white for dark ones.
for (const [size, perUnit] of [[16, 1], [32, 2], [48, 3]]) {
  for (const [color, fill] of [['black', '#000000'], ['white', '#ffffff']]) {
    await write(path.join(EXTENSION_ICONS, 'action', `${color}-${size}.png`), await gridIcon(size, perUnit, fill));
  }
}

// The extension's icons: the mark on its white tile.
const tiles = new Map();
tiles.set(16, await gridIcon(16, 1, '#000000', true));
tiles.set(32, await gridIcon(32, 1.5, '#000000', true));
for (const size of [128, 256, 512]) tiles.set(size, await vectorIcon(mark, size, MARK_ON_TILE, { tile: true }));
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
  const icon = await sharp(tiles.get(512)).resize(inner, inner, { kernel: 'lanczos3' }).toBuffer();
  await write(file, await sharp(await readFile(file)).composite([{ input: icon, left: offset, top: offset }]).png({ compressionLevel: 9 }).toBuffer());
}

// iOS: a plain white square, which iOS masks to its own shape.
await write(path.join(APP_ICONSET, 'universal-icon-1024@1x.png'), await vectorIcon(mark, 1024, MARK_ON_SQUARE, { background: '#ffffff' }));
