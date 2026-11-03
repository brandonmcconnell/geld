import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import { gitLabDisplayedOutlineProbe as probe, assertDisplayedOutlineCounts, assertDisplayedOutlineRows, assertDisplayedOutlineControl, waitDisplayedOutlineControl, GITLAB_DISPLAYED_OUTLINE, verifyGitLabDisplayedOutline } from './gitlab-displayed-outline.mjs';
const URL = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs?diff_id=2158520123';
let window;const originals = new Map();
beforeEach(() => {
 window = new Window({ url: URL });
 for (const key of ['document', 'location', 'Node', 'NodeFilter', 'Element', 'HTMLButtonElement', 'getComputedStyle']) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));Object.defineProperty(globalThis, key, { configurable: true, value: key === 'getComputedStyle' ? window.getComputedStyle.bind(window) : window[key] }); }
});
afterEach(() => { probe('cleanup');for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor);else delete globalThis[key]; }window.happyDOM.abort(); });
function fixture() {
 document.body.innerHTML = `<button class="geld-provider-category-header" aria-expanded="true">Essential 2</button><button class="geld-provider-category-header" aria-expanded="false">Tests 1</button><article data-rapid-diffs><div data-diffs-list><diff-file data-file-data='${JSON.stringify({ new_path: GITLAB_DISPLAYED_OUTLINE.path })}'><input data-viewed-checkbox type="checkbox" disabled><table><tbody><tr class="rd-hunk-lines-inline"><td class="rd-line-number" data-position="new"><a data-line-number="103" id="native-line" href="#line103">103</a></td><td class="rd-line-content"><pre class="rd-line-text">context 'native declaration' do\n</pre></td></tr><tr class="rd-hunk-header"><td><button data-click="expandLines" data-expand-direction="down">Show lines after</button></td></tr></tbody></table></diff-file></div></article>`;
 const root = document.querySelector('diff-file');root.getBoundingClientRect = () => ({ width: 600, height: 200 });return root;
}
test('native source probe retains exact displayed text/nodes/control/Viewed and unknown head', () => {
 const root = fixture();const source = root.innerHTML;const initial = probe('setup');assert.equal(initial.sameSource, true);assert.equal(initial.sourceHead.value, null);assert.equal(initial.controls.length, 1);assert.equal(initial.sourceRows[0].newText, "context 'native declaration' do\n");
 const current = probe();assert.equal(current.sameSource, true);assert.equal(root.innerHTML, source);assert.deepEqual(current.events, []);
});
for (const [name, mutate] of [
 ['same-text native row replacement', () => { const n = document.querySelector('tr');n.replaceWith(n.cloneNode(true)); }],
 ['source text change', () => { document.querySelector('.rd-line-text').firstChild.data += 'changed'; }],
 ['line number change', () => { document.getElementById('native-line').dataset.lineNumber = '104'; }],
 ['permalink change', () => { document.getElementById('native-line').href = '#other'; }],
 ['native context control replacement', () => { const n = document.querySelector('[data-click]');n.replaceWith(n.cloneNode(true)); }],
 ['Viewed change', () => { document.querySelector('input').checked = true; }],
 ['native row style mutation', () => { document.querySelector('tr').style.display = 'none'; }],
]) test(`${name} cannot satisfy original native identity proof`, () => { fixture();probe('setup');mutate();assert.equal(probe().sameSource, false); });
test('owned line-hide marker is the only intended native row attribute exemption', () => { fixture();probe('setup');document.querySelector('tr').dataset.geldProviderLineHidden = '';assert.equal(probe().sameSource, true);assert.equal(probe().sourceRows[0].hidden, true); });
test('native context actions are observed and never automatically activated', () => { fixture();probe('setup');assert.deepEqual(probe().events, []);document.querySelector('[data-click]').click();assert.equal(probe().events[0].kind, 'native_context');assert.equal(probe().events[0].trusted, false); });
test('no source, duplicate native source, changed selected version and changed URL are unavailable', () => { assert.equal(probe('setup'), null);const root = fixture();root.after(root.cloneNode(true));assert.equal(probe('setup'), null);root.nextElementSibling.remove();probe('setup');location.href = URL + '#different';assert.equal(probe().sameSource, false);location.href = URL.replace('2158520123', '2158520124');assert.equal(probe(), null); });
test('test declaration inspection uses actual new-side text in split rows', () => { fixture();const row = document.querySelector('tr');row.className = 'rd-hunk-lines-parallel';const old = row.querySelector('.rd-line-content');old.dataset.position = 'old';const next = old.cloneNode(true);next.dataset.position = 'new';next.textContent = 'different new-side source';row.append(next);const initial = probe('setup');assert.equal(initial.sourceRows[0].newText, 'different new-side source'); });

