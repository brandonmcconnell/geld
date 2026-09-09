#!/usr/bin/env node
// Publish a zip to Microsoft Edge Add-ons through the Partner Center API
// (v1.1, API-key auth). Usage: node edge.mjs <zip> — credentials from env:
// EDGE_PRODUCT_ID, EDGE_CLIENT_ID, EDGE_API_KEY. Exit codes: 0 published,
// 78 skipped (a submission is already under review), 1 failed.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const [zipPath] = process.argv.slice(2);
const productId = process.env.EDGE_PRODUCT_ID ?? '';
const clientId = process.env.EDGE_CLIENT_ID ?? '';
const apiKey = process.env.EDGE_API_KEY ?? '';
if (!zipPath || !productId || !clientId || !apiKey) {
  console.error('Usage: EDGE_PRODUCT_ID=… EDGE_CLIENT_ID=… EDGE_API_KEY=… node edge.mjs <zip>');
  process.exit(1);
}

const base = `https://api.addons.microsoftedge.microsoft.com/v1/products/${productId}/submissions`;
const headers = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A submission already in review blocks new ones; that is a skip, not a failure. */
function isPendingReview(status, text) {
  return status === 409 || /in progress|under review|pending|already (?:a|an) submission/i.test(text);
}

/**
 * The store already has this (or a higher) version: nothing to publish. Edge
 * words it several ways ("version already exists", "The Zip version number
 * needs to be higher than previous version: 0.1.1.113").
 */
function isDuplicateVersion(text) {
  return /version.*(?:already|(?:must|needs?) (?:to )?be (?:higher|greater)|not (?:higher|greater))/i.test(text);
}

async function pollOperation(url, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(url, { headers });
    const text = await response.text();
    if (!response.ok) throw new Error(`${label}: ${response.status} ${text}`);
    const body = JSON.parse(text);
    if (body.status === 'Succeeded') return body;
    if (body.status === 'Failed') {
      const detail = JSON.stringify(body);
      if (body.errorCode === 'InProgressSubmission' || isPendingReview(0, detail)) {
        console.log('Edge: skipped — a submission is already under review.');
        process.exit(78);
      }
      if (isDuplicateVersion(detail)) {
        console.log('Edge: skipped — the store already has this version.');
        process.exit(78);
      }
      throw new Error(`${label} failed: ${detail}`);
    }
    await sleep(5000);
  }
  throw new Error(`${label}: timed out`);
}

console.log(`Edge: uploading ${basename(zipPath)} to product ${productId}`);
const upload = await fetch(`${base}/draft/package`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/zip' },
  body: await readFile(zipPath),
});
const uploadText = await upload.text();
if (!upload.ok) {
  if (isPendingReview(upload.status, uploadText)) {
    console.log(`Edge: skipped — a submission is already under review (${upload.status}).`);
    process.exit(78);
  }
  if (isDuplicateVersion(uploadText)) {
    console.log('Edge: skipped — the store already has this version.');
    process.exit(78);
  }
  throw new Error(`Edge upload failed: ${upload.status} ${uploadText}`);
}
const uploadOperation = upload.headers.get('location');
if (!uploadOperation) throw new Error('Edge upload returned no operation location.');
await pollOperation(`${base}/draft/package/operations/${uploadOperation}`, 'Edge package upload');

const publish = await fetch(base, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ notes: process.env.PUBLISH_NOTES ?? 'Automated release from CI.' }),
});
const publishText = await publish.text();
if (!publish.ok) {
  if (isPendingReview(publish.status, publishText)) {
    console.log(`Edge: uploaded, but publishing skipped — a submission is already under review (${publish.status}).`);
    process.exit(78);
  }
  throw new Error(`Edge publish failed: ${publish.status} ${publishText}`);
}
const publishOperation = publish.headers.get('location');
if (publishOperation) await pollOperation(`${base}/operations/${publishOperation}`, 'Edge publish');
console.log('Edge: submitted for review.');
