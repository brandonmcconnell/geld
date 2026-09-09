// Does App Store Connect already have this build of the Mac app?
//
//   node asc-build-exists.mjs <bundle-id> <marketing-version> <build-number>
//
// Asks the App Store Connect API (read-only) before the workflow spends five
// minutes of macOS runner archiving, exporting and uploading a package Apple
// would then refuse as a redundant binary. Prints "exists" or "missing" and
// exits 0; any other failure exits 1 so the caller falls back to archiving.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (base64 .p8).
import { createPrivateKey, createSign } from 'node:crypto';

const [bundleId, marketingVersion, build] = process.argv.slice(2);
if (!bundleId || !marketingVersion || !build) throw new Error('usage: asc-build-exists.mjs <bundle-id> <marketing-version> <build-number>');
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

async function api(path) {
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`App Store Connect answered ${response.status} for ${path}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

const apps = await api(`/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId`);
const app = apps.data?.[0];
if (!app) throw new Error(`no App Store Connect app has bundle id ${bundleId}`);
const builds = await api(
  `/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(build)}&filter[preReleaseVersion.version]=${encodeURIComponent(marketingVersion)}&filter[preReleaseVersion.platform]=MAC_OS&fields[builds]=version,processingState&limit=1`,
);
console.log(builds.data?.length > 0 ? 'exists' : 'missing');
