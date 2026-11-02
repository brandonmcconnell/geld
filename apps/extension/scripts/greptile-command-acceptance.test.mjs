import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { tsImport } from 'tsx/esm/api';
import { GREPTILE_COMMAND_FIXTURE as F, greptileCommandDomProbe, observeGreptileCommandRequest, verifyGreptileCommand } from './greptile-command-acceptance.mjs';

const { renderProviderBotRequest } = await tsImport('../src/providers/bot-request.ts', import.meta.url);

const HEAD = '5da09f9e31ad0d59c6f804a71380992955d1040f';
const ACK = 'Command copied. Paste it into the native comment writer and post when ready.';
function request(path, frames) { return { url: () => `https://gitlab.com${path}`, method: () => 'GET', initiator: () => frames === undefined ? undefined : { stack: { callFrames: frames.map((url) => ({ url })) } } }; }

test('DOM probe reads the actual product single-command widget and independently bound native author header', async () => {
  const window = new Window({ url: F.url });const originals = new Map(['document', 'location'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of [['document', window.document], ['location', window.location]]) Object.defineProperty(globalThis, key, { configurable: true, value });
    document.body.innerHTML = `<section class="geld-provider-review" data-geld-review-head="${HEAD}"><div data-geld-review-bot="greptile"></div></section><div id="${F.anchor}" data-testid="noteable-note-container"><div class="timeline-entry-inner"><div class="timeline-content"><div class="note-header"><div class="note-header-info"><a class="author-name-link" data-user-id="${F.author}" data-username="${F.login}">Greptile</a></div></div><div class="note-body"><div class="note-text"><h3>Greptile Summary</h3></div></div></div></div></div>`;
    const request = { key: 'native-source-and-service', label: 'Greptile', sourceUrl: `${F.url}#${F.anchor}`, commands: [{ id: 'review', label: 'Review', text: F.command }], current: () => true, comment: { available: false, reason: 'Sign in to GitLab.', activate: async () => false } };
    renderProviderBotRequest(document.querySelector('[data-geld-review-bot]'), request, async () => undefined);
    const value = greptileCommandDomProbe();assert.equal(value.summary, 'Prepare Greptile request');assert.equal(value.preview, F.command);assert.equal(value.modes, 0);assert.equal(value.commentDisabled, true);assert.equal(value.copyDisabled, false);
    assert.equal(value.source, `${F.url}#${F.anchor}`);assert.equal(value.native.author, F.author);assert.equal(value.native.login, F.login);assert.equal(value.native.body, '<h3>Greptile Summary</h3>');
  } finally {
    for (const [key, descriptor] of originals) if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor);
    await window.happyDOM.abort();
  }
});

test('request evidence keeps incidental JSON unknown and rejects exact source routes or positive extension frames', () => {
  const incidental = observeGreptileCommandRequest(request('/whitebox-aero/whitebox/-/merge_requests/272/test_reports.json'), 'installed');
  assert.equal(incidental.acquisition, false);assert.equal(incidental.attribution, 'native_or_unattributed');
  const native = observeGreptileCommandRequest(request('/whitebox-aero/whitebox/-/merge_requests/272/test_reports.json', ['https://gitlab.com/assets/native.js']), 'installed');
  assert.equal(native.acquisition, false);assert.equal(native.attribution, 'first_party_frame_observed');
  const extension = observeGreptileCommandRequest(request('/whitebox-aero/whitebox/-/merge_requests/272/test_reports.json', ['chrome-extension://installed/content-scripts/gitlab.js']), 'installed');
  assert.equal(extension.acquisition, true);assert.equal(extension.attribution, 'extension_frame_observed');
  for (const path of ['/api/v4/projects/whitebox-aero%2Fwhitebox/merge_requests/272', '/api/v4/projects/56243493/merge_requests/272/approvals', '/whitebox-aero/whitebox/-/merge_requests/272/discussions.json']) assert.equal(observeGreptileCommandRequest(request(path), 'installed').acquisition, true);
  assert.equal(observeGreptileCommandRequest(request('/whitebox-aero/whitebox/-/merge_requests/273/discussions.json'), 'installed'), null);
});

