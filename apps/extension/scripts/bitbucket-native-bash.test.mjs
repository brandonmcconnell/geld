import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { BITBUCKET_NATIVE_BASH as fixture, discoverNativeBash, nativeBashStyleSnapshot, observeNativeBashSources } from './bitbucket-native-bash.mjs';

async function withDom(body) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: fixture.url, settings: { enableCSSFileLoading: false, enableImageFileLoading: false, enableJavaScriptEvaluation: false } });
  const previous = Object.fromEntries(['document', 'location', 'NodeFilter', 'CSS'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    globalThis.document = window.document;globalThis.location = window.location;globalThis.NodeFilter = window.NodeFilter;
    globalThis.CSS = { highlights: new Map(), escape: (name) => name };
    const region = document.createElement('section');region.setAttribute('role', 'region');region.setAttribute('aria-label', 'Diff');
    const root = document.createElement('div');const anchor = document.createElement('div');anchor.id = 'chg-pipe/pipe.sh';root.append(anchor);region.append(root);document.body.append(region);
    for (const sample of fixture.sourceSamples) {
      const row = document.createElement('div');row.setAttribute('data-qa', 'code-line');
      const number = document.createElement('span');number.setAttribute('data-key', 'code-line-number');number.setAttribute('data-new-line-number', String(sample.line));
      const code = document.createElement('span');code.setAttribute('data-line-type', '+');code.textContent = sample.text;
      code.getBoundingClientRect = () => new window.DOMRect(20, 50, 800, 21);
      row.append(number, code);root.append(row);
    }
    await body({ window, root, code: (line) => [...root.querySelectorAll('[data-qa="code-line"]')].find((row) => row.querySelector('[data-new-line-number]')?.getAttribute('data-new-line-number') === String(line))?.querySelector('[data-line-type]') });
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) { if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor); }
    await window.happyDOM.abort();
  }
}

test('reads original new-side source and native span styles without changing markup or inventing classes', async () => withDom(({ root, code }) => {
  const target = code(70);const span = document.createElement('span');span.className = 'observed-native-string';span.textContent = target.textContent;target.replaceChildren(span);
  const before = root.outerHTML;const value = nativeBashStyleSnapshot(fixture);
  assert.equal(value.status, 'observed');assert.equal(value.samples.length, 5);assert.ok(value.samples.every((sample) => sample.status === 'matched_original'));
  assert.equal(value.samples.find((sample) => sample.line === 70).spans[0].className, 'observed-native-string');
  assert.equal(root.outerHTML, before);assert.match(value.classification, /no invented semantic mapping/);
}));

test('captures a native custom highlight over the exact original read Text node even without token classes', async () => withDom(({ window, code }) => {
  const target = code(72);const text = target.firstChild;const start = text.data.indexOf('read');const range = document.createRange();range.setStart(text, start);range.setEnd(text, start + 4);
  const native = new Set([range]);native.priority = 7;native.type = 'highlight';CSS.highlights.set('actual-native-name', native);
  const original = window.getComputedStyle.bind(window);window.getComputedStyle = (node, pseudo) => pseudo ? { color: 'rgb(17, 23, 29)', backgroundColor: 'rgba(0, 0, 0, 0)' } : original(node);
  const value = nativeBashStyleSnapshot(fixture);const sample = value.samples.find((sample) => sample.line === 72);
  assert.equal(sample.spans.length, 0);assert.deepEqual(sample.nodes[0].highlights.map(({ pseudoStyle, ...range }) => range), [{ name: 'actual-native-name', ownedName: false, start, end: start + 4, text: 'read' }]);
  assert.equal(sample.nodes[0].highlights[0].pseudoStyle.color, 'rgb(17, 23, 29)');
  assert.equal(value.highlights.entries[0].priority, 7);assert.equal(value.highlights.entries[0].ownedName, false);
}));

