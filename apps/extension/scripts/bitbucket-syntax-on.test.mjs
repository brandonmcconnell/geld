import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { EventEmitter } from 'node:events';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { assertNativeSaveEvents, assertSyntaxOnlyVector, assertSyntaxOnTraffic, characterizeBitbucketSyntaxOn, createSyntaxOnRequestIdentity, observeSyntaxOnTraffic, syntaxOnBudgetPreflight, syntaxOnProbe, syntaxOnSafeBody, syntaxOnSafeURL } from './bitbucket-syntax-on.mjs';
import { bitbucketShellProbe, currentBitbucketShellHead, observeBitbucketShellFixture, observedBitbucketShellIdentity, parseObservedBitbucketShellMetadata, verifyBitbucketShellSource } from './bitbucket-shell-acceptance.mjs';
import { classifySyntaxOnLines } from './bitbucket-syntax-on-probe.mjs';

const URL = 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff#chg-bitbucket-pipelines.yml';
const REPO = 'atlassian/bitbucket-upload-file';const HEAD = 'a'.repeat(40);const BASE = 'b'.repeat(40);
const syntax = 'diff-settings-syntax-highlighting-toggle';
const recordedRows = JSON.parse(readFileSync(new globalThis.URL('./fixtures/bitbucket-native-syntax-rows.json', import.meta.url), 'utf8'));
const controls = '<input name="diffViewMode" type="radio" value="UNIFIED" checked><input name="diffViewMode" type="radio" value="SIDE_BY_SIDE"><label for="'+syntax+'">Syntax highlighting</label><input type="checkbox" id="'+syntax+'" name="enableSyntaxHighlighting" value="enableSyntaxHighlighting"><input id="diff-settings-ignore-whitespace-toggle" name="shouldIgnoreWhitespace" type="checkbox" value="shouldIgnoreWhitespace" checked><input id="diff-settings-word-diff-toggle" name="enableWordDiff" type="checkbox" value="enableWordDiff"><input id="diff-settings-color-blind-mode-toggle" name="enableColorBlindMode" type="checkbox" value="enableColorBlindMode"><input id="diff-settings-annotations-toggle" name="enableAnnotations" type="checkbox" value="enableAnnotations"><input name="isSingleFileModeEnabled" type="radio" value="ALL_FILES_MODE" checked><input name="isSingleFileModeEnabled" type="radio" value="SINGLE_FILE_MODE"><input id="tab-size-pref" type="text"><input name="tabSize" type="hidden" value="4"><input name="fileViewMode" type="radio" value="TREE" checked><input name="fileViewMode" type="radio" value="LIST">';
const globals = ['document', 'location', 'Element', 'Text', 'NodeFilter', 'getComputedStyle', 'getSelection', 'innerHeight', 'CSS', 'requestAnimationFrame', 'cancelAnimationFrame'];
const originals = new Map(globals.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));let window;let unitEvents;
beforeEach(() => {
  window = new Window({ url: URL });
  unitEvents = new WeakSet();
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'getComputedStyle' ? window.getComputedStyle.bind(window) : key === 'getSelection' ? window.getSelection.bind(window) : key === 'CSS' ? { highlights: new Map() } : window[key] });
});
afterEach(() => { syntaxOnProbe('cleanup');for (const [key, value] of originals) if (value) Object.defineProperty(globalThis, key, value);else delete globalThis[key];window.happyDOM.abort(); });
function fixture(unitTrust = false) {
  document.head.innerHTML = '<meta id="bb-bootstrap" data-current-user=\'{"isAuthenticated":false}\' data-target-workspace-uuid="unit-workspace">';
  document.body.innerHTML = '<section role="tabpanel" id="pull-request-tabs-1-tab"><button type="button" aria-live="polite">Global diff settings</button><div><div id="chg-bitbucket-pipelines.yml"></div><article data-qa="branch-diff-file"><h2 data-qa="bk-filepath">bitbucket-pipelines.yml</h2><label>Viewed<input type="checkbox"></label><div role="rowgroup"><div role="row"><div data-qa="code-line"><span data-key="code-line-number" data-old-line-number="1" data-new-line-number="1"></span><span class="code-diff" role="gridcell" aria-label="Unchanged: echo hello" data-line-type=" "><span>echo hello</span></span><a id="line1" href="#line1" aria-label="To line1">line1</a></div></div></div></article></div></section>';
  for (const node of document.querySelectorAll('*')) node.getBoundingClientRect = () => ({ left: 1, top: 1, width: 100, height: 20 });
  assert.equal(syntaxOnProbe('setup', null, unitTrust ? { unitOnly: { trusted: (event) => unitEvents.has(event) } } : {})?.same, true);
}
function unitEvent(node, type) { const event = new window.Event(type, { bubbles: true });unitEvents.add(event);node.dispatchEvent(event); }
function unitOnTransition() {
  open(false);const field=document.getElementById(syntax);field.checked=true;for(const type of ['click','input','change'])unitEvent(field,type);assert.equal(syntaxOnProbe('begin-native-save',true),true);document.querySelector('[role="dialog"]').remove();
  const codes=[...document.querySelectorAll('[data-line-type]')];for(const code of codes){const text=code.textContent;code.className='code-diff syntax-highlighted __rbb_syntax_highlight';const wrapper=document.createElement('span');wrapper.className='unit-native-wrapper';const token=document.createElement('span');token.className='token key atrule';token.textContent=text;wrapper.append(token);code.replaceChildren(wrapper);}open(true);
}
function open(checked = false) {
  document.body.insertAdjacentHTML('beforeend', '<section role="dialog" aria-labelledby="settings-title"><h1 id="settings-title">Global diff view settings</h1><form>'+controls+'<button type="button">Cancel</button><button type="submit">Save</button></form></section>');
  document.getElementById(syntax).checked = checked;for (const node of document.querySelectorAll('[role="dialog"],[role="dialog"] *')) node.getBoundingClientRect = () => ({ left: 1, top: 1, width: 100, height: 20 });
  return syntaxOnProbe('bind');
}
function nativeEvidence() {
  return { metadata: [parseObservedBitbucketShellMetadata({ id: 27, state: 'MERGED', source: { repository: { full_name: REPO }, commit: { hash: HEAD } }, destination: { repository: { full_name: REPO }, commit: { hash: BASE } } })], partialMetadata: [], pins: [{ sourceRepo: REPO, head: HEAD, base: BASE, resource: 'diff', status: 200 }], commits: [], errors: [], mutations: [] };
}
function events(checked) { return [{ type: 'click', control: 'syntax', trusted: true, checked }, { type: 'input', control: 'syntax', trusted: true, checked }, { type: 'change', control: 'syntax', trusted: true, checked }, { type: 'click', control: 'save', trusted: true }, { type: 'submit', control: 'form', trusted: true, sameForm: true, sameSubmitter: true }]; }