// Explicit synthetic browser protocol. Real trusted events/clipboard remain installed-run evidence only.
function protocol(options = {}) {
  let clipboard = 'Original clipboard bytes';let copied = false;let focused = false;let event;let held = false;let restored = false;let permissionsCleared = 0;let disposed = 0;
  const fixture = { metadata: [{ sha: HEAD, diffHead: HEAD }], discussions: [{ selected: [{ id: '3381334808', system: false, author: { id: F.author, username: F.login }, url: `${F.url}#${F.anchor}` }] }], errors: [], providerMutations: [], aiRequests: [], commandSourceGets: [], commandOtherGets: [] };
  const item = {};
  const settings = { enabled: true, aiEnabled: false, trustedReviewAccounts: ['gitlab.com/whitebox-aero/whitebox greptile 37628862'], preserved: 'value' };
  const digest = () => ({ selectedHead: copied && options.headChanged ? 'b'.repeat(40) : HEAD, items: [{ id: 'ri_actual', state: 'resolved', sources: [F.anchor] }], bots: [{ id: 'greptile', state: copied && options.verdictChanged ? 'unknown' : 'clean', text: 'No findings' }] });
  const dom = () => ({ url: F.url, head: HEAD, requests: 1, summary: options.wrongSummary ? 'Prepare another service' : 'Prepare Greptile request', preview: options.wrongPreview ? '@invented review' : F.command,
    modes: options.modeGroup ? 1 : 0, copyDisabled: false, commentDisabled: !options.enabledWriter, commentTitle: 'Sign in to GitLab to comment.', source: `${F.url}#${F.anchor}`, status: copied ? ACK : '',
    native: { exists: true, author: F.author, login: F.login, body: copied && options.bodyChanged ? '<p>Changed source</p>' : '<h3>Greptile Summary</h3>', sameNode: held ? !(copied && options.replaced) : null } });
  const page = {
    url: () => copied && options.navigation ? F.url.replace('/272', '/273') : F.url,
    isClosed: () => copied && options.closed,
    evaluate: async (fn, ...args) => {
      const source = fn.toString();
      if (source.includes('delete globalThis')) return;
      if (source.includes('navigator.clipboard.writeText')) { if (copied && options.restoreFailure && args[0] === 'Original clipboard bytes') throw new Error('Clipboard restore denied');clipboard = args[0];if (args[0] === 'Original clipboard bytes') restored = true;return; }
      if (source.includes('navigator.clipboard.readText')) return clipboard;
      if (source.includes('globalThis.__geldGreptileCommandInput')) return event;
      if (source.includes('globalThis.__geldGreptileCommandNative =')) { held = true;return; }
      if (source.includes('const panel =')) return dom();
      throw new Error('Unknown protocol evaluation');
    },
    $: async () => ({ evaluate: async () => {}, focus: async () => { focused = true; }, dispose: async () => { disposed += 1; } }),
    keyboard: { press: async (key) => {
      assert.equal(key, 'Enter');assert.equal(focused, true);copied = true;event = { trusted: !options.untrusted, detail: options.pointerDetail ? 1 : 0 };clipboard = options.wrongClipboard ? 'Wrong command' : F.command;
      if (options.sourceGet) fixture.commandSourceGets.push(observeGreptileCommandRequest(request('/whitebox-aero/whitebox/-/merge_requests/272/discussions.json'), 'installed'));
      if (options.incidental) fixture.commandOtherGets.push(observeGreptileCommandRequest(request('/whitebox-aero/whitebox/-/merge_requests/272/test_reports.json'), 'installed'));
      if (options.mutation) fixture.providerMutations.push({ method: 'POST', url: F.url + '/notes' });
      if (options.ai) fixture.aiRequests.push('https://gateway.invalid/v1/chat/completions');
    } },
  };
  const context = { overridePermissions: async (origin, value) => { assert.equal(origin, 'https://gitlab.com');assert.deepEqual(value, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);if (options.denied) throw new Error('Permission denied'); }, clearPermissionOverrides: async () => { permissionsCleared += 1;if (options.permissionCleanupFailure) throw new Error('Permission cleanup failed'); } };
  const run = () => verifyGreptileCommand(page, item, { context, fixture, head: HEAD, readDigest: async () => digest(), assertSources: (value) => assert.equal(value.selectedHead, HEAD),
    readSettings: async () => ({ ...settings, ...(copied && options.bindingChanged ? { trustedReviewAccounts: [] } : {}) }), openReviewAncestors: async () => 2,
    poll: async (read, accept) => { const value = await read();assert.ok(accept(value), 'Required observed protocol state absent');return value; },
    capture: async () => { if (options.captureFailure) throw new Error('Capture failed after validated clipboard');return { screenshot: 'actual-browser-only.png' }; },
  });
  return { run, item, fixture, clipboard: () => clipboard, restored: () => restored, cleared: () => permissionsCleared, disposed: () => disposed };
}

