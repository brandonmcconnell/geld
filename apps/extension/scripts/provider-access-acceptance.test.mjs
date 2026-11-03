import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { enableOptionalProviders, optionalProvidersForCases, assertOptionalProviderRegistrations, verifyOptionalProviderRegistration, readWorkerProviderAccess } from './provider-access-acceptance.mjs';

const OPTIONS = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html';
function protocol({ trusted = true, acknowledge = true, obstructed = false, navigate = false } = {}) {
  const clicks = [], disposed = [];
  let target = null, url = OPTIONS;
  const nodes = Object.fromEntries(['gitlab', 'bitbucket'].map(provider => {
    const label = provider === 'gitlab' ? 'GitLab' : 'Bitbucket';
    const listeners = new Set();
    const node = { provider, label, listeners, disabled: false, isConnected: true, textContent: `Enable ${label}`, busy: null,
      scrollIntoView() {}, getAttribute: name => name === 'aria-busy' ? node.busy : null,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 140, height: 30 }), contains: other => other === node,
      addEventListener: (_type, listener) => listeners.add(listener), removeEventListener: (_type, listener) => listeners.delete(listener) };
    return [provider, node];
  }));
  const evaluate = (fn, node) => vm.runInNewContext(`(${fn})(node)`, { node, document: { elementFromPoint: () => obstructed ? null : node }, innerWidth: 1000, innerHeight: 700 });
  const select = selector => nodes[/data-provider-enable="(gitlab|bitbucket)"/.exec(selector)?.[1]];
  const page = { url: () => url, bringToFront: async () => {},
    $eval: async (selector, fn) => JSON.parse(JSON.stringify(evaluate(fn, select(selector)))),
    $$: async selector => { const node = select(selector);return [{
      evaluate: async fn => { target = node;const value = evaluate(fn, node);return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); },
      dispose: async () => { disposed.push(node.provider); },
    }]; },
    mouse: { click: async () => {
      clicks.push(target.provider);for (const listener of target.listeners) listener({ isTrusted: trusted });
      if (navigate) url = 'https://example.invalid/';
      if (acknowledge) { target.disabled = true;target.textContent = `${target.label} enabled`;target.busy = null; }
      else { target.disabled = true;target.textContent = `Enabling ${target.label}`;target.busy = 'true'; }
    } },
  };
  const poll = async (read, accepts) => { const value = await read();assert.ok(accepts(value), 'Worker acknowledgement was not received');return value; };
  return { page, clicks, disposed, nodes, run: providers => enableOptionalProviders(page, providers, { poll }) };
}

test('grants only the optional sites required by selected cases, including commit settings counterparts', () => {
  assert.deepEqual(optionalProvidersForCases(['github-regression']), []);
  assert.deepEqual(optionalProvidersForCases(['gitlab-mixed', 'gitlab-overview-digest']), ['gitlab']);
  assert.deepEqual(optionalProvidersForCases(['bitbucket-ui-continuity']), ['bitbucket']);
  assert.deepEqual(optionalProvidersForCases(['bitbucket-commit-counts']), ['gitlab', 'bitbucket']);
  assert.deepEqual(optionalProvidersForCases(['cross-provider-settings']), ['gitlab']);
});
test('uses one actual pointer input per options button and waits for worker acknowledgement', async () => {
  const f = protocol();
  assert.deepEqual(await f.run(['gitlab', 'bitbucket']), [
    { provider: 'gitlab', pointerClick: true, trusted: true, acknowledged: true },
    { provider: 'bitbucket', pointerClick: true, trusted: true, acknowledged: true },
  ]);
  assert.deepEqual(f.clicks, ['gitlab', 'bitbucket']);assert.deepEqual(f.disposed, ['gitlab', 'bitbucket']);
  for (const node of Object.values(f.nodes)) { assert.equal(node.listeners.size, 0);assert.equal(node.__geldAccessReceipt, undefined); }
});
for (const [name, options] of [['synthetic input', { trusted: false }], ['pending registration', { acknowledge: false }], ['obstructed control', { obstructed: true }], ['navigation away', { navigate: true }]]) test(`provider setup rejects ${name} and releases observations`, async () => {
  const f = protocol(options);await assert.rejects(f.run(['gitlab']));
  assert.equal(f.nodes.gitlab.listeners.size, 0);assert.equal(f.nodes.gitlab.__geldAccessReceipt, undefined);assert.deepEqual(f.disposed, ['gitlab']);
  assert.equal(f.clicks.length, options.obstructed ? 0 : 1);
});
test('GitHub-only setup makes no clicks and has no permission API dependency', async () => {
  const f = protocol();assert.deepEqual(await f.run([]), []);assert.deepEqual(f.clicks, []);
});


