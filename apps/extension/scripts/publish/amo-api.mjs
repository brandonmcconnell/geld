// addons.mozilla.org API access for the listing scripts.
//
// Env: WEB_EXT_API_KEY (JWT issuer), WEB_EXT_API_SECRET.
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const issuer = process.env.WEB_EXT_API_KEY;
const secret = process.env.WEB_EXT_API_SECRET;
if (!issuer || !secret) throw new Error('WEB_EXT_API_KEY and WEB_EXT_API_SECRET are required');

const base64url = (input) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 300 }));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `JWT ${header}.${payload}.${signature}`;
}

/** The add-on's API root, from the gecko id in an unpacked build's manifest. */
export async function addonApi(dir) {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const guid = manifest.browser_specific_settings?.gecko?.id;
  if (typeof guid !== 'string') throw new Error('manifest has no gecko id');
  return `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(guid)}`;
}

export async function amo(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: token(), Accept: 'application/json', ...init.headers } });
  if (!response.ok) throw new Error(`AMO answered ${response.status} for ${init.method ?? 'GET'} ${url}: ${(await response.text()).slice(0, 300)}`);
  return response.status === 204 ? null : response.json();
}
