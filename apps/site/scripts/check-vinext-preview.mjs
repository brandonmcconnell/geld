import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const input = process.argv[2];
assert.ok(input, 'Pass the homepage URL to check.');
const homepage = new URL('/', input);
const headers = { 'User-Agent': 'Discordbot/2.0' };
const page = await fetch(homepage, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
assert.equal(page.status, 200, 'Homepage status');
const html = await page.text();
const head = /<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i.exec(html)?.[1];
assert.ok(head, 'Homepage has a head element');
const imageTag = [...head.matchAll(/<meta\b[^>]*>/gi)]
  .map(([tag]) => tag)
  .find((tag) => /\bproperty="og:image"/i.test(tag));
const imageContent = imageTag?.match(/\bcontent="([^"]+)"/i)?.[1];
assert.ok(imageContent, 'Open Graph image tag is in the homepage head');
const imageUrl = new URL(imageContent);
assert.equal(imageUrl.origin, homepage.origin, 'Open Graph image origin');
assert.equal(imageUrl.pathname, '/opengraph-image', 'Open Graph image route');

const response = await fetch(imageUrl, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
assert.equal(response.status, 200, 'Open Graph image status');
assert.equal(response.headers.get('content-type')?.split(';')[0], 'image/png', 'Open Graph image content type');
const png = Buffer.from(await response.arrayBuffer());
const image = sharp(png);
assert.equal((await image.metadata()).format, 'png', 'Open Graph image format');
const { info } = await image.raw().toBuffer({ resolveWithObject: true });
assert.equal(info.width, 1200, 'Open Graph image width');
assert.equal(info.height, 630, 'Open Graph image height');
console.log(`${imageUrl.href} returned a decodable ${info.width} × ${info.height} PNG`);
console.log(`SHA-256 ${createHash('sha256').update(png).digest('hex')}`);
