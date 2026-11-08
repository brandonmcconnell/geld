/**
 * Renders glyphs straight from the masters, overlaps filled as one, for close visual review:
 *   tsx scripts/sheet.ts <out.png> <family> <style> <weight> <cell px> <glyph names…>
 * The family names the corner style: sans and dark are square-cornered, sans-cut and dark-cut cut. SVG=<file> also writes
 * the SVG, for a browser to render: librsvg drops fills where edges coincide (a square P's bowl on its stem).
 */
import sharp from 'sharp';
import { METRICS } from '../src/grid';
import { buildMaster, type Family, flatten, type Style } from '../src/master';
import type { Weight } from '../src/grid';

const [out, family, style, weight, cell, ...names] = process.argv.slice(2);
const master = buildMaster(family as Family, style as Style, Number(weight) as Weight);
const size = Number(cell);
const scale = size / 24;
const cols = Math.max(1, Math.min(names.length, Math.floor(2400 / size)));
const rows = Math.ceil(names.length / cols);
const paths: string[] = [];
names.forEach((name, i) => {
  const glyph = master.glyphs.find((g) => g.name === name);
  if (!glyph) return;
  const ox = (i % cols) * size + size * 0.15;
  const oy = Math.floor(i / cols) * size * 1.1 + size * 0.8;
  const d = flatten(master, glyph)
    .map((c) => 'M' + c.map((p) => `${(ox + p.x * scale).toFixed(2)} ${(oy - p.y * scale).toFixed(2)}`).join('L') + 'Z')
    .join('');
  paths.push(`<path d="${d}" fill="#000" fill-rule="nonzero"/>`);
  const base = oy;
  paths.push(`<line x1="${ox - 4}" x2="${ox + glyph.advance * scale + 4}" y1="${base}" y2="${base}" stroke="#e33" stroke-width="0.5"/>`);
  paths.push(`<line x1="${ox}" x2="${ox}" y1="${base}" y2="${base - METRICS.cap * scale}" stroke="#39f" stroke-width="0.5"/><line x1="${ox + glyph.advance * scale}" x2="${ox + glyph.advance * scale}" y1="${base}" y2="${base - METRICS.cap * scale}" stroke="#39f" stroke-width="0.5"/>`);
  paths.push(`<text x="${ox}" y="${base + size * 0.25}" font-size="${Math.max(9, size / 14)}" fill="#888" font-family="monospace">${name}</text>`);
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * size}" height="${rows * size * 1.1}"><rect width="100%" height="100%" fill="#fff"/>${paths.join('')}</svg>`;
if (process.env.SVG) (await import("node:fs")).writeFileSync(process.env.SVG, svg);
await sharp(Buffer.from(svg)).png().toFile(out!);