test('handles ancestor range endpoints and excludes adjacent untouched text or identical foreign words', async () => withDom(({ code }) => {
  const target = code(72);const text = target.textContent;const start = text.indexOf('read');const prefix = document.createTextNode(text.slice(0, start));const middle = document.createElement('span');middle.textContent = 'read';const suffix = document.createTextNode(text.slice(start + 4));target.replaceChildren(prefix, middle, suffix);
  const range = document.createRange();range.setStart(target, 1);range.setEnd(middle.firstChild, 4);CSS.highlights.set('native-source-range', new Set([range]));
  const foreign = document.createElement('span');foreign.textContent = 'read';document.body.append(foreign);const outside = document.createRange();outside.selectNodeContents(foreign);CSS.highlights.set('foreign-range', new Set([outside]));
  const sample = nativeBashStyleSnapshot(fixture).samples.find((sample) => sample.line === 72);
  assert.deepEqual(sample.nodes.map((node) => node.highlights.map((paint) => paint.text)), [[], ['read'], []]);
  assert.equal(sample.nodes[1].highlights[0].start, start);assert.equal(sample.nodes[1].highlights[0].end, start + 4);
}));

test('does not borrow old-side, mismatched or duplicate new-line samples', async () => withDom(({ root, code }) => {
  code(69).textContent += ' changed';
  const row = code(70).parentElement;row.querySelector('[data-key]').removeAttribute('data-new-line-number');row.querySelector('[data-key]').setAttribute('data-old-line-number', '70');
  root.append(code(72).parentElement.cloneNode(true));
  const samples = nativeBashStyleSnapshot(fixture).samples;
  assert.equal(samples.find((sample) => sample.line === 69).status, 'source_mismatch');
  assert.equal(samples.find((sample) => sample.line === 70).status, 'not_mounted');assert.equal(samples.find((sample) => sample.line === 72).status, 'ambiguous');
}));

test('labels unsupported/truncated highlight coverage and owned registry entries explicitly', async () => withDom(() => {
  delete CSS.highlights;assert.equal(nativeBashStyleSnapshot(fixture).highlights.supported, false);
  CSS.highlights = new Map([['geld-unexpected', new Set()]]);assert.deepEqual(nativeBashStyleSnapshot(fixture).ownership.ownedHighlights, ['geld-unexpected']);
  for (let index = 0; index < 81; index += 1) CSS.highlights.set(`native-${index}`, new Set());
  const value = nativeBashStyleSnapshot(fixture);assert.equal(value.highlights.truncated, true);assert.equal(value.highlights.entries.length, 80);
}));

test('rejects a changed immutable document, ambiguous native roots and owned source copies', async () => withDom(({ window, root }) => {
  window.location.href = fixture.url.replace(fixture.commit, fixture.parent);assert.equal(nativeBashStyleSnapshot(fixture).status, 'wrong_document');window.location.href = fixture.url;
  root.after(root.cloneNode(true));assert.equal(nativeBashStyleSnapshot(fixture).status, 'file_root_unavailable');root.nextElementSibling.dataset.geldUi = '';
  assert.equal(nativeBashStyleSnapshot(fixture).status, 'observed');root.dataset.geldUi = '';assert.equal(nativeBashStyleSnapshot(fixture).status, 'file_root_unavailable');
}));

function events() { const handlers = new Map();return { on: (name, fn) => handlers.set(name, fn), once: (name, fn) => handlers.set(name, fn), off: (name) => handlers.delete(name), handlers }; }
const api = 'https://api.bitbucket.org/2.0/repositories/atlassian/ssh-run/commit/' + fixture.commit;
const request = (method = 'GET', extension = false) => ({ url: () => api, method: () => method, initiator: () => ({ stack: { callFrames: extension ? [{ url: 'chrome-extension://fixture/bitbucket.js' }] : [] } }) });

test('observes existing immutable metadata only and keeps extension/mutation counters beyond retained request caps', async () => {
  const page = events();const item = {};const source = observeNativeBashSources(page, item, { safeUrl: (url) => url, extensionId: 'fixture' });
  for (let index = 0; index < 81; index += 1) page.handlers.get('request')(request());page.handlers.get('request')(request('POST', true));
  page.handlers.get('response')({ request, status: () => 200, url: () => api, headers: () => ({}), json: async () => ({ hash: fixture.commit, parents: [{ hash: fixture.parent }], repository: { full_name: fixture.repository } }) });
  await source.flush();assert.equal(source.evidence.requestCount, 82);assert.equal(source.evidence.requests.length, 80);assert.equal(source.evidence.extensionFrameCount, 1);assert.equal(source.evidence.mutationCount, 1);assert.equal(source.evidence.truncated, true);
  assert.deepEqual(source.evidence.metadata[0].parents, [fixture.parent]);source.stop();assert.equal(page.handlers.has('request'), false);
});

