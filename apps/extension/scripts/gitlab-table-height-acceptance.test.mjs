import test from 'node:test';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actualTableOverflow, tableHeightAuthority, assertTableHeightAction, assertTableHeightSource, assertTableHeightInput, assertTableHeightLastRow, tableHeightPointerInput, tableHeightKeyboardInput, tableHeightRequestObservation, tableHeightProbe, verifyGitLabTableHeights } from './gitlab-table-height-acceptance.mjs';

function geometry(change = {}) { return { presented: true, maxHeight: '490px', overflowY: 'auto', clientHeight: 490, scrollHeight: 800, tableHeight: 800, className: 'gl-max-h-[70vh]', ...change }; }
function snapshot(expanded = false) { return { head: 'a'.repeat(40), height: 700, width: 1200, summaries: [], sameSource: true, sameOwned: true, nativeBody: '<table>Original cells</table>', preference: null, nativeEvents: [], mappingErrors: [], candidates: [{ nativeId: 'markdown-table-176-scroll', sameTarget: true, sameNativeControl: true, ownedAuthority: 'actual-native-geometry', nativeHiddenReasons: [], nativeIntentQualified: false, cells: [['Original cells']], native: geometry(), owned: geometry(expanded ? { className: 'other-native-classes', maxHeight: 'none', clientHeight: 800 } : {}), nativeControls: [{ expanded: 'false', label: 'Show full table' }], button: { label: expanded ? 'Collapse table' : 'Show full table', expanded: String(expanded), targetCount: 1, controlCount: 1, focused: true, enabled: true, same: true, presented: true, hit: { x: 200, y: 350, clipped: false, unobscured: true, chain: [{ tag: 'BUTTON', id: 'owned-table-toggle' }] } } }] }; }
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
  const source = readFileSync(new URL('./gitlab-table-height-acceptance.mjs', import.meta.url), 'utf8');assert.equal(/localStorage\.(setItem|removeItem|clear)|dispatchEvent\(/.test(source), false);assert.ok(source.includes('nativeIntentQualified: qualifiedIntent'));assert.ok(source.includes('assert.equal(restored.ownedBody, initial.ownedBody'));
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
  const keys = ['document', 'getComputedStyle', 'HTMLDetailsElement', 'Node', 'NodeFilter', 'localStorage', 'innerWidth', 'innerHeight', '__geldTableHeightProof'];const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries({ document: window.document, getComputedStyle: window.getComputedStyle.bind(window), HTMLDetailsElement: window.HTMLDetailsElement, Node: window.Node, NodeFilter: window.NodeFilter, localStorage: window.localStorage, innerWidth: 1200, innerHeight: 700 })) Object.defineProperty(globalThis, key, { configurable: true, value });
    const table = '<table data-markdown-table-applied="true"><tbody><tr><td>First original cell</td></tr><tr><td>Last original cell</td></tr></tbody></table>';
    document.body.innerHTML = `<article id="note_11"><div class="note-body"><div class="note-text"><div id="markdown-table-176-scroll" data-sticky-header style="max-height:490px;overflow-y:auto">${table}</div></div></div></article><section class="geld-provider-review" data-geld-review-head="${'a'.repeat(40)}"><div id="clipper"><article data-geld-source="note_11"><div class="geld-provider-review__body"><div class="note-text"><div id="owned-scroll" class="gl-overflow-y-auto" style="max-height:none;overflow-y:auto">${table}</div><div data-geld-table-height data-geld-table-height-authority="actual-native-geometry"><button id="owned-control" aria-controls="owned-scroll" aria-expanded="true">Collapse table</button></div></div></div></article></div></section><div id="overlay">Unrelated native overlay</div>`;
    const bounds = (top, height, left = 100, width = 300) => ({ top, bottom: top + height, left, right: left + width, width, height });
    for (const node of document.querySelectorAll('*')) node.getBoundingClientRect = () => bounds(100, 40);
    const note = document.getElementById('note_11');const owned = document.querySelector('.geld-provider-review__body > .note-text');const button = document.getElementById('owned-control');const target = document.getElementById('owned-scroll');const ownTable = target.querySelector('table');const lastRow = ownTable.rows[1];const lastCell = lastRow.cells[0];const clipper = document.getElementById('clipper');
    const dimensions = (node, values) => { for (const [key, value] of Object.entries(values)) Object.defineProperty(node, key, { configurable: true, value }); };
    dimensions(target, { clientHeight: 800, scrollHeight: 800, clientWidth: 300 });target.getBoundingClientRect = () => bounds(100, 800);dimensions(ownTable, { offsetHeight: 800 });lastRow.getBoundingClientRect = () => bounds(650, 30);lastCell.getBoundingClientRect = () => bounds(650, 30);button.getBoundingClientRect = () => bounds(330, 40);clipper.getBoundingClientRect = () => bounds(100, 300);dimensions(clipper, { clientHeight: 300, clientWidth: 300 });
    const native = document.getElementById('markdown-table-176-scroll');dimensions(native, { clientHeight: 490, scrollHeight: 800 });dimensions(native.querySelector('table'), { offsetHeight: 800 });
    let covered = false;document.elementFromPoint = (_x, y) => covered ? document.getElementById('overlay') : y < 400 ? button : lastCell;
    globalThis.__geldTableHeightProof = { note, noteParent: note.parentElement, nativeBody: note.querySelector('.note-body .note-text'), owned, ownedParent: owned.parentElement, target, table: ownTable, button, nativeControl: null, details: [], events: [], nativeEvents: [] };button.focus();
    const before = tableHeightProbe('note_11');assert.deepEqual(before.activeElement,{tag:'BUTTON',id:'owned-control',classes:[],classesTruncated:false,isConnected:true,insideCurrentButton:true,insideOwnedSource:true});assert.doesNotThrow(() => assertTableHeightLastRow(before, before, 'markdown-table-176-scroll'));assert.doesNotThrow(() => assertTableHeightInput(before, before, 'markdown-table-176-scroll'));
    clipper.style.overflowY = 'hidden';const clipped = tableHeightProbe('note_11');assert.equal(clipped.candidates[0].lastRow.bottom, 680);assert.equal(clipped.candidates[0].lastCellHit.clipped, true);assert.throws(() => assertTableHeightLastRow(clipped, before, 'markdown-table-176-scroll'));
    clipper.style.overflowY = 'visible';covered = true;const blocked = tableHeightProbe('note_11');assert.equal(blocked.candidates[0].button.hit.chain[0].id, 'overlay');assert.throws(() => assertTableHeightInput(blocked, before, 'markdown-table-176-scroll'));assert.throws(() => assertTableHeightLastRow(blocked, before, 'markdown-table-176-scroll'));
    covered = false;native.removeAttribute('style');native.className = 'gl-max-h-[70vh] gl-w-fit gl-max-w-full gl-overflow-x-auto gl-overflow-y-auto print:gl-max-h-none';native.setAttribute('data-print-scale-container', '');
    const style = document.createElement('style');style.textContent = '#markdown-table-176-scroll{max-height:490px;overflow-y:auto}';document.head.append(style);
    const source = note.querySelector('.note-body .note-text');const details = document.createElement('details');details.innerHTML = '<summary>Walkthrough</summary><div class="gl-table-shadow-overlay" data-testid="table-shadow-overlay"></div><div class="gl-order-1 gl-mt-2 gl-flex gl-justify-center print:gl-hidden"><button type="button" class="btn gl-button btn-default btn-sm btn-default-tertiary" data-testid="markdown-table-height-toggle" aria-expanded="false" aria-controls="markdown-table-176-scroll"><svg aria-hidden="true"><path d="M0 0"></path></svg><span class="gl-button-text">Show full table</span></button></div>';
    details.querySelector('[data-testid="table-shadow-overlay"]').append(native);source.append(details);note.setAttribute('hidden', 'until-found');const nativeControl = details.querySelector('button');globalThis.__geldTableHeightProof.nativeControl = nativeControl;button.parentElement.dataset.geldTableHeightAuthority = 'hidden-native-generated-control';
    const hidden = tableHeightProbe('note_11');assert.equal(hidden.candidates[0].native.presented, false);assert.equal(hidden.candidates[0].nativeIntentQualified, true);assert.equal(tableHeightAuthority(hidden.candidates[0], hidden.height), 'hidden-native-generated-control');assert.deepEqual(hidden.candidates[0].nativeHiddenReasons.map((reason) => reason.reason), ['closed details', 'hidden:until-found']);assert.doesNotThrow(() => assertTableHeightLastRow(hidden, hidden, 'markdown-table-176-scroll'));
    nativeControl.querySelector('span').textContent = 'Authored command';const wrong = tableHeightProbe('note_11');assert.equal(wrong.candidates[0].nativeIntentQualified, false);assert.equal(tableHeightAuthority(wrong.candidates[0], wrong.height), null);
    nativeControl.querySelector('span').textContent = 'Show full table';note.removeAttribute('hidden');details.open = true;
    for (const [property, setting, reason] of [['opacity', '0', 'opacity:0'], ['visibility', 'collapse', 'visibility:collapse']]) {
      source.style[property] = setting;const invisible = tableHeightProbe('note_11');assert.equal(invisible.candidates[0].native.presented, false);assert.ok(invisible.candidates[0].nativeHiddenReasons.length > 0);assert.ok(invisible.candidates[0].nativeHiddenReasons.every((value) => value.reason === reason));assert.equal(tableHeightAuthority(invisible.candidates[0], invisible.height), 'hidden-native-generated-control');source.style[property] = '';
    }
    nativeControl.replaceWith(nativeControl.cloneNode(true));const replacement = tableHeightProbe('note_11');assert.equal(replacement.candidates[0].nativeIntentQualified, true);assert.equal(replacement.candidates[0].sameNativeControl, false);assert.throws(() => assertTableHeightAction(replacement, hidden, 'markdown-table-176-scroll', true));

  } finally {
    for (const [key, descriptor] of previous) if (descriptor === undefined) delete globalThis[key];else Object.defineProperty(globalThis, key, descriptor);window.happyDOM.abort();
  }
});