test('protocol requires one exact anonymous keyboard command, source/head/binding stability and final clipboard/permission restoration', async () => {
  const f = protocol();const proof = await f.run();assert.equal(proof.status, 'passed');assert.equal(proof.actions.length, 1);
  assert.deepEqual(proof.actions[0].event, { trusted: true, detail: 0 });assert.equal(proof.actions[0].clipboard, '@greptileai');assert.equal(proof.actions[0].clipboardValidated, true);assert.equal(proof.actions[0].completed, true);
  assert.deepEqual(proof.sourceGets, []);assert.deepEqual(proof.otherGets, []);assert.equal(f.fixture.commandCopyActive, false);assert.equal(f.clipboard(), 'Original clipboard bytes');assert.equal(f.restored(), true);assert.equal(f.cleared(), 1);assert.equal(f.disposed(), 1);
});
for (const [name, options] of [
  ['wrong service summary', { wrongSummary: true }], ['wrong command preview', { wrongPreview: true }], ['redundant mode group', { modeGroup: true }], ['enabled anonymous writer', { enabledWriter: true }],
  ['untrusted input', { untrusted: true }], ['pointer instead of Enter', { pointerDetail: true }], ['wrong clipboard', { wrongClipboard: true }], ['changed source body', { bodyChanged: true }],
  ['native root replacement', { replaced: true }], ['changed head', { headChanged: true }], ['changed verdict', { verdictChanged: true }], ['withdrawn binding', { bindingChanged: true }], ['route navigation', { navigation: true }],
  ['recognized source acquisition', { sourceGet: true }], ['native mutation', { mutation: true }], ['AI request', { ai: true }], ['capture failure', { captureFailure: true }], ['permission denial', { denied: true }],
]) test(`protocol rejects ${name}, retaining action progress and restoring everything it touched`, async () => {
  const f = protocol(options);await assert.rejects(f.run());assert.equal(f.item.greptileCommand.status, 'failed');assert.equal(f.fixture.commandCopyActive, false);
  if (f.item.greptileCommand.actions.length) { assert.equal(f.clipboard(), 'Original clipboard bytes');assert.equal(f.cleared(), 1); }
  if (options.denied) assert.equal(f.cleared(), 1);
  if (options.captureFailure || options.bodyChanged || options.bindingChanged) assert.equal(f.item.greptileCommand.actions[0].clipboardValidated, true);
});

test('incidental JSON remains separate evidence and never becomes a zero-traffic claim', async () => {
  const f = protocol({ incidental: true });const proof = await f.run();assert.equal(proof.status, 'passed');assert.deepEqual(proof.sourceGets, []);assert.equal(proof.otherGets.length, 1);assert.equal(proof.otherGets[0].attribution, 'native_or_unattributed');
});
for (const options of [{ restoreFailure: true }, { permissionCleanupFailure: true }, { closed: true }]) test(`cleanup failure keeps a previously completed action from passing: ${JSON.stringify(options)}`, async () => {
  const f = protocol(options);await assert.rejects(f.run());assert.equal(f.item.greptileCommand.status, 'failed');assert.ok(f.item.greptileCommand.cleanupErrors.length > 0);assert.equal(f.cleared(), 1);
});
