import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { extractBitbucketModule as extract, BITBUCKET_MODULE_LIMIT, BITBUCKET_WORKER_LIMITS, BITBUCKET_LARGE_SOURCE_WORKER_LIMITS, BITBUCKET_SOURCE_LIMIT, BITBUCKET_MAX_SOURCE_LIMIT } from './bitbucket-main-asset-module-worker.mjs';
const registration = 'o("fozrM",(function(e,r){e.exports={getGlobalShouldIgnoreWhitespace:s=>s.settings.shouldIgnoreWhitespace};}))';
const body = (text = registration) => Buffer.from(text);
test('actual worker extracts exact static registration and UTF8/character offsets without executing it', async () => {
  const prefix = '/* π */\n';const script = body(prefix + registration + ';throw Error("must never run");');
  const result = await extract(script);assert.equal(result.status, 'extracted');assert.deepEqual(Buffer.from(result.bytes), body(registration));
  assert.equal(result.start, prefix.length);assert.equal(result.end, prefix.length + registration.length);assert.equal(result.byteStart, Buffer.byteLength(prefix));assert.equal(result.byteEnd, result.byteStart + body(registration).length);
  assert.equal(result.sha256, createHash('sha256').update(body(registration)).digest('hex'));
});
for (const [name, source, reason] of [
  ['comment and quoted fake', '/* o("fozrM",function(e,r){}) */;const x=\'o("fozrM",function(e,r){})\';', 'registration'],
  ['duplicate', registration + ';' + registration, 'registration'], ['dynamic key', 'o(name,function(e,r){})', 'registration'],
  ['arrow factory', 'o("fozrM",(e,r)=>{})', 'registration'], ['property registration', 'x.o("fozrM",function(e,r){})', 'registration'],
  ['extra arguments', 'o("fozrM",function(e,r){},1)', 'registration'], ['dynamic factory', 'o("fozrM",factory)', 'registration'],
  ['async factory', 'o("fozrM",async function(e,r){})', 'registration'], ['generator factory', 'o("fozrM",function*(e,r){})', 'registration'],
  ['malformed source', registration + ';function {', 'syntax'],
  ['oversized snippet', 'o("fozrM",function(e,r){const s="' + 'x'.repeat(BITBUCKET_MODULE_LIMIT) + '";})', 'snippet_size'],
]) test('actual worker rejects ' + name, async () => { const result = await extract(body(source));assert.deepEqual(result, { status: 'unavailable', reason }); });
test('actual worker rejects invalid UTF8 instead of changing source bytes', async () => { assert.deepEqual(await extract(Buffer.from([255, 254])), { status: 'unavailable', reason: 'utf8' }); });
test('actual worker accepts supported three-argument registration with braces inside strings and template', async () => {
  const source = 'r("fozrM",function(e,t,n){const x="}";const y=`${"{"}`;})';const result = await extract(body(source));assert.equal(result.status, 'extracted');assert.deepEqual(Buffer.from(result.bytes), body(source));
});
function pendingWorker() { const worker = new EventEmitter();worker.terminated = 0;worker.terminate = async () => { worker.terminated++; };return worker; }
test('deadline terminates worker with exact resource limits and no late result', async () => {
  const worker = pendingWorker();let config;const result = await extract(body(), { deadlineMs: 5, workerFactory: (options) => { config=options;return worker; } });
  assert.deepEqual(result, { status: 'unavailable', reason: 'worker_deadline' });assert.deepEqual(config.resourceLimits, BITBUCKET_WORKER_LIMITS);assert.equal(worker.terminated, 1);assert.equal(worker.eventNames().length, 0);
});
test('actual worker finite wall deadline is optional unavailability', async () => { const result = await extract(body(), { deadlineMs: 1 });assert.deepEqual(result, { status: 'unavailable', reason: 'worker_deadline' }); });
for (const event of ['error', 'exit']) test(event + ' uses fixed unavailable metadata without raw errors', async () => {
  const worker = pendingWorker();const result = extract(body(), { workerFactory: () => worker });worker.emit(event, new Error('private payload'));assert.deepEqual(await result, { status: 'unavailable', reason: event==='error'?'worker_failed':'worker_exit' });assert.equal(worker.terminated,1);
});
test('abort removes listeners and terminates worker, preaborted signal creates no worker', async () => {
  const controller = new AbortController();const worker=pendingWorker();const result=extract(body(), { signal:controller.signal,workerFactory:()=>worker });controller.abort();assert.deepEqual(await result,{status:'unavailable',reason:'aborted'});assert.equal(worker.terminated,1);
  assert.deepEqual(await extract(body(), { signal:controller.signal,workerFactory:()=>{throw Error('must not spawn');} }),{status:'unavailable',reason:'aborted'});
});
test('malformed worker result cannot supply arbitrary bytes or private reason', async () => {
  const worker=pendingWorker();const result=extract(body(),{workerFactory:()=>worker});worker.emit('message',{status:'extracted',bytes:body('different'),start:0,end:9,byteStart:0,byteEnd:9});assert.deepEqual(await result,{status:'unavailable',reason:'worker_result'});
});
for (const value of [Buffer.alloc(0), Buffer.alloc(6*1024*1024+1), 'not bytes']) test('invalid pre-worker body length/type remains unavailable '+typeof value, async()=>{assert.deepEqual(await extract(value),{status:'unavailable',reason:'body_size'});});