test('actual retained55-row transition preserves raw strings and permits exactly53 non-final rowgroup LFs',()=>{
  const before=structuredClone(recordedRows);const result=classifySyntaxOnLines(recordedRows.original,recordedRows.on,'on');assert.equal(result.valid,true);assert.deepEqual(result.groups.map(g=>g.length),[43,12]);assert.equal(result.rows.filter(r=>r.rendererLF==='\n').length,53);assert.deepEqual(result.rows.filter(r=>r.groupEnd).map(r=>r.index),[42,54]);assert.deepEqual(recordedRows,before);assert.equal(classifySyntaxOnLines(recordedRows.original,recordedRows.original,'off').valid,true);
});
for(const fault of ['interior-space','trailing-space','two-LF','missing-LF','final-LF','CRLF','missing-row','extra-blank-row','reorder','group-boundary','group-reorder','numbers','kind','IDs','links','aria','role','unknown-wrapper','unknown-descendant','span-attribute'])test(`retained native transition rejects ${fault}`,()=>{
  const original=structuredClone(recordedRows.original);const current=structuredClone(recordedRows.on);
  if(fault==='interior-space')current[0].semantic.text='ima ge:\n';if(fault==='trailing-space')current[0].semantic.text='image: \n';if(fault==='two-LF')current[0].semantic.text+='\n';if(fault==='missing-LF')current[0].semantic.text=original[0].semantic.text;if(fault==='final-LF')current[42].semantic.text+='\n';if(fault==='CRLF')current[0].semantic.text=original[0].semantic.text+'\r\n';if(fault==='missing-row')current.pop();if(fault==='extra-blank-row')current.splice(4,0,structuredClone(current[2]));if(fault==='reorder')[current[0],current[1]]=[current[1],current[0]];if(fault==='group-boundary')current[42].render.group=1;if(fault==='group-reorder')current[0].render.group=1;if(fault==='numbers')current[0].semantic.numbers=[[null,'1']];if(fault==='kind')current[0].semantic.kind='+';if(fault==='IDs')current[0].semantic.ids.push('new');if(fault==='links')current[0].semantic.links[0][0]='#different';if(fault==='aria')current[0].render.ariaLabel+='changed';if(fault==='role')current[0].render.role='cell';if(fault==='unknown-wrapper')current[0].render.classes=['code-diff'];if(fault==='unknown-descendant')current[0].render.spans[1].tag='DIV';if(fault==='span-attribute')current[0].render.spans[1].attrs.push('data-geld-ui');assert.equal(classifySyntaxOnLines(original,current,'on').valid,false,fault);
});
test('inverse Off requires original exact plain text and wrapper, never a syntax row or arbitrary trimmed result',()=>{
  assert.equal(classifySyntaxOnLines(recordedRows.original,recordedRows.on,'off').valid,false);const current=structuredClone(recordedRows.original);current[0].semantic.text+=' ';assert.equal(classifySyntaxOnLines(recordedRows.original,current,'off').valid,false);current[0].semantic.text=recordedRows.original[0].semantic.text;current[0].render.spans[0].classes=['token'];assert.equal(classifySyntaxOnLines(recordedRows.original,current,'off').valid,false);
});

