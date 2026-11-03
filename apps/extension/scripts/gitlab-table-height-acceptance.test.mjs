import test from 'node:test';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actualTableOverflow, tableHeightAuthority, assertTableHeightAction, assertTableHeightSource, assertTableHeightInput, assertTableHeightLastRow, tableHeightPointerInput, tableHeightKeyboardInput, tableHeightRequestObservation, tableHeightProbe, tableFocusTrace, verifyGitLabTableHeights } from './gitlab-table-height-acceptance.mjs';

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
 page.evaluate=async(fn,action,phase)=>{
  if(fn===tableFocusTrace)return {records:[{kind:'state',phase}],stopped:action==='cleanup',framePending:false};
  if(fn===tableHeightProbe)return read();const source=String(fn);
  if(source.includes("getAttribute('aria-expanded')"))return expanded;
  if(source.includes('details.length'))return 0;
  if(source.includes('delete globalThis.__geldTableHeightProof'))return true;
 };
 page.mouse={click:async()=>{expanded=!expanded;events.push({type:'click',trusted:true});}};
 page.keyboard={press:async()=>{expanded=!expanded;events.push({type:'click',trusted:true});}};
 page.$=async()=>({evaluate:async()=>{},dispose:async()=>{}});
 await assert.rejects(verifyGitLabTableHeights(page,proof,{anchor:'note_11',head:'a'.repeat(40),poll:async(fn,accepts)=>{const value=await fn();assert.ok(accepts(value));return value;},capture:async(_page,_name,{fullPage,onStage})=>{assert.equal(fullPage,false);captured=true;await onStage('after_screenshot');await onStage('after_dom_read');await onStage('after_accessibility_read');return{png:'synthetic-only'};}}),/Actual owned table control lost focus/);
 const result=proof.tableHeight;assert.equal(result.status,'failed');assert.equal(result.actions.length,4);assert.equal(result.afterCapture.candidates[0].button.focused,false);assert.equal(result.afterCapture.activeElement.tag,'BODY');assert.deepEqual(result.captureStages.map(stage=>stage.stage),['after_screenshot','after_dom_read','after_accessibility_read']);assert.equal(result.captureStages[0].snapshot.candidates[0].button.focused,false);assert.equal(result.traceDisposed,true);assert.equal(result.restored,true);assert.equal(result.listenerDisposed,true);assert.equal(page.listenerCount('request'),0);
});
test('viewport-only table capture preserves all four input and post-capture source/focus guards',async()=>{
 const page=new EventEmitter();let expanded=false,captured=false;const events=[];const proof={};
 const read=()=>{
  const value=snapshot(expanded);value.ownedBody='<div>unchanged owned body</div>';value.events=structuredClone(events);value.activeElement={tag:captured?'BODY':'BUTTON',id:captured?'':'owned-toggle',classes:[],isConnected:true,insideCurrentButton:!captured,insideOwnedSource:!captured};
  const row=value.candidates[0];row.button.id='owned-toggle';row.button.focused=!captured;Object.assign(row,{lastRowPresented:true,lastCellPresented:true,lastRow:{top:200,bottom:240},scrollClip:{top:100,bottom:650},lastCellHit:{clipped:false,unobscured:true,clips:[]}});return value;
 };
 page.evaluate=async(fn,action,phase)=>{
  if(fn===tableFocusTrace)return {records:[{kind:'state',phase}],stopped:action==='cleanup',framePending:false};
  if(fn===tableHeightProbe)return read();const source=String(fn);
  if(source.includes("getAttribute('aria-expanded')"))return expanded;
  if(source.includes('details.length'))return 0;
  if(source.includes('delete globalThis.__geldTableHeightProof'))return true;
 };
 page.mouse={click:async()=>{expanded=!expanded;events.push({type:'click',trusted:true});}};
 page.keyboard={press:async()=>{expanded=!expanded;events.push({type:'click',trusted:true});}};
 page.$=async()=>({evaluate:async()=>{},dispose:async()=>{}});
 await verifyGitLabTableHeights(page,proof,{anchor:'note_11',head:'a'.repeat(40),poll:async(fn,accepts)=>{const value=await fn();assert.ok(accepts(value));return value;},capture:async(_page,_name,{fullPage,onStage})=>{assert.equal(fullPage,false);captured=fullPage;await onStage('after_screenshot');await onStage('after_dom_read');await onStage('after_accessibility_read');return{png:'synthetic-only'};}});
 const result=proof.tableHeight;assert.equal(result.status,'passed');assert.equal(result.actions.length,4);assert.equal(result.afterCapture.candidates[0].button.focused,true);assert.equal(result.afterCapture.activeElement.tag,'BUTTON');assert.deepEqual(result.captureStages.map(stage=>stage.stage),['after_screenshot','after_dom_read','after_accessibility_read']);assert.equal(result.captureStages[0].snapshot.candidates[0].button.focused,true);assert.equal(result.traceDisposed,true);assert.equal(result.restored,true);assert.equal(result.listenerDisposed,true);assert.equal(page.listenerCount('request'),0);
});
test('capture-stage read failure retains partial phase evidence and still stops tracing/restores ownership',async()=>{
 const page=new EventEmitter();let expanded=false,captured=false;const events=[];const proof={};
 const read=()=>{
  const value=snapshot(expanded);value.ownedBody='<div>unchanged owned body</div>';value.events=structuredClone(events);value.activeElement={tag:'BODY',id:'',classes:[],isConnected:true,insideCurrentButton:false,insideOwnedSource:false};
  const row=value.candidates[0];row.button.id='owned-toggle';row.button.focused=!captured;Object.assign(row,{lastRowPresented:true,lastCellPresented:true,lastRow:{top:200,bottom:240},scrollClip:{top:100,bottom:650},lastCellHit:{clipped:false,unobscured:true,clips:[]}});return value;
 };
 page.evaluate=async(fn,action,phase)=>{
  if(fn===tableFocusTrace)return {records:[{kind:'state',phase}],stopped:action==='cleanup',framePending:false};
  if(fn===tableHeightProbe){if(captured){captured=false;throw Error('Synthetic capture-stage read failed');}return read();}const source=String(fn);
  if(source.includes("getAttribute('aria-expanded')"))return expanded;
  if(source.includes('details.length'))return 0;
  if(source.includes('delete globalThis.__geldTableHeightProof'))return true;
 };
 page.mouse={click:async()=>{expanded=!expanded;events.push({type:'click',trusted:true});}};
 page.keyboard={press:async()=>{expanded=!expanded;events.push({type:'click',trusted:true});}};
 page.$=async()=>({evaluate:async()=>{},dispose:async()=>{}});
 await assert.rejects(verifyGitLabTableHeights(page,proof,{anchor:'note_11',head:'a'.repeat(40),poll:async(fn,accepts)=>{const value=await fn();assert.ok(accepts(value));return value;},capture:async(_page,_name,{fullPage,onStage})=>{assert.equal(fullPage,false);captured=true;await onStage('after_screenshot');await onStage('after_dom_read');await onStage('after_accessibility_read');return{png:'synthetic-only'};}}),/Synthetic capture-stage read failed|Owned table height cleanup failed/);
 const result=proof.tableHeight;assert.equal(result.status,'failed');assert.equal(result.actions.length,4);assert.equal(result.captureStages.length,1);assert.equal(result.captureStages[0].stage,'after_screenshot');assert.ok(result.captureStages[0].trace);assert.equal(result.captureStages[0].snapshot,undefined);assert.equal(result.restored,true);assert.equal(result.traceDisposed,true);assert.equal(result.listenerDisposed,true);assert.equal(page.listenerCount('request'),0);
});
test('post-capture boolean failures identify the exact ownership/focus/cap requirement',()=>{
 for(const [change,message]of [
  [value=>{value.sameSource=false;},/native table note\/body ownership/],
  [value=>{value.sameOwned=false;},/owned table note\/body ownership/],
  [value=>{value.candidates[0].button.focused=false;},/control lost focus/],
  [value=>{value.candidates[0].owned.className='';},/height-cap class/],
 ]){const value=snapshot();change(value);assert.throws(()=>assertTableHeightAction(value,snapshot(),'markdown-table-176-scroll',false),message);}
});

