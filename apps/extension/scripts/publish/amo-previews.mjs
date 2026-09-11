// Upload the listing screenshots ("previews") for the add-on on addons.mozilla.org.
//
//   node amo-previews.mjs <unpacked-dir> <image>...
//
// Reads the add-on id from the unpacked manifest, lists the previews AMO
// already has, and uploads each given image that is not there yet (matched by
// pixel size), in the given order (position 0, 1, …). Idempotent, so a re-run
// uploads nothing. Previews are listing assets, not versions: they do not
// count against the submission quota.
//
// Env: WEB_EXT_API_KEY (JWT issuer), WEB_EXT_API_SECRET.
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const [dir, ...images] = process.argv.slice(2);
if (!dir || images.length === 0) throw new Error('usage: amo-previews.mjs <unpacked-dir> <image>...');
const issuer = process.env.WEB_EXT_API_KEY;
const secret = process.env.WEB_EXT_API_SECRET;
if (!issuer || !secret) throw new Error('WEB_EXT_API_KEY and WEB_EXT_API_SECRET are required');

const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
const guid = manifest.browser_specific_settings?.gecko?.id;
if (typeof guid !== 'string') throw new Error('manifest has no gecko id');

const base64url = (input) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 300 }));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `JWT ${header}.${payload}.${signature}`;
}

/** Width and height from a JPEG or PNG header, to match against AMO's image_size. */
function imageSize(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('not a JPEG');
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
    }
    offset += 2 + length;
  }
  throw new Error('no JPEG frame header');
}

const api = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(guid)}`;
const detail = await fetch(`${api}/`, { headers: { Authorization: token(), Accept: 'application/json' } });
if (!detail.ok) throw new Error(`AMO answered ${detail.status} for the add-on: ${(await detail.text()).slice(0, 300)}`);
const existing = (await detail.json()).previews ?? [];
console.log(`AMO has ${existing.length} preview(s): ${existing.map((p) => `${p.image_size?.join('x')}@${p.position}`).join(', ') || 'none'}`);

let position = 0;
for (const image of images) {
  const bytes = await readFile(image);
  const [width, height] = imageSize(bytes);
  const already = existing.find((p) => p.image_size?.[0] === width && p.image_size?.[1] === height);
  if (already) {
    console.log(`${basename(image)} (${width}x${height}): already there (id ${already.id}).`);
  } else {
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: image.endsWith('.png') ? 'image/png' : 'image/jpeg' }), basename(image));
    form.append('position', String(position));
    const response = await fetch(`${api}/previews/`, { method: 'POST', headers: { Authorization: token() }, body: form });
    if (!response.ok) throw new Error(`AMO refused ${basename(image)}: ${response.status} ${(await response.text()).slice(0, 300)}`);
    console.log(`${basename(image)} (${width}x${height}): uploaded at position ${position}.`);
  }
  position += 1;
}