test('full rolling window is required; the measured16 is not a promise about Save/restore', () => {
  assert.equal(syntaxOnBudgetPreflight(0, 40).available, true);for (const active of [1, 16, 32, 40]) assert.equal(syntaxOnBudgetPreflight(active, 40).available, false);assert.match(syntaxOnBudgetPreflight(0, 40).basis, /unmeasured/);assert.throws(() => syntaxOnBudgetPreflight(0, 41));
});
test('pure identity validation retains the old errors/mutations refusals and never edits raw evidence', () => {
  const e = nativeEvidence();assert.deepEqual(observedBitbucketShellIdentity(e), currentBitbucketShellHead(e));e.mutations.push({ method: 'POST', url: 'observed' });const before = structuredClone(e);assert.throws(() => currentBitbucketShellHead(e), /provider mutation/);assert.equal(observedBitbucketShellIdentity(e).head, HEAD);assert.deepEqual(e, before);
  e.errors.push({ error: 'unreadable' });assert.throws(() => currentBitbucketShellHead(e), /could not be read/);assert.throws(() => observedBitbucketShellIdentity(e), /could not be read/);
});
for (const name of ['head', 'base', 'repo']) test(`pure identity still rejects conflicting ${name}`, () => { const e = nativeEvidence();e.pins.push({ ...e.pins[0], [name === 'repo' ? 'sourceRepo' : name]: name === 'repo' ? 'other/repo' : 'c'.repeat(40) });assert.throws(() => observedBitbucketShellIdentity(e));assert.throws(() => currentBitbucketShellHead(e)); });
test('redaction preserves query multiplicity and safe preference primitives without tokens or other payload values', () => {
  const url = syntaxOnSafeURL('https://bitbucket.org/observed?csrf=secret&x=one&x=two#private');assert.equal(new globalThis.URL(url).searchParams.getAll('x').length, 2);assert.doesNotMatch(url, /secret|one|two|private/);assert.equal(syntaxOnSafeURL('https://secret@bitbucket.org/x'), null);
  const b = syntaxOnSafeBody(JSON.stringify({ token: 'secret', nested: { isSyntaxHighlightingEnabled: true, shouldIgnoreWhitespace: false, tabSize: 4, message: 'private text' } }));assert.equal(b.settings.nested.isSyntaxHighlightingEnabled, true);assert.equal(b.settings.nested.message, '[redacted]');assert.doesNotMatch(JSON.stringify(b), /secret|private text/);assert.equal(syntaxOnSafeBody('token=secret').available, false);assert.equal(syntaxOnSafeBody(JSON.stringify(Object.fromEntries(Array.from({ length: 41 }, (_, i) => ['x'+i, i])))).available, false);
});
test('all request methods/responses remain in native traffic, including unknown writes and failed/rejected responses', () => {
  const page = new EventEmitter();const p = {};const observer = observeSyntaxOnTraffic(page, p, 'ext');const req = { url: () => 'https://bitbucket.org/observed?token=secret', method: () => 'POST', postData: () => '{"isSyntaxHighlightingEnabled":true,"csrf":"private"}', initiator: () => ({ stack: { callFrames: [] } }) };
  observer.beginSave(true);page.emit('request', req);page.emit('response', { url: req.url, request: () => req, status: () => 200 });observer.endSave(events(true));assert.equal(p.records.length, 2);assert.equal(p.records[1].status, 200);assert.doesNotMatch(JSON.stringify(p), /secret|private/);assert.equal(p.records[0].method, 'POST');assertSyntaxOnTraffic(p, [{ requestId:p.records[0].id,url: req.url(), method: 'POST', at: p.records[0].at }]);p.records[1].status = 403;assert.throws(() => assertSyntaxOnTraffic(p, []), /rejected/);p.records[1].status = 200;
  assert.throws(() => assertSyntaxOnTraffic(p, [{ requestId:p.records[0].id,url: 'https://bitbucket.org/other', method: 'POST', at: p.records[0].at }]), /association/);observer.dispose();assert.equal(page.listenerCount('request'), 0);
});
test('missing/overflowed URL evidence and pending Save-window responses cannot earn a complete traffic claim', () => {
  const page = new EventEmitter();const p = {};const observer = observeSyntaxOnTraffic(page, p, 'ext');
  const req = { url:()=> 'https://bitbucket.org/observed',method:()=> 'POST',postData:()=> '{}'};observer.beginSave(true);page.emit('request',req);assert.equal(observer.pending(),1);observer.endSave(events(true));assert.throws(()=>assertSyntaxOnTraffic(p,[]),/did not receive/);page.emit('requestfailed',{...req,failure:()=>({errorText:'unit failure'})});
  page.emit('request',{url:()=> 'https://secret@bitbucket.org/observed',method:()=> 'GET'});assert.equal(p.omittedHTTPURLs,1);assert.throws(()=>assertSyntaxOnTraffic(p,[]),/incomplete/);observer.dispose();assert.doesNotMatch(JSON.stringify(p),/secret/);
});
test('nonstandard writes outside Save windows stay explicitly unattributed; a standard API write there is refused',()=>{
  const page=new EventEmitter();const p={};const observer=observeSyntaxOnTraffic(page,p,'ext');const req={url:()=> 'https://bitbucket.org/observed/internal',method:()=> 'POST',postData:()=> '{"message":"private"}'};page.emit('request',req);assertSyntaxOnTraffic(p,[]);assert.equal(p.writeSummary.all,1);assert.equal(p.writeSummary.outsideSaveWindows.length,1);assert.match(p.writeSummary.outsideSaveWindows[0].classification,/Unattributed/);assert.match(p.records[0].attribution,/not native/);assert.throws(()=>assertSyntaxOnTraffic(p,[{requestId:p.records[0].id,url:req.url(),method:'POST',at:p.records[0].at}]),/association/);assert.equal(p.records.length,1);observer.dispose();
});
test('both observers and response receipts share the actual HTTPRequest object identity, never URL/time proximity',()=>{
  const page=new EventEmitter();const p={};const item={};const identifyRequest=createSyntaxOnRequestIdentity();const traffic=observeSyntaxOnTraffic(page,p,'ext',identifyRequest);observeBitbucketShellFixture(page,item,{safeUrl:syntaxOnSafeURL,extensionId:'ext',identifyRequest});
  const req={url:()=> 'https://bitbucket.org/!api/2.0/observed',method:()=> 'POST',postData:()=> '{"isSyntaxHighlightingEnabled":true}'};traffic.beginSave(true);page.emit('request',req);page.emit('response',{url:req.url,request:()=>req,status:()=>200});traffic.endSave(events(true));const mutation=item.shellNativeSources.mutations[0];assert.equal(mutation.requestId,p.records[0].id);assert.equal(p.records[1].id,mutation.requestId);assertSyntaxOnTraffic(p,[mutation]);
  const unrelated={...req};assert.notEqual(identifyRequest(unrelated),identifyRequest(req));assert.throws(()=>assertSyntaxOnTraffic(p,[{...mutation,requestId:identifyRequest(unrelated)}]),/association/);assert.throws(()=>assertSyntaxOnTraffic(p,[{...mutation,requestId:undefined}]),/identity/);page.emit('close');assert.equal(page.listenerCount('request'),0);
});
test('existing Off observer evidence shape has no opaque request field unless explicitly opted in',()=>{const page=new EventEmitter();const item={};observeBitbucketShellFixture(page,item,{safeUrl:syntaxOnSafeURL,extensionId:'ext'});page.emit('request',{url:()=> 'https://bitbucket.org/!api/2.0/observed',method:()=> 'GET'});assert.equal(Object.hasOwn(item.shellNativeSources.requests[0],'requestId'),false);page.emit('close');});
for (const changed of ['missing-change', 'wrong-field', 'untrusted', 'wrong-form', 'wrong-submitter', 'extra-event']) test(`native Save protocol rejects ${changed}`, () => {
  const e = events(true);if (changed === 'missing-change') e.splice(2, 1);if (changed === 'wrong-field') e[1].control = 'other';if (changed === 'untrusted') e[0].trusted = false;if (changed === 'wrong-form') e[4].sameForm = false;if (changed === 'wrong-submitter') e[4].sameSubmitter = false;if (changed === 'extra-event') e.push({ type: 'click', control: 'cancel', trusted: true });assert.throws(() => assertNativeSaveEvents(e, true));
});
test('actual native form schema includes13 original controls,12 others with hidden tabSize, and no native writes', () => {
  fixture();const before = document.body.innerHTML;const vector = open();assert.equal(vector.length, 13);assert.equal(vector.find((v) => v.name === 'tabSize').type, 'hidden');assert.equal(syntaxOnProbe('save').textContent, 'Save');assert.equal(syntaxOnProbe('cancel').textContent, 'Cancel');assert.deepEqual(syntaxOnProbe().events, []);assert.equal(document.body.innerHTML.startsWith(before), true);
  const expected = structuredClone(vector).map((v) => v.id === syntax ? { ...v, checked: true } : v);assertSyntaxOnlyVector(vector, expected, true);expected.find((v) => v.name === 'tabSize').value = '8';assert.throws(() => assertSyntaxOnlyVector(vector, expected, true), /other12/);
});
test('a transparent native modal cannot qualify readiness while the custom checkbox itself may be transparent',()=>{
  fixture();open();const field=document.getElementById(syntax);field.style.opacity='0';assert.equal(syntaxOnProbe().ready,true);document.querySelector('[role="dialog"]').style.opacity='0';assert.equal(syntaxOnProbe().formAvailable,false);assert.equal(syntaxOnProbe('save')===null,true);
});
for (const name of ['duplicate-save', 'disabled-save', 'readonly', 'hidden-value-name', 'other-field', 'dialog-title', 'form-remount', 'checkbox-remount']) test(`native control acquisition refuses ${name}`, () => {
  fixture();open();const form = document.querySelector('form');const save = form.querySelector('[type="submit"]');
  if (name === 'duplicate-save') { const copy = save.cloneNode(true);copy.getBoundingClientRect = save.getBoundingClientRect;save.after(copy); }if (name === 'disabled-save') save.disabled = true;if (name === 'readonly') document.getElementById(syntax).readOnly = true;if (name === 'hidden-value-name') form.querySelector('[type="hidden"]').name = 'csrf';if (name === 'other-field') form.querySelector('[name="fileViewMode"]').name = 'different';if (name === 'dialog-title') document.getElementById('settings-title').textContent = 'Other form';if (name === 'form-remount') form.replaceWith(form.cloneNode(true));if (name === 'checkbox-remount') document.getElementById(syntax).replaceWith(document.getElementById(syntax).cloneNode(true));
  assert.equal(syntaxOnProbe('save') === null, true, name);assert.equal(syntaxOnProbe('syntax') === null, true, name);
});
test('same-text source replacement is rejected outside a real native Save transition', () => {
  fixture();open(true);const code = document.querySelector('[data-line-type]');code.replaceChildren(document.createTextNode('echo hello'));assert.equal(syntaxOnProbe().same, false);assert.equal(syntaxOnProbe().offPreserved, false);assert.equal(syntaxOnProbe('baseline-on'), null);assert.equal(syntaxOnProbe('begin-native-save', true), false);
});
test('the pristine On baseline retains exact native Text boundaries and detects later source edits',()=>{
  fixture(true);unitOnTransition();const code=document.querySelector('[data-line-type]');assert.equal(syntaxOnProbe('baseline-on').onPreserved,true);const text=code.firstChild.firstChild.firstChild;text.data='different';assert.equal(syntaxOnProbe().sameSemantic,false);assert.equal(syntaxOnProbe().onPreserved,false);
});
test('the On baseline requires zero owned ranges and refuses dirty or synthetic checkbox events', () => {
  fixture(true);unitOnTransition();CSS.highlights.set('geld-bitbucket-shell-plain', new Set());assert.equal(syntaxOnProbe('baseline-on'), null);CSS.highlights.clear();document.getElementById(syntax).dispatchEvent(new window.Event('change', { bubbles: true }));assert.equal(syntaxOnProbe('baseline-on'), null);assert.equal(syntaxOnProbe().events[0].trusted, false);assert.deepEqual(syntaxOnProbe('events'), syntaxOnProbe().events);
});
test('native-On preservation keeps link/ID nodes and foreign highlights even when serialized source matches', () => {
  fixture(true);unitOnTransition();const foreign = new Set([{}]);CSS.highlights.set('native-find', foreign);syntaxOnProbe('baseline-on');assert.equal(syntaxOnProbe().foreignPreserved, true);
  CSS.highlights.set('geld-bitbucket-shell-keyword', new Set());assert.equal(syntaxOnProbe().foreignPreserved, true);foreign.add({});assert.equal(syntaxOnProbe().foreignPreserved, false);
  const link = document.getElementById('line1');link.replaceWith(link.cloneNode(true));assert.equal(syntaxOnProbe().sameSemantic, true);assert.equal(syntaxOnProbe().onPreserved, false);
});
test('captured opener and form controls cannot be silently replaced between handle lookup and trusted action', () => {
  fixture();const opener = syntaxOnProbe('opener');const copy = opener.cloneNode(true);copy.getBoundingClientRect = opener.getBoundingClientRect;opener.replaceWith(copy);assert.equal(syntaxOnProbe('opener') === null, true);assert.equal(syntaxOnProbe('arm-opener', copy), false);
  copy.replaceWith(opener);open();const save = syntaxOnProbe('save');save.replaceWith(save.cloneNode(true));assert.equal(syntaxOnProbe('arm-save', save), false);
});
test('an event before native initial-form binding cannot be erased by a later bind', () => {
  fixture();open();const dialog = document.querySelector('[role="dialog"]');dialog.remove();document.body.append(dialog.cloneNode(true));for (const n of document.querySelectorAll('[role="dialog"],[role="dialog"] *')) n.getBoundingClientRect = () => ({ left:1,top:1,width:100,height:20 });
  document.getElementById(syntax).dispatchEvent(new window.Event('input', { bubbles:true }));assert.equal(syntaxOnProbe().earlyEvents.length, 1);assert.equal(syntaxOnProbe('bind'), null);
});
test('actual read-only frame samples require a stable pristine original form, not a fixed elapsed-time guess',async()=>{
  fixture();open(true);const callbacks=[];globalThis.requestAnimationFrame=(cb)=>{callbacks.push(cb);return callbacks.length;};globalThis.cancelAnimationFrame=()=>{};
  const stable=syntaxOnProbe('ready-frames');callbacks.shift()(0);callbacks.shift()(0);assert.equal((await stable).frames,2);
  const changed=syntaxOnProbe('ready-frames');document.getElementById(syntax).disabled=true;callbacks.shift()(0);assert.equal(await changed,null);
});
test('the real source probe selection-target contract reads actual command Text; an unknown action has no selection box', () => {
  fixture();const row=document.querySelector('[data-qa="code-line"]');const number=row.querySelector('[data-key]');number.setAttribute('data-new-line-number','34');number.removeAttribute('data-old-line-number');const code=row.querySelector('[data-line-type]');code.textContent='    - '+COMMAND;
  document.elementFromPoint=()=>code;window.Range.prototype.getBoundingClientRect=()=>({left:10,right:30,top:10,bottom:25,width:20,height:15});
  const target=bitbucketShellProbe('selection-target');assert.equal(target.text,'if [');assert.equal(target.visible,true);assert.equal(typeof target.x1,'number');assert.equal(typeof target.x2,'number');assert.equal(typeof target.y,'number');assert.equal(Object.hasOwn(bitbucketShellProbe('unknown-selection-action'),'width'),false);bitbucketShellProbe('cleanup');
});
for (const name of ['actor', 'bootstrap', 'route', 'root', 'Viewed', 'permalink', 'source']) test(`native source guards reject ${name} transitions`, () => {
  fixture();if (name === 'actor') document.getElementById('bb-bootstrap').setAttribute('data-current-user', '{"isAuthenticated":true}');if (name === 'bootstrap') { const n = document.getElementById('bb-bootstrap');n.replaceWith(n.cloneNode(true)); }if (name === 'route') window.location.href = URL.replace('/27/', '/28/');if (name === 'root') { const n = document.querySelector('article');n.replaceWith(n.cloneNode(true)); }if (name === 'Viewed') document.querySelector('article input').checked = true;if (name === 'permalink') document.getElementById('line1').href = '#different';if (name === 'source') document.querySelector('[data-line-type]').textContent = 'different';assert.notEqual(syntaxOnProbe()?.same, true);
});
test('opener must be original, unique, closed, enabled and in the actual native tabpanel', () => {
  fixture();const button = syntaxOnProbe('opener');assert.ok(button);const copy = button.cloneNode(true);copy.getBoundingClientRect = button.getBoundingClientRect;button.after(copy);assert.equal(syntaxOnProbe('opener') === null, true);button.nextSibling.remove();button.tabIndex = -1;assert.equal(syntaxOnProbe('opener') === null, true);button.tabIndex = 0;open();assert.equal(syntaxOnProbe('opener') === null, true);
});