async function traceFixture(run) {
 const {Window}=await import('happy-dom');const win=new Window({url:'https://gitlab.com/ark-bitcoin/bark/-/merge_requests/2117',settings:{enableCSSFileLoading:false,enableJavaScriptEvaluation:false,enableImageFileLoading:false}});
 const frames=new Map();const observerInstances=new Set();const listeners=new Set();let next=0;const keys=['document','window','Element','HTMLDetailsElement','MutationObserver','getComputedStyle','innerWidth','innerHeight','requestAnimationFrame','cancelAnimationFrame','__geldTableHeightProof'];const old=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 try {
  class ObservedMutationObserver extends win.MutationObserver {constructor(callback){super(callback);observerInstances.add(this);}disconnect(){observerInstances.delete(this);super.disconnect();}}
  for(const target of [win.document,win]){const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);target.addEventListener=(type,listener,...args)=>{if(['focusin','focusout','blur','resize'].includes(type))listeners.add(listener);return add(type,listener,...args);};target.removeEventListener=(type,listener,...args)=>{listeners.delete(listener);return remove(type,listener,...args);};}
  const values={window:win,document:win.document,Element:win.Element,HTMLDetailsElement:win.HTMLDetailsElement,MutationObserver:ObservedMutationObserver,getComputedStyle:win.getComputedStyle.bind(win),innerWidth:1200,innerHeight:1000,requestAnimationFrame:fn=>{const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)};
  for(const[key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  document.body.innerHTML='<main><section class="geld-provider-review"><article><div class="note-text"><div id="target" style="max-height:700px;overflow-y:auto"><table><tbody><tr><td>PRIVATE-CELL-NOT-FOR-TRACE</td></tr></tbody></table></div><div data-geld-table-height-authority="hidden-native-generated-control"><button id="exact-control">PRIVATE-BUTTON-TEXT</button></div></div></article></section></main><aside id="unrelated">PRIVATE-OTHER-TEXT</aside>';
  const owned=document.querySelector('.note-text'),button=document.querySelector('button'),controls=button.parentElement,target=document.getElementById('target');
  globalThis.__geldTableHeightProof={button,target,table:target.querySelector('table'),owned,nativeControl:null,nativeId:'markdown-table-176-scroll'};
  const read=()=>tableFocusTrace();const flush=()=>{for(const[id,fn]of [...frames]){frames.delete(id);fn();}};
  await run({win,button,owned,controls,target,read,flush,frames,observerInstances,listeners});
 }finally{tableFocusTrace('cleanup');for(const[key,value]of old)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];win.happyDOM.abort();}
}
test('trace detects same-node control removal/reinsertion independently of final ownership and cancels its pending frame',async()=>{
 await traceFixture(async({win,button,controls,owned,read,frames,observerInstances,listeners})=>{
  tableFocusTrace('setup');button.focus();controls.remove();owned.append(controls);const result=tableFocusTrace('stage','after_screenshot');
  const removal=result.records.find(row=>row.kind==='childList'&&row.removed.some(node=>node.sameControls));const addition=result.records.find(row=>row.kind==='childList'&&row.added.some(node=>node.sameControls));
  assert.ok(removal);assert.ok(addition);assert.equal(button.isConnected,true);assert.equal(controls.contains(button),true);assert.ok(result.records.some(row=>row.kind==='focusin'&&row.target.sameButton));assert.equal(frames.size,1);
  const stopped=tableFocusTrace('cleanup');assert.equal(stopped.stopped,true);assert.equal(stopped.framePending,false);assert.equal(frames.size,0);assert.equal(observerInstances.size,0);assert.equal(listeners.size,0);const length=stopped.records.length;button.dispatchEvent(new win.FocusEvent('focusout',{bubbles:true}));assert.equal(read().records.length,length);
 });
});
test('trace coalesces event-driven layout reads, records viewport/style state changes and stays idle without events',async()=>{
 await traceFixture(async({win,button,owned,read,flush,frames})=>{
  tableFocusTrace('setup');const initial=read().records.length;assert.equal(frames.size,0);button.focus();win.dispatchEvent(new win.Event('resize'));win.dispatchEvent(new win.Event('resize'));assert.equal(frames.size,1);flush();assert.equal(frames.size,0);
  const after=read().records.length;flush();assert.equal(read().records.length,after);assert.ok(after>initial);
  delete button.parentElement.dataset.geldTableHeightAuthority;owned.hidden=true;owned.style.fontSize='17px';owned.style.lineHeight='25px';globalThis.innerHeight=1500;const value=tableFocusTrace('stage','after_dom_read');const state=value.records.filter(row=>row.kind==='state').at(-1).state;
  assert.equal(state.viewport.height,1500);assert.ok(state.ancestors.some(row=>row.node.sameOwned&&row.hidden&&row.metrics.fontSize==='17px'&&row.metrics.lineHeight==='25px'));assert.ok(value.records.some(row=>row.kind==='attribute'&&row.name==='hidden'));assert.ok(value.records.some(row=>row.kind==='attribute'&&row.name==='data-geld-table-height-authority'&&row.old.token==='hidden-native-generated-control'));
 });
});
test('trace metadata is bounded and never retains DOM text, raw styles, secret URLs or unrelated subtree mutations',async()=>{
 await traceFixture(async({win,button,owned,read})=>{
  tableFocusTrace('setup');document.getElementById('unrelated').append(document.createElement('div'));let value=tableFocusTrace('stage','before_capture');assert.equal(value.records.some(row=>row.kind==='childList'),false);
  owned.style.backgroundImage='url("https://example.test/avatar?secret=PRIVATE-QUERY")';owned.dataset.secret='PRIVATE-DATA';button.className='safe-class '+('x'.repeat(300));
  for(let index=0;index<160;index++)button.dispatchEvent(new win.FocusEvent('focusout',{bubbles:true,relatedTarget:document.body}));
  value=tableFocusTrace('stage','after_accessibility_read');assert.equal(value.records.length,128);assert.ok(value.dropped>0);assert.doesNotMatch(JSON.stringify(value),/PRIVATE-|backgroundImage|cssText|outerHTML|innerHTML|secret=/);assert.ok(value.records.every(row=>row.target?.classes.length===undefined||row.target.classes.length<=16));
 });
});
test('trace snapshots retain each capture-stage focus state without moving focus',async()=>{
 await traceFixture(async({button})=>{
  tableFocusTrace('setup');button.focus();const before=tableFocusTrace('stage','before_capture');assert.equal(before.records.filter(row=>row.kind==='state').at(-1).state.focused,true);
  // Explicit synthetic user/browser focus loss: the observer itself never blurs or restores focus.
  button.blur();const after=tableFocusTrace('stage','after_screenshot');const state=after.records.filter(row=>row.kind==='state').at(-1);assert.equal(state.phase,'after_screenshot');assert.equal(state.state.focused,false);assert.equal(state.state.active.tag,'BODY');assert.equal(document.activeElement,document.body);
 });
});
test('event-time viewport and focus measurements preserve a transient 1px viewport even when the frame sees restoration',async()=>{
 await traceFixture(async({win,button,read,frames,flush})=>{
  const visual=new win.EventTarget();Object.assign(visual,{width:1440,height:1000,scale:1});Object.defineProperty(win,'visualViewport',{configurable:true,value:visual});
  tableFocusTrace('setup');button.focus();globalThis.innerWidth=1;globalThis.innerHeight=1;Object.assign(visual,{width:1,height:1});win.dispatchEvent(new win.Event('resize'));button.blur();globalThis.innerWidth=1440;globalThis.innerHeight=1000;Object.assign(visual,{width:1440,height:1000});visual.dispatchEvent(new win.Event('resize'));
  assert.equal(frames.size,1);flush();const result=read();const events=result.records.filter(row=>row.kind==='viewport-event');assert.deepEqual(events.map(row=>[row.instant.viewport.width,row.instant.viewport.height]),[[1,1],[1440,1000]]);
  const loss=result.records.find(row=>row.kind==='focusout');assert.equal(loss.instant.viewport.width,1);assert.equal(loss.instant.viewport.height,1);assert.equal(loss.instant.viewport.visualHeight,1);assert.equal(loss.instant.viewport.visualWidth,1);assert.equal(loss.instant.controls.isConnected,true);assert.ok(Object.hasOwn(loss.instant.buttonMetrics,'visibility'));assert.ok(Object.hasOwn(loss.instant.ownedMetrics,'overflowY'));
  assert.deepEqual(result.records.filter(row=>row.kind==='state').at(-1).state.viewport,{width:1440,height:1000,visualHeight:1000,visualWidth:1440,visualScale:1});
 });
});