test('hidden generated intent authorizes measured owned expansion without pretending native layout was presented', () => {
  const before = snapshot();const after = snapshot(true);
  for (const value of [before, after]) { const row = value.candidates[0];row.native = geometry({ presented: false, clientHeight: 0, scrollHeight: 0, tableHeight: 0 });row.nativeIntentQualified = true;row.nativeHiddenReasons = [{ tag: 'LI', id: 'note_11', reason: 'hidden:until-found' }];row.ownedAuthority = 'hidden-native-generated-control'; }
  assert.equal(actualTableOverflow(before.candidates[0].native, before.height), false);assert.equal(tableHeightAuthority(before.candidates[0], before.height), 'hidden-native-generated-control');assert.doesNotThrow(() => assertTableHeightAction(after, before, 'markdown-table-176-scroll', true));
  for (const change of [(row) => { row.nativeIntentQualified = false; }, (row) => { row.nativeHiddenReasons = []; }, (row) => { row.native.presented = true; }]) { const value = structuredClone(before);change(value.candidates[0]);assert.equal(tableHeightAuthority(value.candidates[0], value.height), null); }
});
test('native control replacement and an invented authority label fail before a trusted height input', () => {
  for (const change of [(row) => { row.sameNativeControl = false; }, (row) => { row.ownedAuthority = 'hidden-native-generated-control'; }, (row) => { row.ownedAuthority = null; }]) { const value = snapshot();change(value.candidates[0]);assert.throws(() => assertTableHeightInput(value, snapshot(), 'markdown-table-176-scroll')); }
});