// Explicit deterministic unit-only orchestration. These are not browser colors, native
// trusted events, public commits or persisted preferences, and no browser/network is used.
const COMMAND = `if [ ! -d ".changes/next-release" ]; then echo "Next release file missing, make sure to run 'semversioner add-change'"; exit 1; fi`;
function sourceProbe(painted, renderedOn = false) {
  const lines = [...Array.from({ length: 29 }, (_, i) => '# unit prefix '+i), 'check-next-release: &check-next-release', '  step:', '    name: Check next release', '    script:', '    - '+COMMAND, '', '', 'release-dev: &release-dev'];
  const rows = lines.map((text, i) => ({ old: i+1, next: i+1, text: text + (renderedOn && i < lines.length - 1 ? '\n' : ''), kind:' ', rowId: 'row'+i, ids:i===33?['Lbitbucket-pipelines.ymlT34']:[], links: i === 33 ? [['#Lbitbucket-pipelines.ymlT34', 'To line 34']] : [] }));
  const ranges = [['keyword','if',0],['keyword','then',COMMAND.indexOf('then')],['keyword','fi',COMMAND.length-2],['built_in','echo',COMMAND.indexOf('echo')],['built_in','exit',COMMAND.indexOf('exit')],['string','".changes/next-release"',COMMAND.indexOf('"')]].map(([scope, word, start]) => ({ scope,rowId:rows[33].rowId,start:6+start,end:6+start+word.length,text:word }));
  return { url: URL, file: 'chg-bitbucket-pipelines.yml', heading: 'bitbucket-pipelines.yml', actualStep: !renderedOn, prefixOld: 37, prefixNext: 37, oldSource: rows, newSource: rows, rows, ranges: painted ? ranges : [], ownedCount: painted ? 6 : 0, invalidRanges: [], nativeIds: ['Lbitbucket-pipelines.ymlT34'], viewed: [{ checked:false,disabled:false }], colors: Object.fromEntries(['keyword','built_in','string'].map((scope) => [scope,{native:'unit-token',nativeNormalized:scope,pseudoNormalized:scope}])) };
}
function semanticRows(source) { return source.rows.map((r)=>({text:r.text,kind:r.kind,numbers:[[String(r.old),String(r.next)]],ids:r.ids,links:r.links})); }
function lineWitness(mode) {
  const original = sourceProbe(false);return semanticRows(sourceProbe(false, mode === 'on')).map((semantic, i) => ({ semantic,
    render: { group:0,tag:'SPAN',role:'gridcell',rowRole:'row',ariaLabel:'Unchanged: '+original.rows[i].text,classes:mode==='on'?['code-diff','syntax-highlighted','__rbb_syntax_highlight']:['code-diff'],attrs:['aria-label','class','data-line-type','role'],directText:'',childNodeTypes:[1],children:['SPAN'],spans:mode==='on'?[{tag:'SPAN',attrs:['class'],classes:['unit-wrapper']}]:[{tag:'SPAN',attrs:[],classes:[]}] } }));
}
function onBaseline(source) {
  const originalLines=lineWitness('off');const renderedLines=lineWitness('on');const lineModel=classifySyntaxOnLines(originalLines,renderedLines,'on');assert.equal(lineModel.valid,true);
  const record={origin:'fresh-native-on-form-open',id:'native-on-1',formId:'native-form-2',formControls:13,url:URL,dialogs:1,checked:true,ownedCount:0,events:[],semanticRows:semanticRows(source),originalLines,renderedLines,lineModel};
  return {origin:record.origin,record,currentNative:{same:true,sameScope:true,sameSemantic:false,sameCodeCharacters:true,sameContainer:true,onBaseline:true,onPreserved:true,foreignPreserved:true,semanticRows:record.semanticRows,renderedLines,lineModel,baselineEvidence:record},subject:{sourceRepo:REPO,head:HEAD,base:BASE},currentSubject:{sourceRepo:REPO,head:HEAD,base:BASE}};
}
test('the range oracle consumes an explicit independent On baseline without overriding raw Off/prepaint fields',()=>{
  const source=sourceProbe(true,true);source.prePaintSeen=false;source.preserved=null;const raw=structuredClone(source);assert.throws(()=>verifyBitbucketShellSource(source,URL));const input=onBaseline(source);const result=verifyBitbucketShellSource(source,URL,input);assert.equal(result.baselineEvidence.id,'native-on-1');assert.equal(result.codeLineEvidence.rawActualStep,false);assert.equal(result.codeLineEvidence.originalCodeActualStep,true);assert.deepEqual(source,raw);
});
for(const fault of ['open','on','owned','dirty','id','scope','foreign','source','head'])test(`explicit native-On baseline refuses ${fault} drift`,()=>{
  const source=sourceProbe(true,true);const input=onBaseline(source);if(fault==='open')input.record.dialogs=0;if(fault==='on')input.record.checked=false;if(fault==='owned')input.record.ownedCount=22;if(fault==='dirty')input.record.events.push({type:'input'});if(fault==='id')input.currentNative.baselineEvidence={...input.record,id:'native-on-2'};if(fault==='scope')input.currentNative.sameScope=false;if(fault==='foreign')input.currentNative.foreignPreserved=false;if(fault==='source')input.record.semanticRows[0].text='changed';if(fault==='head')input.currentSubject.head='c'.repeat(40);assert.throws(()=>verifyBitbucketShellSource(source,URL,input));
});
function protocol(fault) {
  fixture();const vector = open();document.querySelector('[role="dialog"]').remove();syntaxOnProbe('cleanup');
  const item = { shellNativeSources: nativeEvidence(),syntaxOnTraffic:{records:[],windows:[],truncated:false} };let effective = false;let draft = false;let dialog = false;let painted = false;let baseline = null;let last = null;let eventList = [];let selected = null;let captured = false;let saveCount = 0;let formReads=0;const actions = [];
  const page = { url:()=>URL,isClosed:()=>false,mouse:{move:async()=>{},down:async()=>{},up:async()=>{selected={text:'if [',anchor:'unit',focus:'unit'};}},evaluate:async(fn,action)=>{
    if (fn === bitbucketShellProbe) { if (action === 'cleanup') return null;if (action === 'selection-target') return {x1:1,x2:10,y:8,visible:true,text:'if ['};const source = sourceProbe(painted,effective);source.selection = selected;if (painted && captured && fault === 'range') source.invalidRanges.push({});return source; }
    assert.equal(fn,syntaxOnProbe);if (action === 'cleanup') { actions.push('cleanup');return null; }if (action === 'events') return eventList;if (action === 'hit' || action?.startsWith('arm-') || action==='begin-native-save') return true;if (action === 'event') return last;if (action === 'ready-frames') return fault==='readiness'?null:{frames:2,same:true,ready:true};
    if (action === 'bind') return fault==='initial-form'?null:structuredClone(vector.map((v)=>v.id===syntax?{...v,checked:draft}:v));
    if(dialog && action===undefined)formReads++;const renderedLines=lineWitness(effective?'on':'off');const lineModel=classifySyntaxOnLines(lineWitness('off'),renderedLines,effective?'on':'off');const state = {same:!(captured && fault==='source'),sameScope:true,sameSemantic:!effective,sameCodeCharacters:true,lineModel,renderedLines,sameContainer:true,offPreserved:!effective,onBaseline:baseline!==null,baselineEvidence:baseline,semanticRows:semanticRows(sourceProbe(false,effective)),onPreserved:!(captured && fault==='source'),foreignPreserved:true,dialogs:dialog?1:0,ready:dialog,formAvailable:dialog && (fault!=='delayed-form' || formReads>=2),checked:draft,vector:dialog?structuredClone(vector.map((v)=>v.id===syntax?{...v,checked:draft}:v)):null,events:structuredClone(eventList)};
    if (action === 'baseline-on') { assert.equal(painted,false);baseline=onBaseline(sourceProbe(false,true)).record;state.onBaseline=true;state.baselineEvidence=baseline;actions.push('native-on-baseline'); }
    return state;
  },evaluateHandle:async(_fn,action)=>({asElement(){return this;},evaluate:async()=>{},dispose:async()=>{},click:async()=>{
    actions.push(action);last={trusted:fault!=='untrusted',url:URL};
    if (action==='opener') { dialog=true;draft=effective;painted=false;eventList=[];formReads=0; }
    if (action==='syntax') { draft=!draft;eventList=events(draft).slice(0,3); }
    if (action==='save') { saveCount++;eventList.push(...events(draft).slice(3));if (fault==='submitter') eventList.at(-1).sameSubmitter=false;if (fault==='restore' && !draft) throw new Error('unit restoration failed');effective=fault==='ineffective' && draft?false:draft;dialog=false; }
    if (action==='cancel') { dialog=false;painted=effective && fault!=='no-paint';eventList.push({type:'click',control:'cancel',trusted:true}); }
  }}) };
  const traffic = {pending:()=>0,setPhase:()=>{},beginSave:(expected)=>{const w={id:item.syntaxOnTraffic.windows.length+1,expected,status:'armed'};item.syntaxOnTraffic.windows.push(w);return w;},endSave:(events)=>Object.assign(item.syntaxOnTraffic.windows.at(-1),{status:'observed',events})};
  const counts={files:5,additions:46,deletions:29};const state={hasDiff:true,onDiffPage:true,all:counts,visible:counts,hiddenCount:0,repo:REPO,repository:{provider:'bitbucket',origin:'https://bitbucket.org',path:REPO}};
  const deps={freshAnonymousProfile:true,traffic,pause:async()=>{},poll:async(read,accept)=>{for(let i=0;i<3;i++){const v=await read();if(accept(v))return v;}throw new Error('unit bounded poll predicate not met');},guardBudget:()=>({observedWithinRollingHour:fault==='budget'?33:16}),tabState:async()=>structuredClone(state),bitbucketDom:async()=>({...counts}),capture:async()=>{captured=true;if(fault==='head')item.shellNativeSources.pins.push({...item.shellNativeSources.pins[0],head:'c'.repeat(40)});return{};},unitOnly:{flush:async()=>{},prepareOff:async(_p,i)=>{i.shellSyntax={status:fault==='unknown'?'unavailable':'native_disabled',visit:{url:URL},mutations:[]};}}};
  return {run:()=>characterizeBitbucketSyntaxOn(page,item,deps),item,actions,saves:()=>saveCount,effective:()=>effective};
}
test('whole unit protocol qualifies pristine On, paints/preserves/selects/captures and restores through fresh Off Cancel',async()=>{
  const p=protocol();const proof=await p.run();assert.equal(proof.status,'characterized');assert.equal(proof.restoration.status,'restored');assert.equal(p.effective(),false);assert.equal(p.saves(),2);assert.equal(proof.afterCapture.native.onPreserved,true);assert.equal(proof.restoration.source.ownedCount,0);assert.ok(p.actions.indexOf('native-on-baseline')<p.actions.indexOf('cancel'));assert.deepEqual(proof.offBaseline.mutations,[]);
});
test('unknown native baseline stays unsupported with no checkbox or Save operation',async()=>{const p=protocol('unknown');assert.equal((await p.run()).status,'unsupported');assert.equal(p.saves(),0);assert.equal(p.actions.includes('syntax'),false);});
test('a mounted dialog with pending native fields must hydrate the exact form before any checkbox or Save',async()=>{const p=protocol('delayed-form');assert.equal((await p.run()).status,'characterized');assert.equal(p.saves(),2);});
for(const fault of ['ineffective','no-paint','submitter','range','source','head','budget','untrusted','restore','readiness','initial-form'])test(`whole unit protocol retains ${fault} failure and truthful restoration outcome`,async()=>{
  const p=protocol(fault);await assert.rejects(p.run());assert.equal(p.item.syntaxOn.status,'failed');assert.ok(p.item.syntaxOn.error || p.item.syntaxOn.restoration.error);if(['ineffective','no-paint','range'].includes(fault)){assert.equal(p.item.syntaxOn.restoration.status,'restored');assert.equal(p.effective(),false);}if(['source','head','restore'].includes(fault))assert.equal(p.item.syntaxOn.restoration.status,'failed');
});
test('no initial vector leaves an unknown form untouched and does not replace the original failure with a TypeError',async()=>{const p=protocol('initial-form');await assert.rejects(p.run(),/Original13/);assert.equal(p.item.syntaxOn.restoration.status,'not_modified');assert.equal(p.actions.includes('syntax'),false);assert.equal(p.actions.includes('cancel'),false);assert.equal(p.saves(),0);});


