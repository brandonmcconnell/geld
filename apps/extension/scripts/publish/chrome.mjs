#!/usr/bin/env node
// Publish a zip to the Chrome Web Store (Publish API). Usage: node chrome.mjs <zip>
// Env: CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN.
// Exit codes: 0 published (submitted for review), 78 skipped (item pending review), 1 failed.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const [zipPath] = process.argv.slice(2);
const extensionId = process.env.CWS_EXTENSION_ID ?? '';
const clientId = process.env.CWS_CLIENT_ID ?? '';
const clientSecret = process.env.CWS_CLIENT_SECRET ?? '';
const refreshToken = process.env.CWS_REFRESH_TOKEN ?? '';
if (!zipPath || !extensionId || !clientId || !clientSecret || !refreshToken) {
  console.error('Usage: CWS_EXTENSION_ID=… CWS_CLIENT_ID=… CWS_CLIENT_SECRET=… CWS_REFRESH_TOKEN=… node chrome.mjs <zip>');
  process.exit(1);
}

// Chrome refuses uploads and publishes while a submission is pending review.
const PENDING = /ITEM_PENDING_REVIEW|ITEM_NOT_UPDATABLE|pending review/i;

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
});
const token = await tokenResponse.json();
if (!tokenResponse.ok || typeof token.access_token !== 'string') throw new Error(`Chrome: could not get an access token: ${JSON.stringify(token)}`);
const headers = { Authorization: `Bearer ${token.access_token}`, 'x-goog-api-version': '2' };

console.log(`Chrome: uploading ${basename(zipPath)} to ${extensionId}`);
const upload = await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`, {
  method: 'PUT',
  headers,
  body: await readFile(zipPath),
});
const uploadText = await upload.text();
if (PENDING.test(uploadText)) {
  console.log('Chrome: skipped — the item is pending review; cancel it in the dashboard to publish sooner.');
  process.exit(78);
}
let uploaded;
try {
  uploaded = JSON.parse(uploadText);
} catch {
  throw new Error(`Chrome upload: ${upload.status} ${uploadText}`);
}
if (!upload.ok || uploaded.uploadState !== 'SUCCESS') {
  throw new Error(`Chrome upload failed: ${JSON.stringify(uploaded.itemError ?? uploaded)}`);
}

const publish = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish?publishTarget=default`, {
  method: 'POST',
  headers: { ...headers, 'Content-Length': '0' },
});
const publishText = await publish.text();
if (PENDING.test(publishText)) {
  console.log('Chrome: uploaded as draft, but publishing skipped — the item is pending review.');
  process.exit(78);
}
if (!publish.ok) throw new Error(`Chrome publish failed: ${publish.status} ${publishText}`);
const result = JSON.parse(publishText);
const statuses = Array.isArray(result.status) ? result.status : [];
console.log(`Chrome: ${statuses.join(', ') || 'submitted'} — ${(result.statusDetail ?? []).join(' ')}`);
