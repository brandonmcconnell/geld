import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { BITBUCKET_PIPELINE_MAIN_ASSET as URL, BITBUCKET_PIPELINE_MAIN_FILE as FILE, observeBitbucketPipelineMainAsset as observe } from './bitbucket-pipeline-main-asset.mjs';
const BODY = Buffer.from('throw new Error("This synthetic script must never execute");');
function setup(options = {}) {
  const page = new EventEmitter();const frame = {};page.mainFrame = () => frame;const progress = {};const writes = [];let reads = 0;
  const probe = observe(page, progress, { settleMs: 10, writeArtifact: async (file, bytes, signal) => { writes.push({ file, bytes: Buffer.from(bytes), signal });if (options.writeFailure) throw Error('Synthetic artifact write failed'); } });
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
