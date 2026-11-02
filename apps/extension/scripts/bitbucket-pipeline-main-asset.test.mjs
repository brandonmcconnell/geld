import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { BITBUCKET_PIPELINE_MAIN_ASSET as URL, BITBUCKET_PIPELINE_MAIN_FILE as FILE, observeBitbucketPipelineMainAsset as observe } from './bitbucket-pipeline-main-asset.mjs';
const BODY = Buffer.from('throw new Error("This synthetic script must never execute");');
function setup(options = {}) {
  const page = new EventEmitter();const frame = {};page.mainFrame = () => frame;const progress = {};const writes = [];let reads = 0;
  const probe = observe(page, progress, { settleMs: options.settleMs ?? 10, moduleOnly: options.moduleOnly ?? false, ...(options.extractModule === undefined ? {} : { extractModule: options.extractModule }), writeArtifact: async (file, bytes, signal) => { writes.push({ file, bytes: Buffer.from(bytes), signal });if (options.writeFailure) throw Error('Synthetic artifact write failed'); } });
  const response = (changes = {}) => ({ url: () => URL, request: () => ({ url: () => URL, method: () => 'GET', frame: () => frame, resourceType: () => 'script', redirectChain: () => [], ...changes.request }), status: () => 200, headers: () => ({ 'content-type': 'application/javascript; charset=utf-8', ...changes.headers }), buffer: async () => { reads++;if (options.readFailure) throw Error('Synthetic response body unavailable');return BODY; }, ...Object.fromEntries(Object.entries(changes).filter(([key]) => !['request', 'headers'].includes(key))) });
  return { page, progress, writes, response, probe, reads: () => reads };
}
test('captures only exact already-issued main-frame script bytes with SHA and fixed filename, without execution', async () => {
  const value = setup();value.page.emit('response', value.response());await value.probe.dispose();
  assert.equal(value.progress.status, 'captured');assert.equal(value.reads(), 1);assert.equal(value.writes.length, 1);assert.equal(value.writes[0].file, FILE);assert.deepEqual(value.writes[0].bytes, BODY);
  assert.equal(value.progress.bytes, BODY.byteLength);assert.equal(value.progress.sha256, createHash('sha256').update(BODY).digest('hex'));assert.equal(value.progress.executed, false);assert.equal(value.progress.httpStatus, 200);
  assert.equal(value.page.listenerCount('response'), 0);assert.deepEqual(value.progress.cleanup, { listenerRemoved: true, status: 'settled', pendingBodyMayRemain: false });
});
for (const [name, changes] of [
  ['another app version', { url: () => URL.replace('8c0b6f48', '00000000') }], ['query-bearing resource', { url: () => URL + '?token=secret' }],
  ['user API response', { url: () => 'https://bitbucket.org/!api/2.0/user' }], ['bootstrap response', { url: () => 'https://bitbucket.org/atlassian/bitbucket-upload-file/pull-requests/27/diff' }],
  ['redirected resource', { request: { redirectChain: () => [{}] } }], ['different request URL', { request: { url: () => URL + '?different' } }],
  ['subframe', { request: { frame: () => ({}) } }], ['non-script resource', { request: { resourceType: () => 'fetch' } }], ['non-GET request', { request: { method: () => 'POST' } }],
  ['failed response', { status: () => 403 }], ['HTML MIME', { headers: { 'content-type': 'text/html' } }], ['declared oversized body', { headers: { 'content-length': String(6 * 1024 * 1024 + 1) } }],
  ['malformed declared size', { headers: { 'content-length': '-1' } }],
]) test('never reads or writes ' + name, async () => { const value = setup();value.page.emit('response', value.response(changes));await value.probe.dispose();assert.equal(value.progress.status, 'unavailable');assert.equal(value.reads(), 0);assert.deepEqual(value.writes, []);assert.equal(value.page.listenerCount('response'), 0); });
for (const [name, body] of [['empty', Buffer.alloc(0)], ['decoded oversized', Buffer.alloc(6 * 1024 * 1024 + 1)], ['non-bytes', 'not bytes']]) test(name + ' response body is unavailable without artifact', async () => {
  const value = setup();value.page.emit('response', value.response({ buffer: async () => body }));await value.probe.dispose();assert.equal(value.progress.status, 'unavailable');assert.deepEqual(value.writes, []);
});
for (const options of [{ readFailure: true }, { writeFailure: true }]) test('read/write failure remains optional diagnostic unavailability ' + JSON.stringify(options), async () => { const value = setup(options);value.page.emit('response', value.response());await value.probe.dispose();assert.equal(value.progress.status, 'unavailable');assert.equal(value.progress.file, undefined);assert.equal(value.progress.sha256, undefined);assert.equal(value.page.listenerCount('response'), 0); });
test('absent response is unavailable and cleanup is idempotent', async () => { const value = setup();await value.probe.dispose();await value.probe.dispose();assert.equal(value.progress.status, 'unavailable');assert.equal(value.reads(), 0);assert.equal(value.page.listenerCount('response'), 0); });
test('one failed exact response never retries a later response or API fallback', async () => { const value = setup();value.page.emit('response', value.response({ status: () => 500 }));value.page.emit('response', value.response());await value.probe.dispose();assert.equal(value.progress.status, 'unavailable');assert.equal(value.reads(), 0);assert.deepEqual(value.writes, []); });
test('bounded pending read is reported and cannot initiate a late artifact write after cleanup/page close', async () => {
  const value = setup();let complete;value.page.emit('response', value.response({ buffer: () => new Promise((resolve) => { complete = resolve; }) }));
  await value.probe.dispose();assert.equal(value.progress.status, 'unavailable');assert.equal(value.progress.cleanup.status, 'timed_out');assert.equal(value.progress.cleanup.pendingBodyMayRemain, true);assert.equal(value.page.listenerCount('response'), 0);
  const before = structuredClone(value.progress);complete(BODY);await new Promise(setImmediate);assert.deepEqual(value.writes, []);assert.deepEqual(value.progress, before);
});
test('listener detached before page close refuses later emitted responses', async () => { const value = setup();await value.probe.dispose();value.page.emit('response', value.response());assert.equal(value.reads(), 0);assert.deepEqual(value.writes, []); });