test('post-capture focus failure retains the exact failed sample and still restores/disposes diagnostics',async()=>{
 const page=new EventEmitter();let expanded=false,captured=false;const events=[];const proof={};
 const read=()=>{
  const value=snapshot(expanded);value.ownedBody='<div>unchanged owned body</div>';value.events=structuredClone(events);value.activeElement={tag:'BODY',id:'',classes:[],isConnected:true,insideCurrentButton:false,insideOwnedSource:false};
  const row=value.candidates[0];row.button.id='owned-toggle';row.button.focused=!captured;Object.assign(row,{lastRowPresented:true,lastCellPresented:true,lastRow:{top:200,bottom:240},scrollClip:{top:100,bottom:650},lastCellHit:{clipped:false,unobscured:true,clips:[]}});return value;
 };
 page.evaluate=async(fn)=>{
  if(fn===tableHeightProbe)return read();const source=String(fn);
  if(source.includes("getAttribute('aria-expanded')"))return expanded;
  if(source.includes('details.length'))return 0;
  if(source.includes('delete globalThis.__geldTableHeightProof'))return true;
 };
 page.mouse={click:async()=>{expanded=!expanded;events.push({type:'click',trusted:true});}};
 page.keyboard={press:async()=>{expanded=!expanded;events.push({type:'click',trusted:true});}};
 page.$=async()=>({evaluate:async()=>{},dispose:async()=>{}});
 await assert.rejects(verifyGitLabTableHeights(page,proof,{anchor:'note_11',head:'a'.repeat(40),poll:async(fn,accepts)=>{const value=await fn();assert.ok(accepts(value));return value;},capture:async()=>{captured=true;return{png:'synthetic-only'};}}),/Actual owned table control lost focus/);
 const result=proof.tableHeight;assert.equal(result.status,'failed');assert.equal(result.actions.length,4);assert.equal(result.afterCapture.candidates[0].button.focused,false);assert.equal(result.afterCapture.activeElement.tag,'BODY');assert.equal(result.restored,true);assert.equal(result.listenerDisposed,true);assert.equal(page.listenerCount('request'),0);
});
test('post-capture boolean failures identify the exact ownership/focus/cap requirement',()=>{
 for(const [change,message]of [
  [value=>{value.sameSource=false;},/native table note\/body ownership/],
  [value=>{value.sameOwned=false;},/owned table note\/body ownership/],
  [value=>{value.candidates[0].button.focused=false;},/control lost focus/],
  [value=>{value.candidates[0].owned.className='';},/height-cap class/],
 ]){const value=snapshot();change(value);assert.throws(()=>assertTableHeightAction(value,snapshot(),'markdown-table-176-scroll',false),message);}
});
