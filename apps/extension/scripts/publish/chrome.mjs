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
const PENDING = /ITEM_PENDING_REVIEW|ITEM_NOT_UPDATABLE|pending review|in review/i;

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
});
const token = await tokenResponse.json();
if (!tokenResponse.ok || typeof token.access_token !== 'string') throw new Error(`Chrome: could not get an access token: ${JSON.stringify(token)}`);
const headers = { Authorization: `Bearer ${token.access_token}`, 'x-goog-api-version': '2' };

// Idempotent across scheduled runs. PUBLISHED tells us what is live; DRAFT what
// was last uploaded (live or pending). Already live → nothing to do. Already
// uploaded but not live → skip the upload and (re)try the publish, which is
// what a publish refused by the store (e.g. privacy practices missing) needs.
const target = /geld-([0-9.]+)-chrome\.zip$/.exec(basename(zipPath))?.[1] ?? null;
async function storeVersion(projection) {
  const response = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}?projection=${projection}`, { headers });
  if (!response.ok) return null;
  const item = await response.json();
  return typeof item.crxVersion === 'string' ? item.crxVersion : null;
}
const live = await storeVersion('PUBLISHED');
const draft = await storeVersion('DRAFT');
console.log(`Chrome: live ${live ?? 'unknown'}, draft ${draft ?? 'unknown'}, target ${target ?? basename(zipPath)}`);
if (target !== null && live === target) {
  console.log(`Chrome: skipped — version ${target} is already live.`);
  process.exit(78);
}

if (target === null || draft !== target) {
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
} else {
  console.log(`Chrome: ${target} is already uploaded; publishing it.`);
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
if (!publish.ok) {
  // Usually a dashboard-only precondition (privacy practices, distribution
  // settings); surface the store's own sentence, since only a person can fix it.
  let detail = publishText;
  try {
    detail = JSON.parse(publishText).error?.message ?? publishText;
  } catch {
    // not JSON; keep the raw text
  }
  throw new Error(`Chrome publish failed (${publish.status}): ${detail}`);
}
const result = JSON.parse(publishText);
const statuses = Array.isArray(result.status) ? result.status : [];
console.log(`Chrome: ${statuses.join(', ') || 'submitted'} — ${(result.statusDetail ?? []).join(' ')}`);
