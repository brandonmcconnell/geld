import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { BITBUCKET_WHITESPACE_ASSET as URL, BITBUCKET_WHITESPACE_BODY_LIMIT as LIMIT, collectBitbucketWhitespaceFactories as collect } from './bitbucket-whitespace-source-research.mjs';
const first='r("fozrM",function(e,r){e.exports={getGlobalShouldIgnoreWhitespace:s=>s.settings.ignore};})';
const second='r("h43l2",function(e,r){e.exports={DiffLoader:()=>{throw Error("never execute")}};})';
const body=Buffer.from(first+';'+second+';throw Error("private runtime data must not execute");');
function setup(options={}) {
  const calls=[],writes=[];let reads=0,cancelled=0,released=0;
  const chunks=options.chunks??[body];let i=0;
  const response={status:200,url:URL,redirected:false,headers:new Headers({'content-type':'application/javascript'}),body:{getReader:()=>({read:async()=>{reads++;return i<chunks.length?{done:false,value:chunks[i++]}:{done:true};},cancel:async()=>{cancelled++;},releaseLock:()=>{released++;}})},...options.response};
  return {calls,writes,get reads(){return reads;},get cancelled(){return cancelled;},get released(){return released;},run:()=>collect({fetcher:async(...args)=>{calls.push(args);if(options.reject)throw Error('PRIVATE');return response;},writeArtifact:async(file,bytes)=>{if(options.writeError)throw Error('PRIVATE');writes.push({file,bytes:Buffer.from(bytes)});},...options.collect})};
}
test('one exact credential-free CDN GET emits two exact factories/hash receipts without executing or dumping app',async()=>{
  const f=setup();const r=await f.run();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],URL);assert.equal(f.calls[0][1].method,'GET');assert.equal(f.calls[0][1].credentials,'omit');assert.equal(f.calls[0][1].redirect,'manual');assert.deepEqual(f.calls[0][1].headers,{Accept:'application/javascript'});
  assert.equal(r.status,'captured');assert.equal(r.providerApiRequests,0);assert.equal(r.browserNavigations,0);assert.equal(r.executed,false);assert.equal(r.featureAcceptance,false);
  assert.equal(r.asset.sha256,createHash('sha256').update(body).digest('hex'));assert.deepEqual(f.writes.map(w=>w.file),['bitbucket-native-fozrM.js','bitbucket-native-h43l2.js']);assert.deepEqual(f.writes.map(w=>w.bytes.toString()),[first,second]);assert.ok(r.request.finishedAt);assert.equal(f.released,1);assert.equal(JSON.stringify(r).includes('private runtime data'),false);
});
for(const [name,response] of [['redirect flag',{redirected:true}],['redirect status',{status:302}],['wrong final URL',{url:URL+'?token=PRIVATE'}],['status failure',{status:403}],['HTML',{headers:new Headers({'content-type':'text/html'})}],['oversized declared',{headers:new Headers({'content-type':'application/javascript','content-length':String(LIMIT+1)})}],['malformed declared',{headers:new Headers({'content-type':'application/javascript','content-length':'-1'})}],['missing stream',{body:null}]])test('refuses '+name+' before reading, without retry',async()=>{
  const f=setup({response});const r=await f.run();assert.equal(r.status,'unavailable');assert.equal(f.calls.length,1);assert.equal(f.reads,0);assert.equal(f.writes.length,0);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('stream limit cancels rather than retaining an over-limit body',async()=>{
  const f=setup({chunks:[new Uint8Array(LIMIT),new Uint8Array(1)]});const r=await f.run();assert.equal(r.reason,'body_size');assert.equal(f.reads,2);assert.equal(f.cancelled,1);assert.equal(f.writes.length,0);assert.equal(r.asset,undefined);
});
test('captures h43l2 even when fozrM is absent, independently reporting missing factory',async()=>{
  const f=setup({chunks:[Buffer.from(second)]});const r=await f.run();assert.equal(r.status,'partial');assert.equal(r.modules.fozrM.reason,'registration');assert.equal(r.modules.h43l2.status,'captured');assert.deepEqual(f.writes.map(w=>w.file),['bitbucket-native-h43l2.js']);
});
test('both missing factories return explicit unavailable without full-source output',async()=>{
  const f=setup({chunks:[Buffer.from('const PRIVATE=1;')]});const r=await f.run();assert.equal(r.status,'unavailable');assert.equal(r.reason,'requested_factories_unavailable');assert.equal(f.writes.length,0);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('empty and invalid UTF8 source fail closed without artifact writes',async()=>{
  for(const chunks of [[],[Buffer.from([255,254])]]){const f=setup({chunks});const r=await f.run();assert.equal(r.status,'unavailable');assert.equal(f.writes.length,0);}
});
test('fetch and artifact failures never retry or expose exception text',async()=>{
  for(const option of [{reject:true},{writeError:true}]){const f=setup(option);const r=await f.run();assert.equal(r.status,'unavailable');assert.equal(f.calls.length,1);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);}
});
test('fetch timeout aborts once and records a fixed failure',async()=>{
  let calls=0;const r=await collect({timeoutMs:5,fetcher:(_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('PRIVATE')),{once:true}));},writeArtifact:()=>{throw Error('must not write');}});
  assert.equal(calls,1);assert.equal(r.reason,'deadline');assert.equal(r.request.attempts,1);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
