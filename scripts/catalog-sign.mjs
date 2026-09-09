#!/usr/bin/env node
/**
 * Sign `catalog/patterns.json` into `catalog/patterns.sig` (Ed25519, base64)
 * with the private key in `GELD_CATALOG_PRIVATE_KEY` (PKCS#8, base64, as
 * printed by `scripts/catalog-keygen.mjs`).
 *
 * The signature covers the exact bytes of the JSON file, so this must run
 * after `pnpm catalog:build` and before committing; `pnpm catalog:check` (CI)
 * fails if either file changed without the other. The script verifies its own
 * output against the public key the extension embeds, so a mismatched keypair
 * is caught here rather than by every installed extension silently rejecting
 * the catalog.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const jsonPath = fileURLToPath(new URL('catalog/patterns.json', root));
const sigPath = fileURLToPath(new URL('catalog/patterns.sig', root));
const keyPath = fileURLToPath(new URL('packages/core/src/catalog-key.ts', root));

function fail(message) {
  console.error(`catalog-sign: ${message}`);
  process.exit(1);
}

const privateKeyBase64 = process.env.GELD_CATALOG_PRIVATE_KEY?.trim();
if (!privateKeyBase64) fail('set GELD_CATALOG_PRIVATE_KEY to the base64 PKCS#8 private key from scripts/catalog-keygen.mjs');

let payload;
try {
  payload = readFileSync(jsonPath);
} catch {
  fail('catalog/patterns.json is missing; run `pnpm catalog:build` first');
}

// The public key is read from the TypeScript source rather than duplicated
// here so there is exactly one place it lives.
const keyMatch = /CATALOG_PUBLIC_KEY = '([A-Za-z0-9+/=]+)'/.exec(readFileSync(keyPath, 'utf8'));
if (keyMatch === null) fail(`could not find CATALOG_PUBLIC_KEY in ${keyPath}`);

let privateKey;
try {
  privateKey = await crypto.subtle.importKey('pkcs8', Buffer.from(privateKeyBase64, 'base64'), { name: 'Ed25519' }, false, ['sign']);
} catch (error) {
  fail(`GELD_CATALOG_PRIVATE_KEY is not a valid Ed25519 PKCS#8 key (${error instanceof Error ? error.message : String(error)})`);
}
const signature = Buffer.from(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, payload));

const publicKey = await crypto.subtle.importKey('raw', Buffer.from(keyMatch[1], 'base64'), { name: 'Ed25519' }, false, ['verify']);
if (!(await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signature, payload))) {
  fail('the signature does not verify with CATALOG_PUBLIC_KEY in packages/core/src/catalog-key.ts — wrong private key? (rotate both with scripts/catalog-keygen.mjs)');
}

writeFileSync(sigPath, `${signature.toString('base64')}\n`);
console.log(`catalog-sign: wrote ${sigPath}`);
