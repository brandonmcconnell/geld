import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const harness = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');
const stable = harness.slice(harness.indexOf('async function pollStable('), harness.indexOf('async function prepareInstalledBrowserSettings('));

test('a failed read resets the stable-sample streak rather than bridging unreadable time', async () => {
  let time = 0, reads = 0;
  const poll = async (read, accepts) => {
    for (let attempt = 0; attempt < 10; attempt++, time += 1000) {
      try { const value = await read();if (accepts(value)) return value; } catch { /* The real retrying poll also catches read failures. */ }
    }
    throw Error('No stable sample');
  };
  const run = vm.runInNewContext(`(${stable})`, { Date: { now: () => time }, poll, WAIT_MS: 9000 });
  const result = await run(async () => { reads++;if (reads === 2) throw Error('Native page remount');return { ready: true }; }, value => value.ready, 'native state');
  assert.equal(reads, 4);
  assert.equal(result.stability.samples, 2);
  assert.equal(result.stability.stableMs, 1000);
});