test('retains contradictory or malformed existing metadata as errors instead of changing source identity', async () => {
  for (const body of [{ hash: fixture.parent }, { hash: fixture.commit, parents: [] }, { hash: fixture.commit, repository: 'malformed' }]) {
    const page = events();const source = observeNativeBashSources(page, {}, { safeUrl: (url) => url, extensionId: 'fixture' });
    page.handlers.get('response')({ request, status: () => 200, url: () => api, headers: () => ({}), json: async () => body });await source.flush();assert.equal(source.evidence.metadata.length, 0);assert.equal(source.evidence.errors.length, 1);source.stop();
  }
});

const harness = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');
const runCaseBody = harness.slice(harness.indexOf('async function runCase('), harness.indexOf('\nasync function crossSettingsDom('));
const budgetObserverBody = harness.slice(harness.indexOf('function observeBitbucketBudget('), harness.indexOf('async function runCase('));
function runner({ focus = 'bitbucket-native-bash', closeFailure = false, navigationFailure = false, held = false, restoreFailure = false, restoreMismatch = false } = {}) {
  const order = [];let enabled = true;let closed = false;let reportSaves = 0;const savedReports = [];const itemReport = { cases: [], infrastructureErrors: [], quotaPolicy: { conservativeObservedRequestBudget: 40 } };
  const page = { setViewport: async () => {}, bringToFront: async () => {}, on: () => {}, once: () => {}, url: () => fixture.url, isClosed: () => closed,
    goto: async () => { assert.equal(enabled, false);order.push('navigate-disabled');return { status: () => navigationFailure ? 503 : 200 }; },
    close: async () => { order.push('close');if (closeFailure) throw Error('Synthetic close failure');closed = true; } };
  const context = { assert, report: itemReport, focus, FOCUSED_CASES: { 'bitbucket-native-bash': ['bitbucket-native-bash-style'] }, AbortController, structuredClone,
    providerOf: () => 'bitbucket', cooldowns: new Map(held ? [['bitbucket', Date.now() + 60_000]] : []), SETTINGS_KEY: 'settings', currentCaseAbort: undefined, extensionId: 'fixture', nativeBashSources: new WeakMap(),
    options: { evaluate: async () => ({ enabled: true }) }, patchSettings: async (patch) => { if (patch.enabled) { assert.equal(closed, true, 'Master restore must follow actual page close');if (restoreFailure) { order.push('restore-rejected');throw Error('Synthetic master restoration rejected'); }if (restoreMismatch) { order.push('restore-mismatched');return { enabled: false }; } }enabled = patch.enabled;order.push(`enabled:${enabled}`);return { enabled }; },
    browser: { newPage: async () => { assert.equal(enabled, false);order.push('create-disabled');return page; } },
    observeNativeBashSources: () => ({}), authObservation: async () => ({}), capture: async (_page, _name, options) => { assert.equal(options?.fullPage, false);return {}; },
    safeUrl: (url) => url, closedTarget: () => false, errorText: String, saveReport: async () => { reportSaves += 1;savedReports.push(structuredClone(itemReport)); }, console: { log: () => {} } };
  const run = new vm.Script(`${budgetObserverBody}\n(${runCaseBody})`).runInNewContext(context);
  return { run, order, report: itemReport, enabled: () => enabled, reportSaves: () => reportSaves, savedReports };
}

test('actual runner protocol disables before page creation/navigation and closes before master restoration', async () => {
  const value = runner();await value.run('bitbucket-native-bash-style', fixture.url, async (_page, item) => { item.nativeBashStyle = { artifacts: {} };return { status: 'discovery' }; }, true);
  assert.deepEqual(value.order, ['enabled:false', 'create-disabled', 'navigate-disabled', 'close', 'enabled:true']);assert.equal(value.report.cases[0].status, 'discovery');assert.equal(value.report.cases[0].masterRestoration.pageClosedBeforeRestore, true);
});

