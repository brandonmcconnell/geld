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

const parentHover = harness.slice(harness.indexOf('async function bitbucketParentCommitHover('), harness.indexOf('async function threeSiteBitbucketDom('));
function parentProtocol({ proof = true, keyboardFails = false } = {}) {
  const link = { href: 'https://bitbucket.org/team/repo/commits/' + 'a'.repeat(40), raw: '/team/repo/commits/' + 'a'.repeat(40), sha: 'a'.repeat(40) };
  const initial = { links: [link] };
  const source = { status: proof ? 'ready' : 'unavailable', totals: { files: 1, additions: 2, deletions: 0 } };
  const deps = {
    assert, report: { quotaPolicy: { conservativeObservedRequestBudget: 40 } }, bitbucketRequestTimes: [],
    Date, currentCaseAbort: undefined, cooldowns: new Map(), errorText: error => error.message,
    bitbucketParentCommitSnapshot: () => initial,
    prepareBitbucketParentCommit: async () => ({ native: initial }),
    installedHover: async (_page, _selector, mode) => { if (mode === 'keyboard' && keyboardFails) throw Error('Keyboard tooltip did not close');return { rows: [], text: '1 file +2 −0' }; },
    poll: async (read, accepts) => { const value = await read();if (!accepts(value)) throw Error('No complete source');return value; },
    commitHoverTotal: () => source.totals,
  };
  const run = vm.runInNewContext(`(${parentHover})`, deps);
  return () => run({ evaluate: async fn => fn(), isClosed: () => false }, { snapshot: () => source });
}
test('a proven parent commit cannot hide keyboard interaction failures behind optional discovery', async () => {
  await assert.rejects(parentProtocol({ keyboardFails: true })(), /Keyboard tooltip did not close/);
  assert.equal((await parentProtocol()()).status, 'passed');
});
test('parent hover remains explicitly unverified when its independent source is unavailable', async () => {
  const result = await parentProtocol({ proof: false })();assert.equal(result.status, 'unverified');assert.match(result.reason, /No complete source/);
});