function fullSpan() {
 const rect = { left: 597, right: 1404, width: 807 };
 return { sourceBound: true, table: { bounds: { ...rect }, display: 'block' }, body: { bounds: { ...rect }, display: 'block' }, row: { bounds: { ...rect }, display: 'block' }, cell: { bounds: { ...rect }, display: 'block', clientLeft: 1, clientWidth: 805, style: { borderLeftWidth: '1px', borderRightWidth: '1px', paddingLeft: '0px', paddingRight: '0px', boxSizing: 'border-box' } }, hunk: { bounds: { ...rect }, display: 'grid' } };
}
function sample() { return { sameSource: true, visible: true, events: [], controls: [{}, {}, {}], folds: GITLAB_DISPLAYED_OUTLINE.declarations.map((d) => ({ title: d.title, sourceLine: String(d.line), kind: 'suite', status: 'added', label: `Show ${d.title}, from line ${d.line}, added, +${d.additions}`, expanded: 'false', control: { inViewport: true, unobscured: true, bounds: { left: 598, right: 1403, width: 805 }, nativeSpan: fullSpan() } })) }; }
test('known displayed outlines require all three source-bound suite labels and counts', () => { assert.doesNotThrow(() => assertDisplayedOutlineRows(sample())); });
for (const [name, mutate] of [
 ['missing original source', (v) => { v.sameSource = false; }], ['hidden source', (v) => { v.visible = false; }], ['missing outline', (v) => { v.folds.pop(); }], ['wrong title', (v) => { v.folds[0].title = 'other'; }], ['wrong source binding', (v) => { v.folds[0].sourceLine = '134'; }], ['invented status', (v) => { v.folds[0].status = 'modified'; }], ['wrong changed-line count', (v) => { v.folds[0].label = 'Show title, from line103, +999'; }], ['native expansion', (v) => { v.events.push({ kind: 'native_context' }); }],
]) test(`displayed outline acceptance rejects ${name}`, () => { const v = sample();mutate(v);assert.throws(() => assertDisplayedOutlineRows(v)); });
function counts() { return { runtime: { hasDiff: true, onDiffPage: true, repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'gitlab-org/gitlab' }, all: { files: 3, additions: 36, deletions: 0 }, visible: { files: 2, additions: 4, deletions: 0 }, hiddenCount: 1, categories: [{ id: 'tests', paths: [GITLAB_DISPLAYED_OUTLINE.path] }] }, native: { headers: [{ files: 2, additions: 4, deletions: 0 }] } }; }
test('independent native/runtime count guards reject adjusted or missing totals', () => { const before = counts();assertDisplayedOutlineCounts(before, counts());const after = counts();after.native.headers[0].additions = 36;assert.throws(() => assertDisplayedOutlineCounts(before, after));after.native = before.native;after.runtime.visible.files = 3;assert.throws(() => assertDisplayedOutlineCounts(before, after)); });

