import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_WORKER_NAME, GELD_SITE_PREVIEW_ORIGIN, npm_execpath } = process.env;
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--dry-run'), 'Pass --dry-run or run without arguments. Deployments always build from source.');
assert.match(CLOUDFLARE_ACCOUNT_ID ?? '', /^[a-f0-9]{32}$/i, 'Set CLOUDFLARE_ACCOUNT_ID to the test account ID.');
assert.match(CLOUDFLARE_WORKER_NAME ?? '', /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Set CLOUDFLARE_WORKER_NAME to a unique Worker name.');
assert.ok(GELD_SITE_PREVIEW_ORIGIN, 'Set GELD_SITE_PREVIEW_ORIGIN to the HTTPS workers.dev origin.');
const preview = new URL(GELD_SITE_PREVIEW_ORIGIN);
assert.ok(preview.href === `${preview.origin}/`, 'GELD_SITE_PREVIEW_ORIGIN must be an origin.');
assert.ok(npm_execpath, 'Run this command with pnpm.');

const cf = fileURLToPath(new URL('bin/cf', import.meta.resolve('cf/package.json')));
const workers = JSON.parse(execFileSync(process.execPath, [cf, '--quiet', 'workers', 'list'], { encoding: 'utf8', timeout: 30_000 }));
const accountDomain = /^https:\/\/[^.]+\.([a-z0-9-]+\.workers\.dev)\/?$/;
let suffix = workers.map((worker) => accountDomain.exec(worker.subdomain?.url ?? '')?.[1]).find(Boolean);
if (!suffix && CLOUDFLARE_API_TOKEN) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Could not read the account's workers.dev subdomain (HTTP ${response.status}).`);
  const body = await response.json();
  const subdomain = body.result?.subdomain;
  if (typeof subdomain === 'string' && /^[a-z0-9-]+$/.test(subdomain)) suffix = `${subdomain}.workers.dev`;
}
assert.ok(suffix, 'Could not verify the account subdomain. For an account without any Workers, provide a Cloudflare API token with Workers Scripts Write.');
assert.equal(preview.origin, `https://${CLOUDFLARE_WORKER_NAME}.${suffix}`, 'Preview origin must match the selected account and Worker name.');

const deploy = spawnSync(process.execPath, [npm_execpath, 'exec', 'vinext-cloudflare', 'deploy', ...args], {
  env: { ...process.env, GELD_SITE_PREVIEW_ORIGIN: preview.origin },
  stdio: 'inherit',
});
if (deploy.error) throw deploy.error;
process.exitCode = deploy.status ?? 1;
