// Runs a WXT command for the nightly build (`node scripts/nightly.mjs build`): GELD_CHANNEL works the same on every OS this way.
import { spawnSync } from 'node:child_process';

const result = spawnSync('wxt', [...process.argv.slice(2), '-b', 'chrome'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, GELD_CHANNEL: 'nightly' },
});
process.exit(result.status ?? 1);