test('explicit On range proof excludes renderer LF and rejects mismatched actual Text even inside original bounds', () => {
  for (const fault of ['LF', 'wrong-text']) {
    const source = sourceProbe(true, true);const input = onBaseline(source);const row = source.rows.find((r) => r.next === 34);
    if (fault === 'LF') source.ranges.push({ scope: 'plain', rowId: row.rowId, start: row.text.length - 1, end: row.text.length, text: '\n' });
    else source.ranges[0].text = 'xx';
    assert.throws(() => verifyBitbucketShellSource(source, URL, input), fault === 'LF' ? /renderer LF/ : /exact original code/);
  }
});
test('logical On coverage accepts multiple physical native Text fragments without imposing the old range count', () => {
  const source = sourceProbe(true, true);const input = onBaseline(source);const range = source.ranges.shift();
  source.ranges.push({ ...range, end: range.start + 1, text: range.text[0] }, { ...range, start: range.start + 1, text: range.text.slice(1) });source.ownedCount++;
  assert.ok(verifyBitbucketShellSource(source, URL, input).rangeCount > 6);
});
test('fresh On baseline relocks span, Text and rowgroup identity after the bounded Save presentation replacement', () => {
  fixture(true);unitOnTransition();assert.equal(syntaxOnProbe('baseline-on').same, true);
  const span = document.querySelector('[data-line-type] > span');span.replaceWith(span.cloneNode(true));
  assert.equal(syntaxOnProbe().sameCodeCharacters, true);assert.equal(syntaxOnProbe().same, false);assert.equal(syntaxOnProbe().onPreserved, false);
});
test('inverse Off Save accepts only the original plain source then relocks restored node identities', () => {
  fixture(true);unitOnTransition();syntaxOnProbe('baseline-on');document.querySelector('[role="dialog"]').remove();open(true);
  const field = document.getElementById(syntax);field.checked = false;for (const type of ['click', 'input', 'change']) unitEvent(field, type);assert.equal(syntaxOnProbe('begin-native-save', false), true);document.querySelector('[role="dialog"]').remove();
  const code = document.querySelector('[data-line-type]');code.className = 'code-diff';const plain = document.createElement('span');plain.textContent = 'echo hello';code.replaceChildren(plain);
  assert.equal(syntaxOnProbe().same, true);assert.equal(syntaxOnProbe().lineModel.mode, 'off');open(false);assert.equal(syntaxOnProbe('finish-native-restore').same, true);
  plain.replaceWith(plain.cloneNode(true));assert.equal(syntaxOnProbe().sameCodeCharacters, true);assert.equal(syntaxOnProbe().same, false);
});
for (const fault of ['actor', 'route', 'code', 'rowgroup']) test(`bounded native Save still refuses ${fault} drift before cleanup can touch controls`, () => {
  fixture(true);unitOnTransition();
  if (fault === 'actor') document.getElementById('bb-bootstrap').setAttribute('data-current-user', '{"isAuthenticated":false,"changed":true}');
  if (fault === 'route') window.location.hash = '#different';
  if (fault === 'code') document.querySelector('[data-line-type] > span').textContent += ' ';
  if (fault === 'rowgroup') document.querySelector('[role="rowgroup"]').removeAttribute('role');
  assert.equal(syntaxOnProbe()?.same ?? false, false);assert.equal(syntaxOnProbe('save'), null);assert.equal(syntaxOnProbe('begin-native-save', false) ?? false, false);
});
