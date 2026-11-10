import test from 'node:test';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actualTableOverflow, assertTableHeightAction, assertTableHeightSource, assertTableHeightInput, assertTableHeightLastRow, tableHeightPointerInput, tableHeightKeyboardInput, tableHeightRequestObservation, tableHeightProbe, verifyGitLabTableHeights } from './gitlab-table-height-acceptance.mjs';

function geometry(change = {}) { return { presented: true, maxHeight: '490px', overflowY: 'auto', clientHeight: 490, scrollHeight: 800, tableHeight: 800, className: 'gl-max-h-[70vh]', ...change }; }
function snapshot(expanded = false) { return { head: 'a'.repeat(40), height: 700, width: 1200, summaries: [], sameSource: true, sameOwned: true, nativeBody: '<table>Original cells</table>', preference: null, nativeEvents: [], mappingErrors: [], candidates: [{ nativeId: 'markdown-table-176-scroll', sameTarget: true, cells: [['Original cells']], native: geometry(), owned: geometry(expanded ? { className: 'other-native-classes', maxHeight: 'none', clientHeight: 800 } : {}), nativeControls: [{ expanded: 'false', label: 'Show full table' }], button: { label: expanded ? 'Collapse table' : 'Show full table', expanded: String(expanded), targetCount: 1, controlCount: 1, focused: true, enabled: true, same: true, presented: true, hit: { x: 200, y: 350, clipped: false, unobscured: true, chain: [{ tag: 'BUTTON', id: 'owned-table-toggle' }] } } }] }; }
test('actual cap, positive presentation and real scroll overflow are independent requirements', () => {
  assert.equal(actualTableOverflow(geometry(), 700), true);assert.equal(actualTableOverflow(geometry({ maxHeight: '70vh' }), 700), true);
  for (const invalid of [{ presented: false }, { clientHeight: 0 }, { scrollHeight: 490 }, { scrollHeight: 491 }, { tableHeight: 490 }, { overflowY: 'hidden' }, { maxHeight: 'none' }, { maxHeight: '400px' }, { tableHeight: NaN }]) assert.equal(actualTableOverflow(geometry(invalid), 700), false);
});
test('expanded local state preserves native source, preferences, rows, native classes and focused unique control', () => {
  const before = snapshot();const after = snapshot(true);assert.doesNotThrow(() => assertTableHeightAction(after, before, 'markdown-table-176-scroll', true));
  after.candidates[0].native.rect = { top: 1000 };assert.doesNotThrow(() => assertTableHeightAction(after, before, 'markdown-table-176-scroll', true));
  for (const change of [(value) => { value.head = 'b'.repeat(40); }, (value) => { value.nativeBody += 'changed'; }, (value) => { value.preference = 'true'; }, (value) => { value.nativeEvents.push({ isExpanded: true }); }, (value) => { value.mappingErrors.push({ nativeId: 'markdown-table-176-scroll', matches: 0 }); }, (value) => { value.sameOwned = false; }, (value) => { value.candidates[0].sameTarget = false; }, (value) => { value.candidates[0].cells = [['Different']]; }, (value) => { value.candidates[0].native.clientHeight = 0; }, (value) => { value.candidates[0].button.targetCount = 2; }, (value) => { value.candidates[0].button.focused = false; }, (value) => { value.candidates[0].button.expanded = 'false'; }]) { const bad = snapshot(true);change(bad);assert.throws(() => assertTableHeightAction(bad, before, 'markdown-table-176-scroll', true)); }
});
test('missing measurements cannot silently become a source-preserving table pass', () => { assert.throws(() => assertTableHeightSource(null, snapshot()));assert.throws(() => assertTableHeightAction({ ...snapshot(), candidates: [] }, snapshot(), 'markdown-table-176-scroll', false)); });
test('actual table phase is wired before the frozen CodeRabbit action baseline and native controls are never clicked', () => {
  const harness = readFileSync(new URL('./gitlab-coderabbit-acceptance.mjs', import.meta.url), 'utf8');assert.ok(harness.indexOf('await tableHeights(') < harness.indexOf('proof.beforeTrust = before'));
  const browser = readFileSync(new URL('./browser-e2e.mjs', import.meta.url), 'utf8');assert.ok(browser.includes('verifyGitLabTableHeights(page, proof, { ...values, extensionId })'));
  const source = readFileSync(new URL('./gitlab-table-height-acceptance.mjs', import.meta.url), 'utf8');assert.equal(/localStorage\.(setItem|removeItem|clear)|dispatchEvent\(/.test(source), false);assert.ok(source.includes("nativeControls[0].expanded === 'false'"));assert.ok(source.includes('assert.equal(restored.ownedBody, initial.ownedBody'));
});

function unavailableFlow(failure) {
  const page = new EventEmitter();let reads = 0;let held = false;let disposed = false;const proof = {};const before = { ...snapshot(), ownedBody: '<div>Original owned HTML</div>' };before.candidates[0].native.scrollHeight = 490;
  page.evaluate = async (fn) => {
    if (fn === tableHeightProbe) { reads += 1;const value = structuredClone(before);if (failure === 'cleanup' && reads >= 3) value.ownedBody = 'Changed during cleanup';if (failure === 'source' && reads >= 2) value.nativeBody = 'Changed native source';return value; }
    const source = String(fn);
    if (source.includes('globalThis.__geldTableHeightProof = {')) { held = true;return; }
    if (source.includes('requestAnimationFrame')) return;
    if (source.includes("getAttribute('aria-expanded')")) return false;
    if (source.includes('details.length')) return 0;
    if (source.includes('delete globalThis.__geldTableHeightProof')) { disposed = true;held = false;return true; }
    throw new Error('Unexpected offline protocol operation');
  };
  return { page, proof, run: () => verifyGitLabTableHeights(page, proof, { anchor: 'note_11', head: before.head, poll: async () => { throw new Error('No fabricated clipped table'); }, openReviewAncestors: async () => 0, capture: async () => { throw new Error('No fabricated screenshot'); } }), cleanup: () => ({ held, disposed, requests: page.listenerCount('request') }) };
}
test('a real visit without measured native clipping is explicitly unavailable only after exact body/listener cleanup', async () => { const flow = unavailableFlow();const result = await flow.run();assert.equal(result.status, 'unavailable');assert.equal(result.restored, true);assert.equal(result.listenerDisposed, true);assert.deepEqual(result.actions, []);assert.deepEqual(flow.cleanup(), { held: false, disposed: true, requests: 0 }); });
test('missing clipping cannot waive a changed owned body during cleanup', async () => { const flow = unavailableFlow('cleanup');await assert.rejects(flow.run(), /Owned table height cleanup failed/);assert.equal(flow.proof.tableHeight.status, 'failed');assert.deepEqual(flow.cleanup(), { held: false, disposed: true, requests: 0 }); });
test('a changed native source fails before table availability classification and still disposes all diagnostics', async () => { const flow = unavailableFlow('source');await assert.rejects(flow.run());assert.equal(flow.proof.tableHeight.status, 'failed');assert.deepEqual(flow.cleanup(), { held: false, disposed: true, requests: 0 }); });

test('removing the class cannot substitute for measured expanded cap and unclipped client/table/scroll heights', () => {
  const before = snapshot();
  for (const invalid of [{ maxHeight: '490px' }, { clientHeight: 490 }, { scrollHeight: 900 }, { tableHeight: 900 }, { tableHeight: 0 }, { presented: false }]) {
    const after = snapshot(true);Object.assign(after.candidates[0].owned, invalid);assert.throws(() => assertTableHeightAction(after, before, 'markdown-table-176-scroll', true));
  }
});
function reachableRow() {
  const value = snapshot(true);Object.assign(value.candidates[0], { lastRowPresented: true, lastCellPresented: true, lastRow: { top: 650, bottom: 680 }, scrollClip: { top: 100, bottom: 900 }, lastCellHit: { x: 200, y: 665, clipped: false, unobscured: true, clips: [] } });return value;
}
test('a viewport rectangle does not prove a last row survives the actual scroll clip, ancestor clips or an overlay', () => {
  assert.doesNotThrow(() => assertTableHeightLastRow(reachableRow(), snapshot(), 'markdown-table-176-scroll'));
  for (const change of [(row) => { row.scrollClip.bottom = 660; }, (row) => { row.lastCellHit.clipped = true; }, (row) => { row.lastCellHit.unobscured = false; }, (row) => { row.lastCellHit.clips.push({ clipY: true, top: 100, bottom: 660 }); }, (row) => { row.lastCellPresented = false; }]) {
    const value = reachableRow();change(value.candidates[0]);assert.throws(() => assertTableHeightLastRow(value, snapshot(), 'markdown-table-176-scroll'));
  }
  const beyond = reachableRow();beyond.height = 660;assert.throws(() => assertTableHeightLastRow(beyond, snapshot(), 'markdown-table-176-scroll'));
});
test('trusted pointer input rechecks the actual hit/source after scrolling and never clicks through a newly covered control', async () => {
  for (const change of [(value) => { value.candidates[0].button.hit.unobscured = false; }, (value) => { value.candidates[0].button.hit.clipped = true; }, (value) => { value.candidates[0].button.same = false; }, (value) => { value.candidates[0].button.enabled = false; }, (value) => { value.head = 'b'.repeat(40); }]) {
    let clicks = 0;let reads = 0;const inputs = [];const later = snapshot();change(later);
    await assert.rejects(tableHeightPointerInput({ evaluate: async () => {}, mouse: { click: async () => { clicks += 1; } } }, { evaluate: async () => {} }, { before: snapshot(), nativeId: 'markdown-table-176-scroll', read: async () => ++reads === 1 ? snapshot() : later, inputs, label: 'expand' }));
    assert.equal(clicks, 0);assert.equal(reads, 2);assert.equal(inputs.length, 1);assert.equal(inputs[0].sent, undefined);assert.ok(inputs[0].current);
  }
  const clicks = [];const inputs = [];
  await tableHeightPointerInput({ evaluate: async () => {}, mouse: { click: async (...point) => clicks.push(point) } }, { evaluate: async () => {} }, { before: snapshot(), nativeId: 'markdown-table-176-scroll', read: async () => snapshot(), inputs, label: 'expand' });
  assert.deepEqual(clicks, [[200, 350]]);assert.equal(inputs[0].sent, true);assert.deepEqual(inputs[0].current.candidates[0].button.hit.chain, [{ tag: 'BUTTON', id: 'owned-table-toggle' }]);
});
test('keyboard input requires the same focused, visible, unobscured source-bound button', async () => {
  for (const change of [(value) => { value.candidates[0].button.focused = false; }, (value) => { value.candidates[0].button.hit.unobscured = false; }, (value) => { value.sameSource = false; }]) {
    let presses = 0;const inputs = [];const value = snapshot();change(value);
    await assert.rejects(tableHeightKeyboardInput({ evaluate: async () => {}, keyboard: { press: async () => { presses += 1; } } }, 'Enter', { before: snapshot(), nativeId: 'markdown-table-176-scroll', read: async () => value, inputs }));assert.equal(presses, 0);assert.equal(inputs[0].sent, undefined);
  }
});
test('all HTTP GETs are recorded with source/other scope, including native metadata, raw and diff routes outside api/json', () => {
  const observe = (path, extra = {}) => tableHeightRequestObservation({ url: 'https://gitlab.com' + path, method: 'GET', ...extra }, 'actual-extension');
  for (const path of ['/ark-bitcoin/bark/-/merge_requests/2117/diffs_metadata', '/ark-bitcoin/bark/-/raw/main/.gitlab-ci.yml', '/ark-bitcoin/bark/-/merge_requests/2117.diff', '/ark-bitcoin/bark/-/merge_requests/2117/diffs.json', '/api/v4/projects/ark-bitcoin%2Fbark/merge_requests/2117']) assert.equal(observe(path).source, true, path);
  assert.equal(observe('/assets/native-style.css').source, false);
  assert.equal(tableHeightRequestObservation({ url: 'https://images.example/avatar.png', method: 'GET' }, 'actual-extension').source, false);
  const extension = observe('/otherwise-unknown', { initiator: { stack: { callFrames: [{ url: 'chrome-extension://actual-extension/content.js' }] } } });assert.equal(extension.source, true);assert.equal(extension.attribution, 'extension_frame_observed');
  assert.equal(observe('/api/other', { method: 'POST' }), null);assert.equal(observe('/api/other', { url: 'data:text/plain,hello' }), null);
});
test('summary restoration uses the same hit/source guard even when no table qualifies for height acceptance', () => {
  const value = snapshot();value.candidates = [];value.summaries = [{ same: true, presented: true, hit: { x: 100, y: 200, clipped: false, unobscured: true } }];assert.doesNotThrow(() => assertTableHeightInput(value, snapshot(), undefined, { summary: 0 }));value.summaries[0].hit.unobscured = false;assert.throws(() => assertTableHeightInput(value, snapshot(), undefined, { summary: 0 }));
});

test('readonly DOM projection detects a real ancestor clip and an elementFromPoint overlay despite positive viewport rectangles', async () => {
  const { Window } = await import('happy-dom');const window = new Window({ url: 'https://gitlab.com/ark-bitcoin/bark/-/merge_requests/2117', settings: { enableCSSFileLoading: false, enableJavaScriptEvaluation: false, enableImageFileLoading: false } });
  const keys = ['document', 'getComputedStyle', 'HTMLDetailsElement', 'NodeFilter', 'localStorage', 'innerWidth', 'innerHeight', '__geldTableHeightProof'];const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries({ document: window.document, getComputedStyle: window.getComputedStyle.bind(window), HTMLDetailsElement: window.HTMLDetailsElement, NodeFilter: window.NodeFilter, localStorage: window.localStorage, innerWidth: 1200, innerHeight: 700 })) Object.defineProperty(globalThis, key, { configurable: true, value });
    const table = '<table data-markdown-table-applied="true"><tbody><tr><td>First original cell</td></tr><tr><td>Last original cell</td></tr></tbody></table>';
    document.body.innerHTML = `<article id="note_11"><div class="note-body"><div class="note-text"><div id="markdown-table-176-scroll" data-sticky-header style="max-height:490px;overflow-y:auto">${table}</div></div></div></article><section class="geld-provider-review" data-geld-review-head="${'a'.repeat(40)}"><div id="clipper"><article data-geld-source="note_11"><div class="geld-provider-review__body"><div class="note-text"><div id="owned-scroll" class="gl-overflow-y-auto" style="max-height:none;overflow-y:auto">${table}</div><div data-geld-table-height><button id="owned-control" aria-controls="owned-scroll" aria-expanded="true">Collapse table</button></div></div></div></article></div></section><div id="overlay">Unrelated native overlay</div>`;
    const bounds = (top, height, left = 100, width = 300) => ({ top, bottom: top + height, left, right: left + width, width, height });
    for (const node of document.querySelectorAll('*')) node.getBoundingClientRect = () => bounds(100, 40);
    const note = document.getElementById('note_11');const owned = document.querySelector('.geld-provider-review__body > .note-text');const button = document.getElementById('owned-control');const target = document.getElementById('owned-scroll');const ownTable = target.querySelector('table');const lastRow = ownTable.rows[1];const lastCell = lastRow.cells[0];const clipper = document.getElementById('clipper');
    const dimensions = (node, values) => { for (const [key, value] of Object.entries(values)) Object.defineProperty(node, key, { configurable: true, value }); };
    dimensions(target, { clientHeight: 800, scrollHeight: 800, clientWidth: 300 });target.getBoundingClientRect = () => bounds(100, 800);dimensions(ownTable, { offsetHeight: 800 });lastRow.getBoundingClientRect = () => bounds(650, 30);lastCell.getBoundingClientRect = () => bounds(650, 30);button.getBoundingClientRect = () => bounds(330, 40);clipper.getBoundingClientRect = () => bounds(100, 300);dimensions(clipper, { clientHeight: 300, clientWidth: 300 });
    const native = document.getElementById('markdown-table-176-scroll');dimensions(native, { clientHeight: 490, scrollHeight: 800 });dimensions(native.querySelector('table'), { offsetHeight: 800 });
    let covered = false;document.elementFromPoint = (_x, y) => covered ? document.getElementById('overlay') : y < 400 ? button : lastCell;
    globalThis.__geldTableHeightProof = { note, noteParent: note.parentElement, nativeBody: note.querySelector('.note-body .note-text'), owned, ownedParent: owned.parentElement, target, table: ownTable, button, details: [], events: [], nativeEvents: [] };button.focus();
    const before = tableHeightProbe('note_11');assert.doesNotThrow(() => assertTableHeightLastRow(before, before, 'markdown-table-176-scroll'));assert.doesNotThrow(() => assertTableHeightInput(before, before, 'markdown-table-176-scroll'));
    clipper.style.overflowY = 'hidden';const clipped = tableHeightProbe('note_11');assert.equal(clipped.candidates[0].lastRow.bottom, 680);assert.equal(clipped.candidates[0].lastCellHit.clipped, true);assert.throws(() => assertTableHeightLastRow(clipped, before, 'markdown-table-176-scroll'));
    clipper.style.overflowY = 'visible';covered = true;const blocked = tableHeightProbe('note_11');assert.equal(blocked.candidates[0].button.hit.chain[0].id, 'overlay');assert.throws(() => assertTableHeightInput(blocked, before, 'markdown-table-176-scroll'));assert.throws(() => assertTableHeightLastRow(blocked, before, 'markdown-table-176-scroll'));
  } finally {
    for (const [key, descriptor] of previous) if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor);window.happyDOM.abort();
  }
});
