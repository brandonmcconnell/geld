// Upload the listing screenshots ("previews") for the add-on on addons.mozilla.org.
//
//   node amo-previews.mjs <unpacked-dir> <image>...
//
// The given images become the first previews, in the given order; previews AMO
// already has that are not among them keep their order after them. How an image
// is recognised is in amo-previews-sync.mjs. Idempotent, so a re-run uploads and
// moves nothing. Previews are listing assets, not versions: they do not count
// against the submission quota.
//
// Env: WEB_EXT_API_KEY (JWT issuer), WEB_EXT_API_SECRET.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { addonApi, amo } from './amo-api.mjs';
import { syncPreviews } from './amo-previews-sync.mjs';

const [dir, ...files] = process.argv.slice(2);
if (!dir || files.length === 0) throw new Error('usage: amo-previews.mjs <unpacked-dir> <image>...');

const api = await addonApi(dir);
const existing = (await amo(`${api}/`)).previews ?? [];
console.log(`AMO has ${existing.length} preview(s).`);
const images = await Promise.all(files.map(async (file) => ({ name: basename(file), bytes: await readFile(file) })));

await syncPreviews({
  existing,
  images,
  read: async (preview) => {
    const response = await fetch(preview.image_url);
    if (!response.ok) throw new Error(`could not read preview ${preview.id}: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  },
  upload: async (image, position) => {
    const form = new FormData();
    form.append('image', new Blob([image.bytes], { type: image.name.endsWith('.png') ? 'image/png' : 'image/jpeg' }), image.name);
    form.append('position', String(position));
    return (await amo(`${api}/previews/`, { method: 'POST', body: form })).id;
  },
  move: async (id, position) => {
    await amo(`${api}/previews/${id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position }) });
  },
  log: (line) => console.log(line),
});
