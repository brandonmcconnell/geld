// Read-only App Store Connect API access for the publish workflow's checks.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (base64 .p8).
import { createPrivateKey, createSign } from 'node:crypto';

const keyId = process.env.ASC_KEY_ID;
const issuerId = process.env.ASC_ISSUER_ID;
const privateKey = process.env.ASC_PRIVATE_KEY;
if (!keyId || !issuerId || !privateKey) throw new Error('ASC_KEY_ID, ASC_ISSUER_ID and ASC_PRIVATE_KEY are required');

const base64url = (input) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
const payload = base64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }));
const key = createPrivateKey(Buffer.from(privateKey, 'base64').toString('utf8'));
const signer = createSign('SHA256');
signer.update(`${header}.${payload}`);
const signature = signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const token = `${header}.${payload}.${signature}`;

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`App Store Connect answered ${response.status} for ${method} ${path}: ${(await response.text()).slice(0, 300)}`);
  return response.status === 204 ? {} : response.json();
}

export async function appIdFor(bundleId) {
  const apps = await api(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId`);
  const app = apps.data?.[0];
  if (!app) throw new Error(`no App Store Connect app has bundle id ${bundleId}`);
  return app.id;
}
