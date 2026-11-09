// Upload the listing screenshots ("previews") for the add-on on addons.mozilla.org.
//
//   node amo-previews.mjs <unpacked-dir> <image>...
//
// The given images become the first previews, in the given order; previews AMO
// already has that are not among them keep their order after them. An image is
// recognised by its pixels, not its size (every listing screenshot is 1280x800):
// both sides are reduced to a 160x100 greyscale thumbnail and compared, since
// AMO stores its own re-encoded copy. Idempotent, so a re-run uploads and moves
// nothing. Previews are listing assets, not versions: they do not count against
// the submission quota.
//
// Env: WEB_EXT_API_KEY (JWT issuer), WEB_EXT_API_SECRET.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import sharp from 'sharp';

import { addonApi, amo } from './amo-api.mjs';

const [dir, ...images] = process.argv.slice(2);
if (!dir || images.length === 0) throw new Error('usage: amo-previews.mjs <unpacked-dir> <image>...');

/** Mean difference (0 to 255): re-encoded copies measured under 0.3, the listing's different screenshots over 2.2. */
const SAME_IMAGE = 1;
const signature = (bytes) => sharp(bytes).resize(160, 100, { fit: 'fill' }).greyscale().raw().toBuffer();
const difference = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;

const api = await addonApi(dir);
const existing = ((await amo(`${api}/`)).previews ?? []).toSorted((a, b) => a.position - b.position);
console.log(`AMO has ${existing.length} preview(s).`);
const signatures = new Map();
for (const preview of existing) {
  const response = await fetch(preview.image_url);
  if (!response.ok) throw new Error(`could not read preview ${preview.id}: ${response.status}`);
  signatures.set(preview.id, await signature(Buffer.from(await response.arrayBuffer())));
}

const ordered = [];
const positions = new Map(existing.map((preview) => [preview.id, preview.position]));
for (const image of images) {
  const bytes = await readFile(image);
  const own = await signature(bytes);
  const match = existing.find((preview) => !ordered.includes(preview.id) && difference(own, signatures.get(preview.id)) < SAME_IMAGE);
  if (match) {
    console.log(`${basename(image)}: already there (id ${match.id}).`);
    ordered.push(match.id);
    continue;
  }
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: image.endsWith('.png') ? 'image/png' : 'image/jpeg' }), basename(image));
  form.append('position', String(ordered.length));
  const created = await amo(`${api}/previews/`, { method: 'POST', body: form });
  console.log(`${basename(image)}: uploaded (id ${created.id}).`);
  positions.set(created.id, ordered.length);
  ordered.push(created.id);
}

const order = [...ordered, ...existing.map((preview) => preview.id).filter((id) => !ordered.includes(id))];
for (const [position, id] of order.entries()) {
  if (positions.get(id) === position) continue;
  await amo(`${api}/previews/${id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position }) });
  console.log(`Preview ${id}: position ${position}.`);
}