test('failed discovery still closes before restoration, while an unclosed page keeps master disabled', async () => {
  const failed = runner({ navigationFailure: true });await failed.run('bitbucket-native-bash-style', fixture.url, async () => {}, true);
  assert.deepEqual(failed.order, ['enabled:false', 'create-disabled', 'navigate-disabled', 'close', 'enabled:true']);assert.equal(failed.report.cases[0].status, 'unavailable');
  const open = runner({ closeFailure: true });await open.run('bitbucket-native-bash-style', fixture.url, async (_page, item) => { item.nativeBashStyle = { artifacts: {} };return { status: 'discovery' }; }, true);
  assert.equal(open.enabled(), false);assert.equal(open.report.cases[0].masterRestoration.restored, false);
});

test('all and unrelated focuses never create a native discovery page or modify master', async () => {
  for (const focus of ['all', 'regression', 'bitbucket-diff']) { const value = runner({ focus });await value.run('bitbucket-native-bash-style', fixture.url, async () => { throw Error('Must not run'); }, true);assert.deepEqual(value.order, []);assert.equal(value.report.cases[0].status, 'not_selected'); }
});

test('keeps unsupported pseudo styles and truncated Text-node samples unknown without a color fallback', async () => withDom(({ window, code }) => {
  const target = code(72);const text = target.textContent;target.replaceChildren(...[...text].map((character) => document.createTextNode(character)));
  const range = { startContainer: target.firstChild, startOffset: 0, endContainer: target.lastChild, endOffset: 1 };CSS.highlights.set('native-static-range', new Set([range]));
  const original = window.getComputedStyle.bind(window);window.getComputedStyle = (node, pseudo) => { if (pseudo) throw Error('Synthetic unsupported pseudo');return original(node); };
  const value = nativeBashStyleSnapshot(fixture);const sample = value.samples.find((sample) => sample.line === 72);
  assert.equal(sample.truncated, true);assert.equal(sample.nodes.length, 32);assert.equal(sample.nodes[0].highlights[0].pseudoStyle, null);
}));

function discoveryProtocol(overrides = {}) {
  const calls = [];const item = {};
  const snapshot = { status: 'observed', header: { canToggle: true }, contentExpanded: true, treeMatches: 0, ownership: { ownedHighlights: [], ownedUi: 0 }, samples: fixture.sourceSamples.map((sample) => ({ line: sample.line, status: 'matched_original', inViewport: true })) };
  const page = { url: () => fixture.url, evaluate: async () => structuredClone(snapshot), $eval: async (selector) => { calls.push({ kind: 'scroll', selector }); }, $: async () => { throw Error('No native control is needed in this synthetic already-expanded protocol'); } };
  const source = { flush: async () => {}, evidence: { errors: [], mutations: [], metadata: [], requests: [], extensionFrameCount: 0, mutationCount: 0 } };
  const dependencies = { poll: async (read, accept) => { const value = await read();assert.ok(accept(value), 'Synthetic bounded poll did not meet its predicate');return value; },
    tabState: async () => ({ allowed: false, hasDiff: false }), source, capture: async () => { calls.push({ kind: 'viewport-capture' });return { screenshot: 'protocol.png' }; }, ...overrides };
  return { page, item, source, calls, dependencies };
}

test('discovery orchestrator limits source actions to its own file and never converts native observations into a feature pass', async () => {
  const value = discoveryProtocol();const result = await discoverNativeBash(value.page, value.item, value.dependencies);
  assert.equal(result.status, 'discovery');assert.equal(result.featureParity, 'not_evaluated');
  assert.equal(value.calls.filter((call) => call.kind === 'scroll').length, 2);assert.ok(value.calls.filter((call) => call.kind === 'scroll').every((call) => call.selector.includes('chg-pipe/pipe.sh')));
  assert.match(value.item.nativeBashStyle.sourceBinding.metadataCoverage, /No matching native commit response/);assert.equal(value.item.nativeBashStyle.status, 'discovery');
});

