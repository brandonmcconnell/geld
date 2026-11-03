import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const ORIGINS = {
  gitlab: ['https://gitlab.com/*'],
  bitbucket: ['https://bitbucket.org/*', 'https://api.bitbucket.org/*'],
};

export async function confirmNativeProviderPermission(provider, browserPid, readState, run = execute) {
  assert.ok(Object.hasOwn(ORIGINS, provider));
  assert.ok(Number.isSafeInteger(browserPid) && browserPid > 1, 'The launched Chrome process must own the permission dialog');
  const state = await readState();
  if (ORIGINS[provider].every(origin => state.permissions.origins.includes(origin))) return { status: 'already_granted', phase: 'worker_registration' };
  const result = await run('/usr/bin/python3', ['-B', fileURLToPath(new URL('./provider-native-permission.py', import.meta.url)), '--provider', provider, '--browser-pid', String(browserPid), '--seconds', '10'], { timeout: 12_000, maxBuffer: 64 * 1024 });
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'confirmed', `No qualified native permission dialog was confirmed: ${JSON.stringify(receipt)}`);
  return receipt;
}
