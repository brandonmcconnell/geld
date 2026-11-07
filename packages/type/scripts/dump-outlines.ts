/** Writes the contours (components drawn in) of every glyph with outlines of its own, for the given masters, as JSON for scripts/joins.py. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Weight } from '../src/grid';
import { buildMaster, type Family, flatten, type Style } from '../src/master';

const [out, ...specs] = process.argv.slice(2);
const result: Record<string, Record<string, number[][][]>> = {};
for (const spec of specs) {
  const [family, style, weight] = spec.split(':');
  const master = buildMaster(family as Family, style as Style, Number(weight) as Weight);
  const glyphs: Record<string, number[][][]> = {};
  for (const glyph of master.glyphs) {
    // A glyph made only of components repeats its parts' joins; its parts are checked themselves.
    if (!glyph.contours.length) continue;
    // Block elements and shades (▀ ░ ▓) are stepped patterns by design, which is what the check looks for.
    if (glyph.unicode !== undefined && glyph.unicode >= 0x2580 && glyph.unicode <= 0x259f) continue;
    const contours = flatten(master, glyph);
    if (contours.length) glyphs[glyph.name] = contours.map((c) => c.map((p) => [p.x, p.y]));
  }
  result[spec] = glyphs;
}
mkdirSync(dirname(out!), { recursive: true });
writeFileSync(out!, JSON.stringify(result));