test('discovery retains failure progress and refuses missing source or extension demand', async () => {
  const unavailable = discoveryProtocol({ tabState: async () => ({ allowed: true, hasDiff: true }) });
  await assert.rejects(discoverNativeBash(unavailable.page, unavailable.item, unavailable.dependencies));assert.equal(unavailable.item.nativeBashStyle.status, 'unavailable');assert.deepEqual(unavailable.calls, []);
  const demand = discoveryProtocol();demand.source.evidence.extensionFrameCount = 1;
  await assert.rejects(discoverNativeBash(demand.page, demand.item, demand.dependencies), /extension-origin API demand/);assert.equal(demand.item.nativeBashStyle.status, 'unavailable');assert.ok(demand.item.nativeBashStyle.after);
});


test('inherited provider holds suppress native discovery before settings or navigation', async () => {
  const value = runner({ held: true });await value.run('bitbucket-native-bash-style', fixture.url, async () => { throw Error('Must not navigate'); }, true);
  assert.deepEqual(value.order, []);assert.equal(value.report.cases[0].status, 'rate_limited');assert.equal(value.report.cases[0].navigationSuppressedByCooldown, true);
});


for (const [name, suppliedHash] of [['full', fixture.parent], ['short7', fixture.parent.slice(0, 7)], ['short12', fixture.parent.slice(0, 12)], ['short39', fixture.parent.slice(0, 39)], ['uppercasePrefix', fixture.parent.slice(0, 12).toUpperCase()]]) {
  test(`accepts native ${name} parent precision without claiming a short hash was fully resolved`, async () => {
    const page = events();const source = observeNativeBashSources(page, {}, { safeUrl: (url) => url, extensionId: 'fixture' });
    page.handlers.get('response')({ request, status: () => 200, url: () => api, headers: () => ({}), json: async () => ({ hash: fixture.commit, parents: [{ hash: suppliedHash }] }) });
    await source.flush();assert.deepEqual(source.evidence.errors, []);
    assert.deepEqual(source.evidence.metadata[0].parents, [suppliedHash]);
    assert.deepEqual(source.evidence.metadata[0].parentEvidence, [{ suppliedHash, characters: suppliedHash.length, precision: suppliedHash.length === fixture.parent.length ? 'full' : 'prefix', agreesWithGitParent: true }]);source.stop();
  });
}

test('rejects conflicting and malformed parent references and a shortened main commit without resolving anything', async () => {
  const invalidParents = [null, {}, [], { hash: undefined }, { hash: 1234567 }, { hash: fixture.parent.slice(0, 6) }, { hash: 'not-a-hash' }, { hash: 'f'.repeat(7) }, { hash: 'a'.repeat(64) }, { hash: fixture.parent + ' ' }];
  const bodies = [...invalidParents.map((parent) => ({ hash: fixture.commit, parents: [parent] })), { hash: fixture.commit.slice(0, 12), parents: [{ hash: fixture.parent.slice(0, 7) }] }];
  for (const body of bodies) {
    const page = events();const source = observeNativeBashSources(page, {}, { safeUrl: (url) => url, extensionId: 'fixture' });
    page.handlers.get('response')({ request, status: () => 200, url: () => api, headers: () => ({}), json: async () => body });await source.flush();
    assert.equal(source.evidence.metadata.length, 0);assert.equal(source.evidence.errors.length, 1);source.stop();
  }
});

for (const mode of ['restoreFailure', 'restoreMismatch']) test(`actual runner records ${mode} after close, marks discovery unavailable and saves the failed cleanup`, async () => {
  const value = runner({ [mode]: true });await value.run('bitbucket-native-bash-style', fixture.url, async (_page, item) => { item.nativeBashStyle = { artifacts: {} };return { status: 'discovery' }; }, true);
  const item = value.report.cases[0];assert.equal(item.status, 'unavailable');assert.equal(item.masterRestoration.pageClosedBeforeRestore, true);
  assert.equal(item.masterRestoration.status, 'failed');assert.equal(item.masterRestoration.restored, false);assert.match(item.masterRestoration.error, /restoration/i);
  assert.equal(value.reportSaves(), 1);assert.equal(value.report.infrastructureErrors.length, 1);assert.equal(value.enabled(), false);
  assert.equal(value.savedReports[0].cases[0].status, 'unavailable');assert.equal(value.savedReports[0].cases[0].masterRestoration.restored, false);assert.match(value.savedReports[0].cases[0].masterRestoration.error, /restoration/i);
  assert.ok(value.order.indexOf('close') < value.order.findIndex((step) => step.startsWith('restore-')));
});