// Protocol-only state transitions exercise cleanup and trust refusal, never browser acceptance.
function runner({ failClick = false, restoreFailure = false, countsFailure = false, coveredControl = false, captureFailure = false, transientCovered = false, targetChanged = false } = {}) {
 const progress = {};const original = { testOutline: false, enabled: true, future: { retained: true } };let settings = structuredClone(original);let tests = false;let opened = false;let expected;const order = [];const listeners = new Map();let frames=0;
 const rows = Array.from({ length: 44 }, (_, index) => ({ next: String(index + 1), hidden: false, newText: 'other' }));for (const d of GITLAB_DISPLAYED_OUTLINE.declarations) rows[rows.length - GITLAB_DISPLAYED_OUTLINE.declarations.indexOf(d) - 1] = { next: String(d.line), hidden: false, newText: `context '${d.title}' do\n` };rows[0] = { next: '104', hidden: false, newText: 'body' };
 const read = () => ({ ...sample(), sourceRows: rows, controls: [{}, {}, {}], visible: tests, headers: [{ text: 'Essential 2', expanded: String(!tests) }, { text: 'Tests 1', expanded: String(tests) }], folds: settings.testOutline ? sample().folds.map((fold) => ({ ...fold, expanded: fold.sourceLine === '103' ? String(opened) : 'false', control: { ...fold.control, unobscured: fold.sourceLine === '103' ? !(coveredControl || transientCovered && frames === 0) : fold.control.unobscured } })) : [] });
 const page = { isClosed: () => false, on: (name, fn) => listeners.set(name, fn), off: (name) => listeners.delete(name), evaluate: async (fn, action, target) => {
   if (action === 'fold-button-current') return !targetChanged;if (String(fn).includes('requestAnimationFrame')) {frames++;return;}if (action === 'cleanup') return null;if (action === 'arm') { expected = target;return true; }if (action === 'click-result') return { trusted: !failClick };return read();
  }, evaluateHandle: async (fn, action, target) => ({ asElement: () => ({ scrollIntoView: async () => {}, click: async () => { order.push(['input', action, target]);if (!failClick) { if (action === 'category-button') tests = target === 'Tests';else opened = true; } } }), dispose: async () => {} }) };
 const dependencies = { progress, poll: async (fn, accepts) => { const value = await fn();assert.ok(accepts(value), 'Synthetic protocol refused current phase');return value; }, pollStable: async (fn, accepts) => { const value = await fn();assert.ok(accepts(value));return value; }, capture: async (p, name, config) => { assert.equal(config.fullPage, false);order.push(['capture', name]);if (captureFailure) throw Error('Synthetic outlined capture failed');return {}; }, readSettings: async () => structuredClone(settings), writeSettings: async (value) => { if (value.testOutline === false && restoreFailure) throw Error('Synthetic settings restore failed');settings = structuredClone(value);order.push(['settings', value.testOutline]); }, readState: async () => { const value = counts();if (countsFailure && settings.testOutline) value.native.headers[0].additions = 36;return value; }, safeUrl: (value) => value, extensionId: 'synthetic' };
 return { progress, original, current: () => settings, order, listeners, run: () => verifyGitLabDisplayedOutline(page, dependencies) };
}
test('protocol restores settings/category and records viewport artifacts after trusted outline flow', async () => { const r = runner();await r.run();assert.equal(r.progress.status, 'passed');assert.deepEqual(r.current(), r.original);assert.equal(r.progress.closed.visible, false);assert.equal(r.listeners.size, 0);assert.equal(r.progress.openedAfterCapture.folds[0].expanded, 'true'); });
test('untrusted input fails without a false display-outline pass and restores settings', async () => { const r = runner({ failClick: true });await assert.rejects(r.run());assert.equal(r.progress.status, 'failed');assert.deepEqual(r.current(), r.original);assert.equal(r.listeners.size, 0); });
test('changed native counts fail but still restore the actual testOutline setting', async () => { const r = runner({ countsFailure: true });await assert.rejects(r.run());assert.equal(r.progress.status, 'failed');assert.deepEqual(r.current(), r.original); });
test('restoration rejection remains a failed phase with explicit cleanup evidence', async () => { const r = runner({ restoreFailure: true });await assert.rejects(r.run(), /restore failed/);assert.equal(r.progress.status, 'failed');assert.match(r.progress.cleanupError, /restore failed/);assert.equal(r.listeners.size, 0); });

