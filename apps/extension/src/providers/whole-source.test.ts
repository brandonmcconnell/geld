// @vitest-environment happy-dom
import { repositoryKey } from '@geld/core';
import { ProviderWholeSourceCache, readProviderWholeSource, WHOLE_SOURCE_FILE_BYTES, WHOLE_SOURCE_TOTAL_BYTES } from './whole-source';
import type { ProviderWholeSourceBody, ProviderWholeSourceLease } from './whole-source';
function lease(path = 'spec/file.test.ts', owner = 'group/repo'): ProviderWholeSourceLease {
  const repository = { provider: 'gitlab', origin: 'https://gitlab.com', path: owner } as const;const headSha = 'a'.repeat(40);const root = document.createElement('section');document.body.append(root);
  return { subjectKey: 'subject', root, current: () => root.isConnected, revision: { repository, path, headSha, key: JSON.stringify([repositoryKey(repository), headSha, path]) } };
}
const body = (text = 'test source'): ProviderWholeSourceBody => ({ lines: [text], bytes: new TextEncoder().encode(text).byteLength });
function deferred<T>() { let resolve!: (value: T) => void;let reject!: (value: unknown) => void;const promise = new Promise<T>((a, b) => { resolve = a;reject = b; });return { promise, resolve, reject }; }
const next = async (): Promise<void> => { for (let at = 0; at < 8; at++) await Promise.resolve(); };
afterEach(() => { document.body.replaceChildren();vi.useRealTimers();vi.restoreAllMocks(); });
it('coalesces owner/ref/path consumers and keeps another consumer alive when one cancels', async () => {
  const pending = deferred<ProviderWholeSourceBody>();let underlying: AbortSignal | undefined;const read = vi.fn((_ref: unknown, signal: AbortSignal) => { underlying = signal;return pending.promise; });const cache = new ProviderWholeSourceCache(read);
  const first = new AbortController();const a = cache.load(lease(), first.signal);const b = cache.load(lease(), new AbortController().signal);const refused = expect(a).rejects.toBeDefined();await next();expect(read).toHaveBeenCalledTimes(1);
  first.abort();await refused;expect(underlying?.aborted).toBe(false);pending.resolve(body());await expect(b).resolves.toMatchObject({ lines: ['test source'] });cache.destroy();
});
it('aborts on last-consumer cancellation without retrying the failed immutable key', async () => {
  let underlying: AbortSignal | undefined;const read = vi.fn((_ref: unknown, signal: AbortSignal) => { underlying = signal;return new Promise<ProviderWholeSourceBody>(() => {}); });const cache = new ProviderWholeSourceCache(read);const value = lease();const abort = new AbortController();
  const job = cache.load(value, abort.signal);const refusal = expect(job).rejects.toBeDefined();await next();abort.abort();await refusal;await next();expect(underlying?.aborted).toBe(true);
  await expect(cache.load(value, new AbortController().signal)).rejects.toBeDefined();expect(read).toHaveBeenCalledTimes(1);cache.destroy();
});
it('separates owners even with the same SHA/path and rejects a forged cache key', async () => {
  const read = vi.fn(async () => body());const cache = new ProviderWholeSourceCache(read);const a = lease();const b = lease('spec/file.test.ts', 'other/repo');
  await Promise.all([cache.load(a, new AbortController().signal), cache.load(b, new AbortController().signal)]);expect(read).toHaveBeenCalledTimes(2);
  await expect(cache.load({ ...b, revision: { ...b.revision, key: a.revision.key } }, new AbortController().signal)).rejects.toThrow('immutable source key');cache.destroy();
});
it('revalidates consumers after source arrival and discards retired authority', async () => {
  const pending = deferred<ProviderWholeSourceBody>();const cache = new ProviderWholeSourceCache(async () => pending.promise);const value = lease();const job = cache.load(value, new AbortController().signal);const refused = expect(job).rejects.toBeDefined();await next();value.root.remove();pending.resolve(body());await refused;expect(cache.ready(value.revision.key)).toBeNull();cache.destroy();
});
it('serializes raw reads per origin and caps sixteen pending files', async () => {
  const read = vi.fn(async (_ref: unknown, signal: AbortSignal) => new Promise<ProviderWholeSourceBody>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));const cache = new ProviderWholeSourceCache(read);
  const jobs = Array.from({ length: 16 }, (_, index) => cache.load(lease(`spec/${index}.test.ts`), new AbortController().signal).catch(() => undefined));await next();expect(read).toHaveBeenCalledTimes(1);
  await expect(cache.load(lease('spec/overflow.test.ts'), new AbortController().signal)).rejects.toThrow('capacity');cache.destroy();await Promise.all(jobs);
});
it('bounds retained source bytes and does not retain mutable reader array aliases', async () => {
  const text = 'x'.repeat(256 * 1024);const raw = { lines: [text], bytes: text.length };const cache = new ProviderWholeSourceCache(async () => raw);const values = [];
  for (let index = 0; index < 16; index++) { const value = lease(`spec/${index}.test.ts`);values.push(value);await cache.load(value, new AbortController().signal); }
  const ready = values.map((value) => cache.ready(value.revision.key)).filter((value) => value !== null);expect(ready.reduce((sum, value) => sum + value.bytes, 0)).toBeLessThanOrEqual(WHOLE_SOURCE_TOTAL_BYTES);
  expect(cache.ready(values[0]!.revision.key)).toBeNull();const last = cache.ready(values.at(-1)!.revision.key)!;raw.lines[0] = 'changed';expect(last.lines[0]).toBe(text);expect(Object.isFrozen(last.lines)).toBe(true);cache.destroy();
});
it('times out an unresponsive reader and settles consumers without retry', async () => {
  vi.useFakeTimers();const read = vi.fn(async () => new Promise<ProviderWholeSourceBody>(() => {}));const cache = new ProviderWholeSourceCache(read, 100);const value = lease();const job = cache.load(value, new AbortController().signal);const refusal = expect(job).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(100);await refusal;await expect(cache.load(value, new AbortController().signal)).rejects.toThrow('timed out');expect(read).toHaveBeenCalledTimes(1);cache.destroy();
});
it('decodes split UTF8 chunks with explicit CRLF normalization and distinguishes valid empty text', async () => {
  const bytes = new TextEncoder().encode('it café\r\nend\n');const stream = new ReadableStream({ start(controller) { const at = bytes.indexOf(0xc3) + 1;controller.enqueue(bytes.slice(0, at));controller.enqueue(bytes.slice(at));controller.close(); } });
  await expect(readProviderWholeSource(new Response(stream, { headers: { 'content-type': 'text/plain' } }), new AbortController().signal)).resolves.toEqual({ lines: ['it café', 'end', ''], bytes: bytes.length });
  await expect(readProviderWholeSource(new Response('', { headers: { 'content-type': 'text/plain' } }), new AbortController().signal)).resolves.toEqual({ lines: [''], bytes: 0 });
});
for (const [name, source, type] of [['html', '<html>sign in</html>', 'text/html'], ['disguised page', '<!doctype html>', 'text/plain'], ['binary', '\0payload', 'text/plain']] as const) it(`rejects ${name} instead of treating it as source`, async () => { await expect(readProviderWholeSource(new Response(source, { headers: { 'content-type': type } }), new AbortController().signal)).rejects.toThrow(); });
it('rejects invalid UTF8 and cancels streamed or Content-Length overflow', async () => {
  await expect(readProviderWholeSource(new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'text/plain' } }), new AbortController().signal)).rejects.toThrow();
  const cancelled = vi.fn();const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(WHOLE_SOURCE_FILE_BYTES + 1)); }, cancel: cancelled });await expect(readProviderWholeSource(new Response(stream, { headers: { 'content-type': 'text/plain' } }), new AbortController().signal)).rejects.toThrow('too large');expect(cancelled).toHaveBeenCalledTimes(1);
  const headerCancel = vi.fn();await expect(readProviderWholeSource(new Response(new ReadableStream({ cancel: headerCancel }), { headers: { 'content-type': 'text/plain', 'content-length': String(WHOLE_SOURCE_FILE_BYTES + 1) } }), new AbortController().signal)).rejects.toThrow('too large');expect(headerCancel).toHaveBeenCalledTimes(1);
});
it('cancels an outstanding stream read on abort so its HTTP admission can release', async () => {
  const cancelled = vi.fn();const abort = new AbortController();const job = readProviderWholeSource(new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'content-type': 'text/plain' } }), abort.signal);const refused = expect(job).rejects.toBeDefined();abort.abort();await refused;expect(cancelled).toHaveBeenCalledTimes(1);
});