function registered() {
  return { permissions: { origins: ['https://gitlab.com/*', 'https://bitbucket.org/*', 'https://api.bitbucket.org/*'] }, scripts: [
    { id: 'geld-gitlab', matches: ['https://gitlab.com/*'], js: ['content-scripts/gitlab.js'], css: ['content-scripts/gitlab.css'], runAt: 'document_start', persistAcrossSessions: true, world: 'ISOLATED' },
    { id: 'geld-bitbucket', matches: ['https://bitbucket.org/*'], js: ['content-scripts/bitbucket.js'], css: ['content-scripts/bitbucket.css'], runAt: 'document_start', persistAcrossSessions: true, world: 'ISOLATED' },
    { id: 'geld-bitbucket-main', matches: ['https://bitbucket.org/*'], js: ['content-scripts/bitbucket-whitespace.js'], runAt: 'document_start', persistAcrossSessions: true, world: 'MAIN' },
  ] };
}
test('registered provider receipt requires both grants, isolated scripts and the Bitbucket MAIN hook', () => {
  assert.equal(assertOptionalProviderRegistrations(registered()).scripts.length, 3);
  for (const mutate of [value => value.permissions.origins.pop(), value => value.scripts.pop(), value => { value.scripts[2].world = 'ISOLATED'; }, value => { value.scripts[0].matches = ['https://other.invalid/*']; }, value => { value.scripts[2].runAt = 'document_idle'; }]) {
    const value = registered();mutate(value);assert.throws(() => assertOptionalProviderRegistrations(value));
  }
});
test('options-only verification observes the actual worker with read-only APIs after genuine clicks', async () => {
  const f = protocol();const calls = [];
  const worker = { evaluate: async fn => vm.runInNewContext(`(${fn})()`, { chrome: {
    permissions: { getAll: async () => { calls.push('permissions');return registered().permissions; } },
    scripting: { getRegisteredContentScripts: async () => { calls.push('scripts');return registered().scripts; } },
  } }) };
  const value = await verifyOptionalProviderRegistration(f.page, worker, { poll: async (read, accepts) => { const result = await read();assert.ok(accepts(result));return result; } });
  assert.equal(value.status, 'passed');assert.deepEqual(f.clicks, ['gitlab', 'bitbucket']);assert.deepEqual(calls, Array.from({ length: 5 }, () => ['permissions', 'scripts']).flat());
});


for (const granted of [false, true]) test(`pending opt-in records ${granted ? 'worker registration' : 'permission request'} diagnostics`, async () => {
  const f = protocol({ acknowledge: false });const progress = [];
  await assert.rejects(enableOptionalProviders(f.page, ['gitlab'], {
    progress,
    poll: async (read, accepts) => { const result = await read();assert.ok(accepts(result));return result; },
    readState: async () => ({ permissions: { origins: granted ? ['https://gitlab.com/*'] : [] }, scripts: [] }),
    confirmPermission: async () => { assert.deepEqual(f.clicks, ['gitlab']);return { status: 'confirmed' }; },
  }));
  assert.equal(progress[0].pendingPhase, granted ? 'worker_registration' : 'permission_request');
  assert.equal(progress[0].after.granted, granted);assert.ok(progress[0].after.scripts.every(script => script.count === 0));
});


test('worker state diagnostics fail with a fixed timeout rather than hanging setup', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = assert.rejects(readWorkerProviderAccess({ evaluate: () => new Promise(() => {}) }), /PROVIDER_ACCESS_WORKER_STATE_TIMEOUT/);
  context.mock.timers.tick(3000);
  await rejected;
});


test('permission acknowledgement cannot conceal an extra origin grant and diagnostics omit that origin', async () => {
  const f = protocol();const progress = [];
  const pending = enableOptionalProviders(f.page, ['gitlab'], {
    progress, poll: async (read, accepts) => { const value = await read();assert.ok(accepts(value));return value; },
    readState: async () => ({ permissions: { origins: f.clicks.length === 0 ? [] : ['https://gitlab.com/*', 'https://private-canary.invalid/*'] }, scripts: [] }),
  });
  await assert.rejects(pending, /unexpected origin scope/);
  assert.equal(progress[0].grantScopeValid, false);assert.equal(progress[0].pendingPhase, 'unexpected_permission_scope');
  assert.doesNotMatch(JSON.stringify(progress), /private-canary/);
});
