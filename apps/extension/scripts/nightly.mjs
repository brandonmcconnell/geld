// Runs a WXT command for the nightly build (`node scripts/nightly.mjs build`): GELD_CHANNEL works the same on every OS this way.
// `prepare` too, so the generated types know the nightly-only entrypoints (a superset of a store build's).
import { spawnSync } from 'node:child_process';

const [command, ...rest] = process.argv.slice(2);
const browser = rest.includes('-b') || command === 'prepare' ? [] : ['-b', 'chrome'];
const result = spawnSync('wxt', [command ?? 'build', ...rest, ...browser], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, GELD_CHANNEL: 'nightly' },
});
process.exit(result.status ?? 1);