test('missing native counts and unrelated categorized paths cannot pass count acceptance', () => { const a = counts();const b = counts();a.native.headers = [];b.native.headers = [];assert.throws(() => assertDisplayedOutlineCounts(a,b));const c = counts();c.runtime.categories[0].paths = ['other.test.ts'];assert.throws(() => assertDisplayedOutlineCounts(counts(),c)); });
test('viewport or occlusion absence cannot earn a visible outline-control pass', () => { const a = sample();assertDisplayedOutlineControl(a);a.folds[0].control.inViewport = false;assert.throws(() => assertDisplayedOutlineControl(a));a.folds[0].control.inViewport = true;a.folds[0].control.unobscured = false;assert.throws(() => assertDisplayedOutlineControl(a)); });
for (const [name, mutate] of [
 ['historical intrinsic row', (c) => { c.nativeSpan.row.bounds.width=469;c.nativeSpan.row.bounds.right=1067; }],
 ['narrow button', (c) => { c.bounds.width=468;c.bounds.right=1066; }],
 ['narrow owned cell', (c) => { c.nativeSpan.cell.bounds.width=469;c.nativeSpan.cell.bounds.right=1067; }],
 ['missing native span', (c) => { c.nativeSpan=null; }],
 ['unbound source', (c) => { c.nativeSpan.sourceBound=false; }],
 ['native table layout changed', (c) => { c.nativeSpan.table.display='table'; }],
 ['owned table-row layout', (c) => { c.nativeSpan.row.display='table-row'; }],
 ['nonfinite native geometry', (c) => { c.nativeSpan.body.bounds.width=Infinity; }],
 ['missing actual hunk', (c) => { c.nativeSpan.hunk=null; }],
 ['partial native hunk', (c) => { c.nativeSpan.hunk.bounds.width=100;c.nativeSpan.hunk.bounds.right=698; }],
 ['inconsistent native bounds', (c) => { c.nativeSpan.body.bounds.width=800; }],
]) test(`full-width outline acceptance rejects ${name}`, () => { const v=sample();mutate(v.folds[0].control);assert.throws(()=>assertDisplayedOutlineControl(v)); });
test('full-span comparison allows one CSS pixel rounding but preserves native table/body border geometry',()=>{
 const v=sample();v.folds[0].control.nativeSpan.table.bounds={left:599,right:1402,width:803};
 v.folds[0].control.bounds={left:598.5,right:1402.5,width:804};assert.doesNotThrow(()=>assertDisplayedOutlineControl(v));
 v.folds[0].control.bounds.width=802.9;assert.throws(()=>assertDisplayedOutlineControl(v));
});
test('a replaced native hunk cannot establish preserved source-bound full-span geometry',()=>{
 fixture();document.querySelector('tr.rd-hunk-header').setAttribute('data-hunk-header','');probe('setup');
 const hunk=document.querySelector('tr.rd-hunk-header');hunk.replaceWith(hunk.cloneNode(true));assert.equal(probe().sameSource,false);
});
test('unexpected owned-looking row metadata is not exempted from native preservation', () => { fixture();probe('setup');document.querySelector('tr').dataset.geldUnrelated = 'changed';assert.equal(probe().sameSource, false); });

test('wrapping an original text node or changing its native number text fails preservation', () => {
 fixture();probe('setup');const text = document.querySelector('.rd-line-text').firstChild;const wrapper = document.createElement('span');text.parentElement.append(wrapper);wrapper.append(text);assert.equal(probe().sameSource, false);probe('cleanup');
 fixture();probe('setup');document.getElementById('native-line').textContent = '999';assert.equal(probe().sameSource, false);
});


