import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { BITBUCKET_PR_DEPENDENCY_FILES as DEPENDENCIES, BITBUCKET_PR_DEPENDENCY_LIMIT as DEPENDENCY_LIMIT, BITBUCKET_PR_DEPENDENCY_TOTAL_LIMIT as TOTAL_LIMIT, collectBitbucketPrDependencies as collectDependencies, BITBUCKET_WHITESPACE_ASSET as URL, BITBUCKET_PR_PAGE_ASSET as PAGE_URL, BITBUCKET_PR_PAGE_SOURCE_ARCHIVE as PAGE_ARCHIVE, BITBUCKET_WHITESPACE_BODY_LIMIT as LIMIT, BITBUCKET_WHITESPACE_WORKER_DEADLINE, BITBUCKET_WHITESPACE_SOURCE_ARCHIVE as ARCHIVE, collectBitbucketWhitespaceFactories as collect } from './bitbucket-whitespace-source-research.mjs';
const first='r("fozrM",function(e,r){e.exports={getGlobalShouldIgnoreWhitespace:s=>s.settings.ignore};})';
const second='r("h43l2",function(e,r){e.exports={DiffLoader:()=>{throw Error("never execute")}};})';
const body=Buffer.from(first+';'+second+';throw Error("private runtime data must not execute");');
function setup(options={}) {
  const calls=[],writes=[];let reads=0,cancelled=0,released=0;
  const chunks=options.chunks??[body];let i=0;
  const response={status:200,url:options.collect?.prPage===true?PAGE_URL:URL,redirected:false,headers:new Headers({'content-type':'application/javascript'}),body:{getReader:()=>({read:async()=>{reads++;return i<chunks.length?{done:false,value:chunks[i++]}:{done:true};},cancel:async()=>{cancelled++;},releaseLock:()=>{released++;}})},...options.response};
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
  const f=setup({chunks:[new Uint8Array(LIMIT),new Uint8Array(1)]});const r=await f.run();assert.equal(r.reason,'body_size');assert.equal(f.reads,2);assert.equal(f.cancelled,1);assert.equal(f.writes.length,0);assert.equal(r.asset,undefined);assert.equal(r.request.bytesSeen,LIMIT+1);assert.equal(r.request.bytesSeenCapped,false);
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

test('the static collector alone passes16MiB and10s bounds to each allowlisted parser',async()=>{
  const options=[],bytes=Buffer.alloc(LIMIT,32);let extraction=0;
  const f=setup({chunks:[bytes],collect:{extractModule:async(source,config)=>{options.push(config);assert.equal(source.byteLength,bytes.length);return{status:'extracted',bytes:Buffer.from(extraction++===0?first:second),start:0,end:1,byteStart:0,byteEnd:1};}}});
  const r=await f.run();assert.equal(LIMIT,16*1024*1024);assert.equal(r.status,'captured');assert.equal(r.request.bytesSeen,bytes.length);assert.equal(r.request.bytesSeenCapped,false);
  assert.deepEqual(options.map(({moduleId,sourceLimitBytes,deadlineMs})=>({moduleId,sourceLimitBytes,deadlineMs})),['fozrM','h43l2'].map(moduleId=>({moduleId,sourceLimitBytes:LIMIT,deadlineMs:BITBUCKET_WHITESPACE_WORKER_DEADLINE})));
  assert.equal(BITBUCKET_WHITESPACE_WORKER_DEADLINE,10_000);assert.equal(f.calls.length,1);
});
test('declared oversized length is recorded exactly before body reads',async()=>{
  const f=setup({response:{headers:new Headers({'content-type':'application/javascript','content-length':String(LIMIT+73)})}});const r=await f.run();
  assert.equal(r.reason,'body_size');assert.equal(r.request.declaredLength,LIMIT+73);assert.equal(r.request.declaredLengthStatus,'valid');assert.equal(r.request.bytesSeen,0);assert.equal(f.reads,0);assert.equal(f.writes.length,0);
});
test('an overflowing chunk records only the capped threshold, not an oversized body',async()=>{
  const f=setup({chunks:[new Uint8Array(123),new Uint8Array(LIMIT+100)]});const r=await f.run();assert.equal(r.reason,'body_size');assert.equal(r.request.bytesSeen,LIMIT+1);assert.equal(r.request.bytesSeenCapped,true);assert.equal(r.asset,undefined);assert.equal(f.writes.length,0);assert.equal(f.cancelled,1);
});
test('unsafe declared byte length is not rounded into a valid diagnostic',async()=>{
  const f=setup({response:{headers:new Headers({'content-type':'application/javascript','content-length':'9007199254740993'})}});const r=await f.run();assert.equal(r.reason,'body_contract');assert.equal(r.request.declaredLength,null);assert.equal(r.request.declaredLengthStatus,'invalid');assert.equal(r.request.bytesSeen,0);assert.equal(f.reads,0);
});

test('static reports distinguish known worker memory and parser depth without raw exceptions',async()=>{
  const f=setup({collect:{extractModule:async(_bytes,{moduleId})=>({status:'unavailable',reason:moduleId==='fozrM'?'worker_memory':'parser_depth'})}}),r=await f.run();
  assert.deepEqual(r.modules,{fozrM:{status:'unavailable',reason:'worker_memory'},h43l2:{status:'unavailable',reason:'parser_depth'}});assert.equal(r.status,'unavailable');assert.equal(f.writes.length,0);assert.equal(r.executed,false);
});

test('explicit retention saves only a fixed gzip of the already-fetched public asset with both hashes',async()=>{
  const f=setup({collect:{retainAsset:true,url:'https://unrelated.invalid/private.js'}}),r=await f.run();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],URL);assert.equal(f.writes[0].file,ARCHIVE);assert.equal(f.writes.length,3);
  const archive=f.writes[0].bytes;assert.deepEqual(gunzipSync(archive),body);
  assert.deepEqual(r.asset.archive,{file:ARCHIVE,encoding:'gzip',bytes:archive.length,sha256:createHash('sha256').update(archive).digest('hex'),uncompressedBytes:body.length,uncompressedSha256:createHash('sha256').update(body).digest('hex')});
  assert.equal(r.asset.archive.uncompressedSha256,r.asset.sha256);assert.equal(r.executed,false);assert.equal(JSON.stringify(r).includes('private runtime data'),false);
});
test('default extraction retains no full-asset archive',async()=>{
  const f=setup(),r=await f.run();assert.equal(r.asset.archive,undefined);assert.equal(f.writes.some(({file})=>file===ARCHIVE),false);
});
test('missing factories still leave the requested private source archive for later offline inspection',async()=>{
  const bytes=Buffer.from('throw Error("DO NOT EVALUATE SOURCE");'),f=setup({chunks:[bytes],collect:{retainAsset:true}}),r=await f.run();
  assert.equal(r.status,'unavailable');assert.deepEqual(f.writes.map(({file})=>file),[ARCHIVE]);assert.deepEqual(gunzipSync(f.writes[0].bytes),bytes);assert.equal(JSON.stringify(r).includes('DO NOT EVALUATE SOURCE'),false);
});
for(const [name,options] of [['wrong URL',{response:{url:URL+'?other=1'}}],['bad MIME',{response:{headers:new Headers({'content-type':'text/html'})}}],['declared overflow',{response:{headers:new Headers({'content-type':'application/javascript','content-length':String(LIMIT+1)})}}],['stream overflow',{chunks:[new Uint8Array(LIMIT+1)]}]])test('retention cannot archive '+name,async()=>{
  const f=setup({...options,collect:{retainAsset:true}}),r=await f.run();assert.equal(r.status,'unavailable');assert.equal(f.writes.length,0);assert.equal(r.asset?.archive,undefined);assert.equal(f.calls.length,1);
});
test('a nonboolean retention option is refused before a request',async()=>{
  const f=setup({collect:{retainAsset:'true'}}),r=await f.run();assert.equal(r.status,'unavailable');assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
});

