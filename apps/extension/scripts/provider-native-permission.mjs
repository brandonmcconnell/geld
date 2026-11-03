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

/** Activate the real accessibility bus in this isolated session before Chrome starts. */
export async function prepareNativeAccessibilityBus(run = execute) {
  const base = ['call', '--session', '--dest', 'org.a11y.Bus', '--object-path', '/org/a11y/bus'];
  const options = { timeout: 3000, maxBuffer: 16 * 1024 };
  try {
    await run('/usr/bin/gdbus', [...base, '--method', 'org.freedesktop.DBus.Properties.Set', 'org.a11y.Status', 'IsEnabled', '<true>'], options);
    const enabled = await run('/usr/bin/gdbus', [...base, '--method', 'org.freedesktop.DBus.Properties.Get', 'org.a11y.Status', 'IsEnabled'], options);
    assert.match(enabled.stdout.trim(), /^\(<true>,\)$/);
    const address = await run('/usr/bin/gdbus', [...base, '--method', 'org.a11y.Bus.GetAddress'], options);
    const parsed = /^\('(unix:[^'\n]+)',\)$/.exec(address.stdout.trim());
    assert.ok(parsed !== null);
    await run('/usr/bin/gdbus', ['call', '--address', parsed[1], '--dest', 'org.a11y.atspi.Registry', '--object-path', '/org/a11y/atspi/registry', '--method', 'org.freedesktop.DBus.Peer.Ping'], options);
    return { status: 'ready', enabled: true, registryReachable: true };
  } catch { throw new Error('NATIVE_ACCESSIBILITY_BUS_UNAVAILABLE'); }
}

export function nativeAccessibilityEnvironment(environment) {
  const next = { ...environment, ACCESSIBILITY_ENABLED: '1' };
  delete next.CHROME_HEADLESS;
  return next;
}

export async function probeNativeChromeAccessibility(browserPid, run = execute) {
  assert.ok(Number.isSafeInteger(browserPid) && browserPid > 1);
  const result = await run('/usr/bin/python3', ['-B', fileURLToPath(new URL('./provider-native-permission.py', import.meta.url)), '--probe', '--browser-pid', String(browserPid), '--seconds', '5'], { timeout: 7000, maxBuffer: 64 * 1024 });
  return JSON.parse(result.stdout);
}