function diagnosticFold() {
 const root = fixture();probe('setup');
 const row = document.createElement('tr');row.dataset.geldUi = '';row.dataset.geldProviderFoldRow = 'test:103';
 const cell = document.createElement('td');const button = document.createElement('button');button.type = 'button';button.textContent = 'Owned outline';button.setAttribute('aria-expanded', 'false');
 cell.append(button);row.append(cell);root.querySelector('tbody').prepend(row);
 // Explicit synthetic protocol geometry. No native layout or actual occluder is inferred here.
 button.getBoundingClientRect = () => new window.DOMRect(10, 20, 150, 30);
 return { root, row, cell, button };
}
test('serialized hit proof records the actual returned node and separate button ancestry without text/application data or source writes', () => {
 const { root, button, cell } = diagnosticFold();
 const overlay = document.createElement('div');overlay.id = 'returned-hit';overlay.className = 'native-layer safe-class';overlay.dataset.testid = 'native-layer';overlay.dataset.qa = 'native-layout';overlay.setAttribute('role', 'presentation');overlay.dataset.applicationState = 'not-for-evidence';overlay.textContent = 'private-body-not-for-evidence';overlay.style.position = 'sticky';overlay.style.zIndex = '99';overlay.style.pointerEvents = 'auto';overlay.getBoundingClientRect = () => new window.DOMRect(5, 5, 300, 300);document.body.append(overlay);
 cell.style.overflowY = 'hidden';cell.scrollTop = 13;const html = root.innerHTML;let calls = 0;
 document.elementFromPoint = (x,y) => { calls++;assert.equal(x,85);assert.equal(y,35);return overlay; };
 button.scrollIntoView = () => { throw Error('The diagnostic probe must not scroll'); };
 const value = probe();const control = JSON.parse(JSON.stringify(value.folds[0].control));
 assert.equal(value.sameSource,true);assert.equal(root.innerHTML,html);assert.equal(calls,1);assert.deepEqual(control.point,{x:85,y:35});assert.equal(control.inViewport,true);assert.equal(control.unobscured,false);
 const hit = control.hitChain.nodes[0];assert.equal(hit.tag,'div');assert.equal(hit.id,'returned-hit');assert.deepEqual(hit.classes,['native-layer','safe-class']);assert.equal(hit.testid,'native-layer');assert.equal(hit.qa,'native-layout');assert.equal(hit.role,'presentation');assert.equal(hit.style.position,'sticky');assert.equal(hit.style.zIndex,'99');assert.equal(hit.style.pointerEvents,'auto');assert.equal(hit.owned,false);assert.equal(hit.containsButton,false);
 assert.equal(control.buttonChain.nodes[0].isButton,true);assert.equal(control.buttonChain.nodes[0].ownedAncestor,true);assert.equal(control.buttonChain.nodes[1].style.overflowY,'hidden');assert.equal(control.buttonChain.nodes[1].scroll.scrollTop,13);
 assert.ok(control.hitChain.nodes.length<=8&&control.buttonChain.nodes.length<=8);assert.doesNotMatch(JSON.stringify(control),/not-for-evidence|applicationState|innerHTML/);assert.equal(value.viewport.width,window.innerWidth);assert.equal(value.viewport.height,window.innerHeight);
});
test('hit metadata preserves null hits and genuine button descendants without claiming an unrelated ancestor as clickable', () => {
 const { button } = diagnosticFold();document.elementFromPoint=()=>null;
 let control=probe().folds[0].control;assert.equal(control.unobscured,false);assert.deepEqual(control.hitChain.nodes,[]);
 const span=document.createElement('span');span.textContent='Visual label';button.append(span);document.elementFromPoint=()=>span;
 control=JSON.parse(JSON.stringify(probe().folds[0].control));assert.equal(control.unobscured,true);assert.equal(control.hitChain.nodes[0].tag,'span');assert.equal(control.hitChain.nodes[1].isButton,true);
 document.elementFromPoint=()=>button.parentElement;assert.equal(probe().folds[0].control.unobscured,false);
});
test('hit and button chains stay bounded, with explicit truncation and unsafe or oversized metadata omitted', () => {
 const { button,cell }=diagnosticFold();let holder=document.createElement('div');document.body.append(holder);
 for(let index=0;index<12;index++){const child=document.createElement('div');holder.append(child);holder=child;}
 holder.id='x'.repeat(200);holder.className=Array.from({length:25},(_,i)=>`native-${i}`).join(' ');holder.dataset.testid='unsafe<markup>';document.elementFromPoint=()=>holder;
 let parent=cell;for(let index=0;index<12;index++){const child=document.createElement('div');parent.append(child);parent=child;}parent.append(button);
 const control=JSON.parse(JSON.stringify(probe().folds[0].control));assert.equal(control.hitChain.nodes.length,8);assert.equal(control.buttonChain.nodes.length,8);assert.equal(control.hitChain.truncated,true);assert.equal(control.buttonChain.truncated,true);assert.equal(control.hitChain.nodes[0].id,null);assert.equal(control.hitChain.nodes[0].testid,null);assert.equal(control.hitChain.nodes[0].classes.length,16);assert.equal(control.hitChain.nodes[0].classesTruncated,true);
});
test('span diagnostics bind the actual source-adjacent owned row to its native Rapid body and unique original hunk without writes',()=>{
 const root=fixture(),table=root.querySelector('table'),body=table.querySelector('tbody'),hunk=body.querySelector('tr.rd-hunk-header');
 table.className='rd-text-view-root';body.className='rd-text-view-content';hunk.setAttribute('data-hunk-header','');
 table.style.display='block';body.style.display='block';probe('setup');
 const row=document.createElement('tr');row.className='geld-provider-line-fold';row.dataset.geldUi='';row.dataset.geldProviderFoldRow='test:103';row.style.display='block';
 const cell=document.createElement('td');cell.className='geld-provider-line-fold__cell';cell.dataset.geldUi='';cell.style.display='block';
 const button=document.createElement('button');button.type='button';cell.append(button);row.append(cell);body.prepend(row);
 // Explicit measured protocol, not actual served-CSS or provider layout evidence.
 for(const node of [table,body,hunk,row,cell,button])node.getBoundingClientRect=()=>new window.DOMRect(10,20,805,28);
 cell.style.borderLeftWidth='0px';cell.style.borderRightWidth='0px';cell.style.paddingLeft='0px';cell.style.paddingRight='0px';Object.defineProperty(cell,'clientLeft',{value:0});Object.defineProperty(cell,'clientWidth',{value:805});
 document.elementFromPoint=()=>button;const html=root.innerHTML;let value=probe();assert.equal(value.sameSource,true);assert.equal(value.folds[0].control.nativeSpan.sourceBound,true);
 assert.deepEqual(value.folds[0].control.nativeSpan.body.bounds,{left:10,right:815,top:20,bottom:48,width:805,height:28});assert.doesNotThrow(()=>assertDisplayedOutlineControl(value));assert.equal(root.innerHTML,html);
 const duplicate=hunk.cloneNode(true);body.append(duplicate);value=probe();assert.equal(value.sameSource,false);assert.equal(value.folds[0].control.nativeSpan.sourceBound,false);assert.equal(value.folds[0].control.nativeSpan.hunk,null);
});
test('covered line103 is captured before the unchanged strict assertion fails, with no substitute click and complete cleanup', async () => {
 const r=runner({coveredControl:true});await assert.rejects(r.run(),/covered at its click point/);assert.equal(r.progress.status,'failed');assert.equal(r.progress.initialScrolled.folds[0].control.unobscured,false);assert.equal(r.progress.initialAfterCapture.folds[0].control.unobscured,false);
 const capture=r.order.findIndex(([kind,name])=>kind==='capture'&&name==='gitlab-displayed-outline-initial');const restore=r.order.findIndex(([kind,value])=>kind==='settings'&&value===false);assert.ok(capture>=0&&capture<restore);assert.equal(r.order.some(([kind,action])=>kind==='input'&&action==='fold-button'),false);
 assert.deepEqual(r.current(),r.original);assert.equal(r.progress.settings.restoration,'restored');assert.equal(r.progress.closed.visible,false);assert.equal(r.listeners.size,0);
});
test('a diagnostic capture failure restores settings, category and listeners without a feature pass', async () => {
 const r=runner({captureFailure:true});await assert.rejects(r.run(),/capture failed/);assert.equal(r.progress.status,'failed');assert.deepEqual(r.current(),r.original);assert.equal(r.progress.closed.visible,false);assert.equal(r.listeners.size,0);
});