const MODULE_BODY = Buffer.from('o("fozrM",function(e,r){e.exports={getGlobalShouldIgnoreWhitespace:s=>s.preference};})');
test('module-only actual worker retains one registration artifact and independent immutable asset hash, never full app', async () => {
  const value=setup({moduleOnly:true,settleMs:3000});const script=Buffer.concat([Buffer.from('/* public prefix */'),MODULE_BODY,Buffer.from(';throw Error("never execute")')]);
  value.page.emit('response',value.response({buffer:async()=>script}));await value.probe.dispose();
  assert.equal(value.progress.status,'captured');assert.equal(value.progress.file,'bitbucket-native-fozrM.js');assert.equal(value.progress.executed,false);assert.equal(value.writes.length,1);assert.equal(value.writes[0].file,'bitbucket-native-fozrM.js');assert.deepEqual(value.writes[0].bytes,MODULE_BODY);
  assert.deepEqual(value.progress.asset,{bytes:script.length,sha256:createHash('sha256').update(script).digest('hex')});assert.equal(value.progress.module.bytes,MODULE_BODY.length);assert.equal(value.progress.module.sha256,createHash('sha256').update(MODULE_BODY).digest('hex'));assert.equal(value.progress.bytes,undefined);assert.equal(value.progress.sha256,undefined);assert.equal(value.page.listenerCount('response'),0);
});
test('module-only unsupported script remains optional unavailable without full body artifact',async()=>{
  const value=setup({moduleOnly:true,settleMs:3000});value.page.emit('response',value.response());await value.probe.dispose();assert.equal(value.progress.status,'unavailable');assert.equal(value.progress.reason,'registration');assert.deepEqual(value.writes,[]);assert.equal(value.progress.file,undefined);assert.ok(value.progress.asset.sha256);assert.equal(JSON.stringify(value.progress).includes('must never execute'),false);
});
test('module-only failure never serializes raw browser error',async()=>{const value=setup({moduleOnly:true,readFailure:true});value.page.emit('response',value.response());await value.probe.dispose();assert.equal(value.progress.reason,'capture_failed');assert.equal(JSON.stringify(value.progress).includes('Synthetic'),false);assert.deepEqual(value.writes,[]);});
test('module-only parser timeout/abort cannot write after cleanup or hold settings restoration',async()=>{
  let finish;let signal;const value=setup({moduleOnly:true,extractModule:(_bytes,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});value.page.emit('response',value.response());await value.probe.dispose();assert.equal(signal.aborted,true);assert.equal(value.progress.status,'unavailable');assert.equal(value.progress.cleanup.status,'timed_out');const before=structuredClone(value.progress);finish({status:'extracted',bytes:MODULE_BODY});await new Promise(setImmediate);assert.deepEqual(value.writes,[]);assert.deepEqual(value.progress,before);assert.equal(value.page.listenerCount('response'),0);
});
test('module-only parser failure writes no artifact or arbitrary errors',async()=>{
  const value=setup({moduleOnly:true,extractModule:async()=>({status:'unavailable',reason:'worker_failed'})});value.page.emit('response',value.response());await value.probe.dispose();assert.equal(value.progress.status,'unavailable');assert.equal(value.progress.reason,'worker_failed');assert.deepEqual(value.writes,[]);
});

test('module-only write rejection reports fixed failure without publishing a successful file/hash',async()=>{const value=setup({moduleOnly:true,writeFailure:true,extractModule:async()=>({status:'extracted',bytes:MODULE_BODY,start:0,end:MODULE_BODY.length,byteStart:0,byteEnd:MODULE_BODY.length})});value.page.emit('response',value.response());await value.probe.dispose();assert.equal(value.progress.status,'unavailable');assert.equal(value.progress.reason,'capture_failed');assert.equal(value.progress.file,undefined);assert.equal(value.progress.module,undefined);assert.equal(JSON.stringify(value.progress).includes('Synthetic'),false);});

for(const[mime,classification]of[['application/javascript; private=DO_NOT_RETAIN','javascript'],['text/html; private=DO_NOT_RETAIN','unsupported']])test('module-only MIME retention uses fixed '+classification+' classification',async()=>{const value=setup({moduleOnly:true,extractModule:async()=>({status:'unavailable',reason:'registration'})});value.page.emit('response',value.response({headers:{'content-type':mime}}));await value.probe.dispose();assert.equal(value.progress.mime,classification);assert.equal(JSON.stringify(value.progress).includes('DO_NOT_RETAIN'),false);assert.deepEqual(value.writes,[]);});

const NEW_URL = URL.replace('8c0b6f48dd68c4fd8f958592a0de8efebbdf6d2d', '6ea3303b1b2659fcb5ca5dc82e17933a815f4108');
const atURL = (value, url, changes = {}) => value.response({ url: () => url, request: { url: () => url, ...changes.request }, ...Object.fromEntries(Object.entries(changes).filter(([key]) => key !== 'request')) });
test('module-only captures the actual newer fingerprinted response with an actual worker and no full app artifact', async () => {
  const value=setup({moduleOnly:true,settleMs:3000});value.page.emit('response',atURL(value,NEW_URL,{buffer:async()=>MODULE_BODY}));await value.probe.dispose();
  assert.equal(value.progress.status,'captured');assert.equal(value.progress.url,NEW_URL);assert.equal(value.progress.asset.sha256,createHash('sha256').update(MODULE_BODY).digest('hex'));assert.equal(value.progress.file,'bitbucket-native-fozrM.js');assert.deepEqual(value.writes.map(x=>x.file),['bitbucket-native-fozrM.js']);assert.equal(value.page.listenerCount('response'),0);
});
for(const [name,url] of [
 ['wrong origin',NEW_URL.replace('bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net','example.org')],['wrong CDN',NEW_URL.replace('prod-east','prod-west')],['HTTP',NEW_URL.replace('https:','http:')],
 ['credentials',NEW_URL.replace('https://','https://user:secret@')],['query',NEW_URL+'?private=DO_NOT_RETAIN'],['empty query',NEW_URL+'?'],['fragment',NEW_URL+'#private'],['empty fragment',NEW_URL+'#'],
 ['wrong directory',NEW_URL.replace('/assets/','/private/')],['wrong filename',NEW_URL.replace('/app.','/ajs.')],['uppercase fingerprint',NEW_URL.replace('6ea3303b','6EA3303B')],
 ['short fingerprint',NEW_URL.replace('6ea3303b1b2659fcb5ca5dc82e17933a815f4108','6ea3303b')],['encoded path',NEW_URL.replace('/app.','/%61pp.')],['extra segment',NEW_URL+'/next'],
])test('module-only does not read/claim '+name,async()=>{const value=setup({moduleOnly:true});value.page.emit('response',atURL(value,url));await value.probe.dispose();assert.equal(value.progress.status,'unavailable');assert.equal(value.reads(),0);assert.deepEqual(value.writes,[]);assert.equal(value.progress.url,undefined);assert.equal(JSON.stringify(value.progress).includes('DO_NOT_RETAIN'),false);});
for(const [name,changes]of[
 ['subframe',{request:{frame:()=>({})}}],['redirect',{request:{redirectChain:()=>[{}]}}],['non-script',{request:{resourceType:()=>'fetch'}}],['POST',{request:{method:()=>'POST'}}],['different request URL',{request:{url:()=>URL}}],['failed HTTP',{status:()=>403}],
])test('module-only first eligible URL still refuses '+name+' without retrying a later eligible script',async()=>{const value=setup({moduleOnly:true});value.page.emit('response',atURL(value,NEW_URL,changes));value.page.emit('response',value.response());await value.probe.dispose();assert.equal(value.progress.status,'unavailable');assert.equal(value.progress.url,NEW_URL);assert.equal(value.reads(),0);assert.deepEqual(value.writes,[]);});
test('wrong selector does not consume the one later eligible response, but another fingerprint cannot replace an already claimed one',async()=>{
 let calls=0;const value=setup({moduleOnly:true,extractModule:async()=>{calls++;return{status:'unavailable',reason:'registration'};}});value.page.emit('response',atURL(value,NEW_URL+'?untrusted=1'));value.page.emit('response',atURL(value,NEW_URL));value.page.emit('response',value.response());await value.probe.dispose();assert.equal(value.reads(),1);assert.equal(calls,1);assert.equal(value.progress.url,NEW_URL);assert.deepEqual(value.writes,[]);
});
test('default raw collector ignores newer app fingerprint and keeps its original exact URL/file/hash outcomes',async()=>{const value=setup();value.page.emit('response',atURL(value,NEW_URL));value.page.emit('response',value.response());await value.probe.dispose();assert.equal(value.reads(),1);assert.equal(value.progress.status,'captured');assert.equal(value.progress.url,URL);assert.equal(value.progress.file,FILE);assert.deepEqual(value.writes[0].bytes,BODY);assert.equal(value.progress.sha256,createHash('sha256').update(BODY).digest('hex'));assert.equal(value.progress.selector,undefined);});