test('actual worker ignores ordinary fozrM imports around one supported registration-shaped slice',async()=>{const imports=Array.from({length:40},(_,i)=>`const value${i}=require("fozrM");`).join('');const result=await extract(body(imports+registration+';'+imports.replaceAll('value','after')));assert.equal(result.status,'extracted');assert.deepEqual(Buffer.from(result.bytes),body(registration));assert.equal(result.start,imports.length);});
test('ordinary imports do not conceal duplicate supported factory definitions',async()=>{assert.deepEqual(await extract(body('require("fozrM");'+registration+';'+registration)),{status:'unavailable',reason:'registration'});});

test('allowlisted h43l2 extraction is independent of absent or duplicate fozrM registrations',async()=>{
  const loader='o("h43l2",function(e,r){e.exports={DiffLoader:()=>{throw Error("never execute")}};})';
  const result=await extract(body(registration+';'+registration+';'+loader),{moduleId:'h43l2'});
  assert.equal(result.status,'extracted');assert.equal(result.moduleId,'h43l2');assert.deepEqual(Buffer.from(result.bytes),body(loader));
  assert.deepEqual(await extract(body(loader),{moduleId:'fozrM'}),{status:'unavailable',reason:'registration'});
});
test('unknown module ID is refused before creating a worker',async()=>{
  for(const moduleId of ['other','__proto__','h43l2;fetch("bad")',null])assert.deepEqual(await extract(body(),{moduleId,workerFactory:()=>{throw Error('must not create worker');}}),{status:'unavailable',reason:'module_id'});
});
test('worker result for the other allowlisted module cannot qualify selected module',async()=>{
  const worker=pendingWorker();const script=body();const result=extract(script,{workerFactory:()=>worker});
  worker.emit('message',{status:'extracted',moduleId:'h43l2',bytes:script,start:0,end:script.length,byteStart:0,byteEnd:script.length});
  assert.deepEqual(await result,{status:'unavailable',reason:'worker_result'});
});
test('duplicate DiffLoader factory remains ambiguous even beside one valid settings factory',async()=>{
  const loader='r("h43l2",function(e,r){})';assert.deepEqual(await extract(body(registration+';'+loader+';'+loader),{moduleId:'h43l2'}),{status:'unavailable',reason:'registration'});
});

