import { ProviderHttpAdmission } from './http-admission';
import type { ProviderHttpClock } from './http-admission';
import { fetchGitLabStandaloneDiff } from '../gitlab/standalone-source';
import type { ProviderStandalonePage } from './types';
const signal = () => new AbortController().signal;
const origin = 'https://gitlab.com';
function deferred<T>() { let resolve!: (value: T) => void;let reject!: (error: unknown) => void;const promise = new Promise<T>((a, b) => { resolve = a;reject = b; });return { promise, resolve, reject }; }
afterEach(() => { vi.useRealTimers();vi.restoreAllMocks(); });

it('spaces participating HTTP starts while holding at most two active operations', async () => {
  vi.useFakeTimers();const lane = new ProviderHttpAdmission();const events: number[] = [];const pending = [deferred<void>(), deferred<void>(), deferred<void>()];
  const jobs = pending.map((p) => lane.run(origin, { signal: signal() }, () => { events.push(Date.now());return p.promise; }));
  await vi.advanceTimersByTimeAsync(749);expect(events).toHaveLength(1);await vi.advanceTimersByTimeAsync(1);expect(events).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1000);expect(events).toHaveLength(2);pending[0]!.resolve();await vi.advanceTimersByTimeAsync(0);expect(events).toHaveLength(3);
  expect(events[1]! - events[0]!).toBe(750);expect(events[2]! - events[1]!).toBeGreaterThanOrEqual(750);pending[1]!.resolve();pending[2]!.resolve();await Promise.all(jobs);
});
it('explicit source input precedes queued ordinary HTTP and cancels before dispatch', async () => {
  vi.useFakeTimers();const lane = new ProviderHttpAdmission();const order: string[] = [];
  await lane.run(origin, { signal: signal() }, async () => { order.push('initial'); });
  const idle = lane.run(origin, { signal: signal(), priority: 1 }, async () => { order.push('diff'); });
  const raw = lane.run(origin, { signal: signal(), priority: 0 }, async () => { order.push('raw'); });
  const abort = new AbortController();const cancelled = lane.run(origin, { signal: abort.signal }, async () => { order.push('cancelled'); });const refused = expect(cancelled).rejects.toBeDefined();abort.abort();await refused;
  await vi.advanceTimersByTimeAsync(1500);await Promise.all([idle, raw]);expect(order).toEqual(['initial', 'raw', 'diff']);
});
it('checks a fresh lease immediately before dispatch, including thrown stale readers', async () => {
  vi.useFakeTimers();const lane = new ProviderHttpAdmission();await lane.run(origin, { signal: signal() }, async () => {});
  let valid = true;const read = vi.fn(async () => {});const job = lane.run(origin, { signal: signal(), current: () => valid }, read);const refused = expect(job).rejects.toThrow('selection changed');valid = false;
  await vi.advanceTimersByTimeAsync(750);await refused;expect(read).not.toHaveBeenCalled();await expect(lane.run(origin, { signal: signal(), current: () => { throw Error('stale'); } }, read)).rejects.toThrow('selection changed');
});
it('shares Retry-After cooldown across raw and diff without retry or cross-origin leakage', async () => {
  vi.useFakeTimers();const lane = new ProviderHttpAdmission();await expect(lane.run(origin, { signal: signal() }, async () => { throw Object.assign(Error('limit'), { status: 429, retryAfter: '20' }); })).rejects.toThrow('limit');
  expect(lane.paused(origin)).toBe(true);const op = vi.fn(async () => {});await expect(lane.run(origin, { signal: signal(), priority: 0 }, op)).rejects.toThrow('cooling down');expect(op).not.toHaveBeenCalled();
  await lane.run('https://other.example', { signal: signal() }, op);expect(op).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(20000);await lane.run(origin, { signal: signal() }, op);expect(op).toHaveBeenCalledTimes(2);
});
it('keeps direct source callers free of a global admission clock', async () => {
  const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('[]', { headers: { 'content-type': 'application/json' } }));
  const page: ProviderStandalonePage = { kind: 'commit', provider: 'gitlab', repository: { provider: 'gitlab', origin, path: 'g/r' }, ref: 'a'.repeat(40), headSha: 'a'.repeat(40), url: origin + '/g/r/-/commit/' + 'a'.repeat(40), diffUrl: origin + '/g/r/-/commit/' + 'a'.repeat(40) + '.diff', diffPageUrl: origin + '/g/r/-/commit/' + 'a'.repeat(40), version: 'v' };
  await expect(fetchGitLabStandaloneDiff(page, signal())).rejects.toThrow();expect(http).toHaveBeenCalledTimes(3);
});
it('admits parallel child reads of one logical operation without a nested permit deadlock', async () => {
  const time: ProviderHttpClock = { now: () => 0, later: (callback) => setTimeout(callback, 0), cancel: clearTimeout };const lane = new ProviderHttpAdmission(time, 0);
  const logical = async (): Promise<number[]> => Promise.all([lane.run(origin, { signal: signal() }, async () => 1), lane.run(origin, { signal: signal() }, async () => 2), lane.run(origin, { signal: signal() }, async () => 3)]);
  await expect(Promise.all([logical(), logical()])).resolves.toEqual([[1, 2, 3], [1, 2, 3]]);
});