test('actual 807px cell border box and 805px content-filling button pass without widening tolerance',()=>{
 const value=sample();assertDisplayedOutlineControl(value);
 const cell=value.folds[0].control.nativeSpan.cell;
 assert.equal(cell.bounds.width,807);assert.equal(cell.clientWidth,805);assert.equal(value.folds[0].control.bounds.width,805);
 cell.style.paddingLeft='3px';cell.style.paddingRight='5px';value.folds[0].control.bounds={left:601,right:1398,width:797};assertDisplayedOutlineControl(value);
 value.folds[0].control.bounds={left:598,right:1403,width:805};assert.throws(()=>assertDisplayedOutlineControl(value),/content box/);
});
for(const [name,change] of [
 ['missing client width',c=>{delete c.clientWidth;}],['unknown padding',c=>{c.style.paddingLeft='normal';}],['inconsistent border',c=>{c.style.borderRightWidth='4px';}],['negative client',c=>{c.clientLeft=-1;}],['zero content',c=>{c.style.paddingLeft='805px';}],
])test(`content-box proof rejects ${name}`,()=>{const value=sample();change(value.folds[0].control.nativeSpan.cell);assert.throws(()=>assertDisplayedOutlineControl(value));});

test('frame readiness retains actual covered actor and requires consecutive settled native geometry',async()=>{
 let frames=0,at=0;const progress={};const states=[sample(),sample(),sample(),sample()];states[0].folds[0].control.unobscured=false;states[0].folds[0].control.hitChain={nodes:[{tag:'tbody',classes:['rd-text-view-content']}]};
 states[1].folds[0].control.nativeSpan.body.bounds.height=400;states[2].folds[0].control.nativeSpan.body.bounds.height=188;states[3].folds[0].control.nativeSpan.body.bounds.height=188;
 const result=await waitDisplayedOutlineControl({evaluate:async()=>{frames++;}},{read:async()=>states[at++],validate:async value=>assertDisplayedOutlineRows(value),progress});
 assert.equal(frames,4);assert.equal(result,states[3]);assert.equal(progress.samples[0].sample.folds[0].control.hitChain.nodes[0].tag,'tbody');assert.deepEqual(progress.samples.map(v=>v.stable),[0,1,1,2]);
});
for(const name of ['source','original control','counts','settings'])test(`readiness never retries recovered ${name} drift`,async()=>{
 let reads=0,validations=0;const progress={};await assert.rejects(waitDisplayedOutlineControl({evaluate:async()=>{}},{read:async()=>{reads++;return sample();},validate:async()=>{validations++;if(validations===1)throw Error(name+' drift');},progress}),new RegExp(name+' drift'));assert.equal(reads,1);assert.equal(validations,1);
});
test('persistent actual coverage remains failed with a bounded final actor sample and no ready substitution',async()=>{
 const value=sample();value.folds[0].control.unobscured=false;value.folds[0].control.hitChain={nodes:[{tag:'tbody',id:'actual-hit'}]};const progress={};let reads=0;
 await assert.rejects(waitDisplayedOutlineControl({evaluate:async()=>{}},{read:async()=>{reads++;return value;},validate:async()=>{},progress}),/covered at its click point/);assert.equal(reads,60);assert.equal(progress.samples.length,8);assert.equal(progress.latest.folds[0].control.hitChain.nodes[0].id,'actual-hit');
});
test('missing real animation frames fails before readiness can be asserted',async()=>{
 let reads=0;await assert.rejects(waitDisplayedOutlineControl({evaluate:async()=>{throw Error('Actual animation frames did not arrive');}},{read:async()=>{reads++;return sample();},validate:async()=>{},progress:{}}),/frames did not arrive/);assert.equal(reads,0);
});

test('full protocol captures initial covered 103 then clicks that same held control only after stable frame proof',async()=>{
 const r=runner({transientCovered:true});await r.run();assert.equal(r.progress.initialScrolled.folds[0].control.unobscured,false);assert.equal(r.progress.initialAfterCapture.folds[0].control.unobscured,false);assert.equal(r.progress.beforeInput.folds[0].control.unobscured,true);assert.equal(r.progress.readiness.attempts,2);assert.equal(r.progress.status,'passed');
 const names=r.order.filter(v=>v[0]==='capture').map(v=>v[1]);assert.deepEqual(names,['gitlab-displayed-outline-initial','gitlab-displayed-outline','gitlab-displayed-outline-open']);assert.equal(r.order.filter(v=>v[0]==='input'&&v[1]==='fold-button').length,1);
});
test('an original actual 103 handle replacement fails before any readiness input and restores settings',async()=>{
 const r=runner({targetChanged:true});await assert.rejects(r.run(),/103 control was replaced/);assert.equal(r.order.some(v=>v[0]==='input'&&v[1]==='fold-button'),false);assert.deepEqual(r.current(),r.original);assert.equal(r.listeners.size,0);
});