test('explicit larger source allowance selects only the fixed1GiB worker budget',async()=>{
  const worker=pendingWorker();let config;
  const result=extract(body(),{sourceLimitBytes:BITBUCKET_MAX_SOURCE_LIMIT,workerFactory:(options)=>{config=options;return worker;}});
  assert.equal(config.workerData.sourceLimitBytes,16*1024*1024);assert.deepEqual(config.resourceLimits,BITBUCKET_LARGE_SOURCE_WORKER_LIMITS);
  assert.equal(config.resourceLimits.maxOldGenerationSizeMb,1024);assert.equal(config.resourceLimits.stackSizeMb,BITBUCKET_WORKER_LIMITS.stackSizeMb);
  worker.emit('error',new Error('private'));assert.deepEqual(await result,{status:'unavailable',reason:'worker_failed'});
});
for(const sourceLimitBytes of [0,-1,1.5,NaN,Infinity,BITBUCKET_MAX_SOURCE_LIMIT+1,'16777216',null])test('invalid explicit source allowance cannot start a worker: '+String(sourceLimitBytes),async()=>{
  assert.deepEqual(await extract(body(),{sourceLimitBytes,workerFactory:()=>{throw Error('must not create worker');}}),{status:'unavailable',reason:'source_limit'});
});
test('the explicit source allowance is a hard pre-worker cap and legacy limit stays6MiB',async()=>{
  assert.equal(BITBUCKET_SOURCE_LIMIT,6*1024*1024);assert.equal(BITBUCKET_WORKER_LIMITS.maxOldGenerationSizeMb,256);
  const bytes=Buffer.alloc(BITBUCKET_MAX_SOURCE_LIMIT+1);
  assert.deepEqual(await extract(bytes,{sourceLimitBytes:BITBUCKET_MAX_SOURCE_LIMIT,workerFactory:()=>{throw Error('must not create worker');}}),{status:'unavailable',reason:'body_size'});
  assert.deepEqual(await extract(bytes.subarray(0,BITBUCKET_SOURCE_LIMIT+1),{workerFactory:()=>{throw Error('must not create worker');}}),{status:'unavailable',reason:'body_size'});
});
test('actual larger worker parses over6MiB without executing the fetched registration or trailing code',async()=>{
  const padding='/*'+' '.repeat(BITBUCKET_SOURCE_LIMIT)+'*/';const bytes=body(padding+registration+';throw Error("never execute large source");');
  const result=await extract(bytes,{sourceLimitBytes:BITBUCKET_MAX_SOURCE_LIMIT,deadlineMs:10_000});
  assert.equal(result.status,'extracted');assert.deepEqual(Buffer.from(result.bytes),body(registration));assert.equal(result.byteStart,Buffer.byteLength(padding));
});

for(const [error,reason] of [[Object.assign(Error('PRIVATE memory text'),{code:'ERR_WORKER_OUT_OF_MEMORY'}),'worker_memory'],[new RangeError('PRIVATE parser text'),'parser_depth'],[Object.assign(Error('PRIVATE unknown text'),{code:'OTHER'}),'worker_failed']])test('worker failure exposes only fixed '+reason+' classification',async()=>{
  const worker=pendingWorker();const pending=extract(body(),{workerFactory:()=>worker});worker.emit('error',error);const result=await pending;
  assert.deepEqual(result,{status:'unavailable',reason});assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(worker.terminated,1);
});
test('constructor memory failure is classified without publishing its message',async()=>{
  assert.deepEqual(await extract(body(),{workerFactory:()=>{throw Object.assign(Error('PRIVATE'),{code:'ERR_WORKER_OUT_OF_MEMORY'});}}),{status:'unavailable',reason:'worker_memory'});
});
test('parser depth result remains fixed while unknown worker reasons are suppressed',async()=>{
  for(const reason of ['parser_depth','PRIVATE']){const worker=pendingWorker();const pending=extract(body(),{workerFactory:()=>worker});worker.emit('message',{status:'unavailable',reason});assert.deepEqual(await pending,{status:'unavailable',reason:reason==='parser_depth'?'parser_depth':'worker_result'});}
});
test('actual worker traverses12MB deep comma syntax without recursion or evaluation',async()=>{
  const term='state.shouldIgnoreWhitespace,';
  const loader='r("h43l2",function(e,r){e.exports={DiffLoader:()=>{throw Error("never execute")}};})';
  const tail='0);'+registration+';'+loader+';throw Error("never evaluate app");';
  const bytes=body('('+term.repeat(Math.floor((12_145_413-tail.length-1)/term.length))+tail);
  assert.ok(bytes.length>=12_145_380&&bytes.length<=12_145_413);
  for(const [moduleId,expected] of [['fozrM',registration],['h43l2',loader]]){
    const result=await extract(bytes,{sourceLimitBytes:BITBUCKET_MAX_SOURCE_LIMIT,deadlineMs:10_000,moduleId});
    assert.equal(result.status,'extracted');assert.deepEqual(Buffer.from(result.bytes),body(expected));assert.deepEqual(bytes.subarray(result.byteStart,result.byteEnd),body(expected));
  }
});
