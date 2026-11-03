import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { extractBitbucketModule as extract, BITBUCKET_MODULE_LIMIT, BITBUCKET_WORKER_LIMITS } from './bitbucket-main-asset-module-worker.mjs';
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
