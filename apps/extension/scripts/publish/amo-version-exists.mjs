// Does addons.mozilla.org already have this version of the add-on?
//
//   node amo-version-exists.mjs <unpacked-dir>
//
// Reads the add-on id and version from the unpacked manifest and asks AMO's
// read-only versions endpoint (a GET, which does not count against the
// submission or upload quotas — the whole point: web-ext uploads two files
// before it learns a version exists, and AMO allows 48 uploads a day). Prints
// "exists" or "missing" and exits 0; any other failure exits 1 so the caller
// falls back to trying the upload.
//
// Env: WEB_EXT_API_KEY (JWT issuer), WEB_EXT_API_SECRET.
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [dir] = process.argv.slice(2);
if (!dir) throw new Error('usage: amo-version-exists.mjs <unpacked-dir>');
const issuer = process.env.WEB_EXT_API_KEY;
const secret = process.env.WEB_EXT_API_SECRET;
if (!issuer || !secret) throw new Error('WEB_EXT_API_KEY and WEB_EXT_API_SECRET are required');

const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
const guid = manifest.browser_specific_settings?.gecko?.id;
const version = manifest.version;
if (typeof guid !== 'string' || typeof version !== 'string') throw new Error('manifest has no gecko id or version');

const base64url = (input) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = base64url(JSON.stringify({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 300 }));
const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const token = `${header}.${payload}.${signature}`;

const url = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(guid)}/versions/${encodeURIComponent(version)}/`;
const response = await fetch(url, { headers: { Authorization: `JWT ${token}`, Accept: 'application/json' } });
if (response.status === 200) {
  console.log('exists');
} else if (response.status === 404) {
  console.log('missing');
} else {
  console.error(`AMO answered ${response.status} for ${url}: ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}
