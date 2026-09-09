/**
 * Ed25519 public key (32 raw bytes, base64) that `catalog/patterns.json` must
 * be signed with before the extension uses it. The matching private key is
 * held by the project owner outside the repository (`GELD_CATALOG_PRIVATE_KEY`
 * for `scripts/catalog-sign.mjs`); `scripts/catalog-keygen.mjs` makes a new
 * pair. Rotating the key means every installed extension rejects catalogs
 * signed with the new one until it updates to a build that embeds it.
 */
export const CATALOG_PUBLIC_KEY = 'H+t0BsghP0lhlVjruGDD+p1p505b2ccrhas2/oz2TBQ=';