test('explicit PR page capture makes one fixed CDN GET and archives bytes without evaluating or extracting',async()=>{
  const f=setup({collect:{prPage:true,url:'https://private.invalid/source.js',extractModule:()=>{throw Error('MUST_NOT_EXTRACT_OR_EXECUTE');}}}),r=await f.run();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],PAGE_URL);assert.equal(r.request.url,PAGE_URL);assert.equal(r.captureMode,'pr_page');
  assert.equal(r.status,'captured');assert.equal(r.parsed,false);assert.equal(r.executed,false);assert.equal(r.providerApiRequests,0);assert.equal(r.browserNavigations,0);assert.deepEqual(r.modules,{});
  assert.deepEqual(f.writes.map(w=>w.file),[PAGE_ARCHIVE]);assert.deepEqual(gunzipSync(f.writes[0].bytes),body);
  assert.equal(r.asset.sha256,createHash('sha256').update(body).digest('hex'));assert.equal(r.asset.archive.sha256,createHash('sha256').update(f.writes[0].bytes).digest('hex'));
  assert.equal(JSON.stringify(r).includes('private runtime data'),false);assert.equal(f.released,1);
});
test('PR page mode keeps the same16MiB body cap and fixed gzip name',async()=>{
  const f=setup({chunks:[new Uint8Array(LIMIT+1)],collect:{prPage:true}}),r=await f.run();
  assert.equal(r.request.byteLimit,LIMIT);assert.equal(r.request.bytesSeen,LIMIT+1);assert.equal(r.reason,'body_size');assert.equal(f.writes.length,0);assert.equal(f.calls.length,1);
  assert.equal(PAGE_ARCHIVE,'bitbucket-public-pr-page-00a49eea.js.gz');assert.equal(PAGE_URL,'https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/page.00a49eea.js');
});
for(const [name,response] of [['app body URL',{url:URL}],['redirect',{status:302}],['private query',{url:PAGE_URL+'?token=PRIVATE'}],['HTML',{headers:new Headers({'content-type':'text/html'})}]])test('PR page capture rejects '+name+' without parsing or archiving',async()=>{
  let parsed=0;const f=setup({response,collect:{prPage:true,extractModule:()=>{parsed++;}}}),r=await f.run();
  assert.equal(r.status,'unavailable');assert.equal(f.calls.length,1);assert.equal(parsed,0);assert.equal(f.writes.length,0);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('page mode must be an explicit boolean and cannot select an arbitrary asset',async()=>{
  const f=setup({collect:{prPage:'true',url:PAGE_URL}}),r=await f.run();assert.equal(r.status,'unavailable');assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
  const normal=setup({collect:{url:PAGE_URL}});await normal.run();assert.equal(normal.calls[0][0],URL);
});

function dependencySetup(options={}) {
  const calls=[],writes=[];let active=0,maxActive=0;
  return {calls,writes,get maxActive(){return maxActive;},run:()=>collectDependencies({timeoutMs:options.timeoutMs??2000,url:'https://private.invalid/NEVER',files:['NEVER'],
    fetcher:async(url,init)=>{const index=calls.length;calls.push({url,init});active++;maxActive=Math.max(maxActive,active);
      try {if(options.fetcher)return await options.fetcher(url,init,index);const bytes=options.bytes??body;let read=false;
        return {status:200,url,redirected:false,headers:new Headers({'content-type':'application/javascript'}),body:{getReader:()=>({read:async()=>{if(read)return {done:true};read=true;return {done:false,value:bytes};},cancel:async()=>{},releaseLock(){}})},...options.response};
      } finally {active--;}
    },writeArtifact:async(file,bytes)=>{writes.push({file,bytes:Buffer.from(bytes)});if(options.writeError)throw Error('PRIVATE');}})};
}
test('dependency capture uses exactly the frozen23JS URLs and fixed private gzip names without source execution',async()=>{
  const f=dependencySetup(),r=await f.run();assert.equal(DEPENDENCIES.length,23);assert.equal(new Set(DEPENDENCIES).size,23);
  assert.deepEqual(DEPENDENCIES,['create-file-route.7472a42a.js','route.eeba4a94.js','routes.6c9a65b8.js','voice-enabled-footer-row.fb410526.js','ConversationAssistantUI.5310e24d.js','esm.f9cb7fbe.js','ConversationAssistantUI.dd40091c.js','ConversationAssistant.d76eb4da.js','DraftCommentAction.6201809a.js','DraftCommentAction.e0a9748f.js','SessionRightPanel.907131d4.js','onboarding.a207a86a.js','onboarding.6c418ecf.js','routes.6fa8cad2.js','provider.15e339ac.js','modal.0d28ee57.js','project-settings-menu-page.85c3ffe5.js','project-settings-menu-page.614e2ea2.js','project-settings-menu-page.0e501094.js','project-settings-menu-page.be0d17fd.js','component-lazy.0e485afd.js','ssh-keys.984a187e.js','page.00a49eea.js']);
  assert.equal(r.status,'captured');assert.equal(r.captureMode,'pr_dependencies');assert.equal(r.executed,false);assert.equal(r.parsed,false);assert.equal(r.featureAcceptance,false);assert.equal(r.providerApiRequests,0);assert.equal(r.browserNavigations,0);
  assert.deepEqual(f.calls.map(c=>new globalThis.URL(c.url).pathname.split('/').at(-1)),DEPENDENCIES);assert.equal(f.writes.length,23);
  for(const {url,init} of f.calls){assert.ok(url.startsWith('https://bbc-frontbucket-static.prod-east.frontend.public.atl-paas.net/assets/'));assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');assert.deepEqual(init.headers,{Accept:'application/javascript'});}
  for(const [i,entry] of r.requests.entries()){const write=f.writes.find(w=>w.file===entry.asset.archive.file);assert.equal(write.file,`bitbucket-public-pr-dependency-${DEPENDENCIES[i]}.gz`);assert.deepEqual(gunzipSync(write.bytes),body);assert.equal(entry.asset.sha256,createHash('sha256').update(body).digest('hex'));assert.equal(entry.asset.archive.sha256,createHash('sha256').update(write.bytes).digest('hex'));assert.equal(entry.attempts,1);}
  assert.equal(JSON.stringify(r).includes('private runtime data'),false);assert.equal(JSON.stringify(r).includes('NEVER'),false);
});
test('dependency capture caps concurrent fetches at four',async()=>{
  let entered=0,active=0,max=0;const pending=[];
  const f=dependencySetup({fetcher:(url)=>new Promise(resolve=>{entered++;active++;max=Math.max(max,active);pending.push(()=>{active--;resolve({status:404,url,redirected:false});});})});
  const run=f.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(entered,4);
  while(entered<23||pending.length){while(pending.length)pending.shift()();await new Promise(resolve=>setImmediate(resolve));}
  const r=await run;assert.equal(max,4);assert.equal(r.status,'unavailable');assert.equal(f.calls.length,23);assert.equal(f.writes.length,0);
});
for(const [name,response] of [['wrong final URL',{url:'https://private.invalid/PRIVATE'}],['redirect',{status:302}],['HTML',{headers:new Headers({'content-type':'text/html'})}],['oversized declared',{headers:new Headers({'content-type':'application/javascript','content-length':String(DEPENDENCY_LIMIT+1)})}],['malformed length',{headers:new Headers({'content-type':'application/javascript','content-length':'bad'})}]])test('dependency capture refuses '+name+' and never retries',async()=>{
  const f=dependencySetup({response}),r=await f.run();assert.equal(r.status,'unavailable');assert.equal(f.calls.length,23);assert.equal(f.writes.length,0);assert.ok(r.requests.every(x=>x.attempts===1));assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('dependency8MiB per-asset stream cap records actual bounded overflow',async()=>{
  const f=dependencySetup({bytes:new Uint8Array(DEPENDENCY_LIMIT+9)}),r=await f.run();assert.equal(DEPENDENCY_LIMIT,8*1024*1024);assert.equal(r.status,'unavailable');assert.equal(f.writes.length,0);
  assert.ok(r.requests.filter(x=>x.attempts).every(x=>x.bytesSeen===DEPENDENCY_LIMIT+1&&x.bytesSeenCapped));
  assert.equal(r.reason,'total_size');assert.equal(r.bytesSeen,TOTAL_LIMIT+1);assert.equal(r.bytesSeenCapped,true);assert.ok(f.calls.length<23);
});
test('dependency64MiB aggregate stops queued work and retains explicit partial results',async()=>{
  const f=dependencySetup({bytes:new Uint8Array(DEPENDENCY_LIMIT)}),r=await f.run();assert.equal(TOTAL_LIMIT,64*1024*1024);assert.equal(r.reason,'total_size');assert.equal(r.bytesSeen,TOTAL_LIMIT+1);assert.equal(f.writes.length>0,true);assert.equal(r.status,'partial');assert.ok(f.calls.length<23);assert.ok(r.requests.some(x=>x.attempts===0&&x.reason==='batch_aborted'));assert.ok(r.requests.every(x=>!x.asset||x.asset.bytes<=DEPENDENCY_LIMIT));
});
test('one unavailable dependency remains explicit alongside successfully archived files',async()=>{
  const f=dependencySetup({fetcher:async(url,_init,index)=>{if(index===2)throw Error('PRIVATE');return {status:200,url,redirected:false,headers:new Headers({'content-type':'application/javascript'}),body:new ReadableStream({start(c){c.enqueue(body);c.close();}})};}}),r=await f.run();
  assert.equal(r.status,'partial');assert.equal(r.requests[2].reason,'capture_failed');assert.equal(f.calls.length,23);assert.equal(f.writes.length,22);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('global dependency deadline bounds hung fetch and does not adopt a late response',async()=>{
  const release=[];const f=dependencySetup({timeoutMs:10,fetcher:()=>new Promise(resolve=>release.push(resolve))});const r=await f.run();
  assert.equal(r.reason,'deadline');assert.equal(r.status,'unavailable');assert.equal(f.calls.length,4);const frozen=JSON.stringify(r);
  release.forEach(resolve=>resolve({status:200,url:f.calls[0].url,redirected:false}));await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.stringify(r),frozen);assert.equal(f.writes.length,0);
});
test('global dependency deadline bounds hung body reads and cancellation',async()=>{
  const f=dependencySetup({timeoutMs:10,fetcher:async(url)=>({status:200,url,redirected:false,headers:new Headers({'content-type':'application/javascript'}),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{}),releaseLock(){throw Error('pending read');}})}})}),r=await f.run();
  assert.equal(r.reason,'deadline');assert.equal(r.status,'unavailable');assert.equal(f.calls.length,4);assert.equal(f.writes.length,0);
});
test('a late dependency body chunk cannot mutate the final timeout receipt or write an archive',async()=>{
  const release=[];const f=dependencySetup({timeoutMs:10,fetcher:async(url)=>({status:200,url,redirected:false,headers:new Headers({'content-type':'application/javascript'}),body:{getReader:()=>({read:()=>new Promise(resolve=>release.push(resolve)),cancel:async()=>{},releaseLock(){}})}})});
  const r=await f.run(),frozen=JSON.stringify(r);assert.equal(release.length,4);release.forEach(resolve=>resolve({done:false,value:body}));await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.stringify(r),frozen);assert.equal(f.writes.length,0);
});
test('invalid dependency collector configuration is refused before any request',async()=>{
  for(const timeoutMs of [NaN,Infinity,-1,0]){let calls=0;const r=await collectDependencies({timeoutMs,fetcher:()=>{calls++;},writeArtifact(){}});assert.equal(r.reason,'configuration');assert.equal(calls,0);}
  let calls=0;const r=await collectDependencies({fetcher:()=>{calls++;}});assert.equal(r.reason,'configuration');assert.equal(calls,0);
});
