#!/usr/bin/env node
/**
 * Print a fresh Ed25519 keypair for signing the pattern catalog.
 *
 * The public key (32 raw bytes, base64) goes into
 * `packages/core/src/catalog-key.ts`, where every build embeds it. The private
 * key (PKCS#8, base64) is the `GELD_CATALOG_PRIVATE_KEY` that
 * `scripts/catalog-sign.mjs` reads; keep it in a password manager or a GitHub
 * Actions secret, never in the repository. Rotating is cheap: run this again,
 * commit the new public key, re-sign the catalog — but extensions still on the
 * old key will reject the new signature until they update, so expect a gap.
 */

const { publicKey, privateKey } = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const rawPublic = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64');
const pkcs8Private = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');

console.log('Public key (commit to packages/core/src/catalog-key.ts):');
console.log(rawPublic);
console.log('');
console.log('Private key (GELD_CATALOG_PRIVATE_KEY — keep offline):');
console.log(pkcs8Private);
