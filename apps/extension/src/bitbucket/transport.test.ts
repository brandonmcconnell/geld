const persisted = vi.hoisted(() => { const keys: string[] = []; const values: number[] = []; return { value: 0, keys, values, listeners: new Set<(value: unknown) => void>() }; });
vi.mock('wxt/utils/storage', () => ({ storage: {
  getItem: async (key: string) => { persisted.keys.push(key); return persisted.value; },
  setItem: async (key: string, value: number) => { persisted.keys.push(key); persisted.values.push(value); persisted.value = value; for (const changed of persisted.listeners) changed(value); },
  watch: (key: string, changed: (value: unknown) => void) => { persisted.keys.push(key); persisted.listeners.add(changed); return () => { persisted.listeners.delete(changed); }; },
} }));

import { canonicalBitbucketApiUrl, createBitbucketTransport } from './transport';
import type { BitbucketCooldownStore } from './transport';

const ROOT = 'https://api.bitbucket.org/2.0/repositories/acme/widgets';
const URL = `${ROOT}/pullrequests/42/comments?pagelen=100`;
const NATIVE = URL.replace('https://api.bitbucket.org/2.0/', 'https://bitbucket.org/!api/2.0/');
const NOW = Date.UTC(2026, 10, 1, 17);

function memory(initial: unknown = 0): { store: BitbucketCooldownStore; get(): unknown; force(value: unknown): void; listeners: Set<(value: unknown) => void> } {
  let value = initial;
  const listeners = new Set<(value: unknown) => void>();
  const force = (next: unknown): void => { value = next; for (const changed of listeners) changed(value); };
  return { get: () => value, force, listeners, store: { read: vi.fn(async () => value), write: vi.fn(async (until: number) => force(until)), watch: (changed) => { listeners.add(changed); return () => { listeners.delete(changed); }; } } };
}

function response(value: unknown = {}, status = 200, headers: HeadersInit = {}, url = ''): Response {
  const result = new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
  if (url !== '') Object.defineProperty(result, 'url', { value: url });
  return result;
}

it('uses only the observed fixed same-origin proxy with native session credentials and a Window fetch receiver', async () => {
  const backing = memory();
  const transport = createBitbucketTransport({ origin: () => 'https://bitbucket.org', now: () => NOW, store: backing.store });
  const controller = new AbortController();
  const fetcher: typeof fetch = async function (this: unknown, input, init) {
    expect(this).toBe(globalThis);
    expect(String(input)).toBe(NATIVE);
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', redirect: 'manual', signal: controller.signal });
    return response({ values: [] }, 200, {}, NATIVE);
  };
  const result = await transport.fetch(URL, { signal: controller.signal, headers: { Accept: 'application/json' } }, fetcher);
  expect(result.url).toBe(URL);
  expect(await result.json()).toEqual({ values: [] });
  expect(result.headers.get('content-type')).toBe('application/json');
  transport.dispose();
  expect(backing.listeners.size).toBe(0);
});

it.each([null, 'https://example.com', 'http://bitbucket.org', 'https://bitbucket.org.evil.example', 'https://bitbucket.org:8443'])('retains the public canonical API with omitted credentials outside the exact native origin %s', async (origin) => {
  const transport = createBitbucketTransport({ origin: () => origin, store: memory().store });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
  await transport.fetch(URL, {}, fetcher);
  expect(fetcher).toHaveBeenCalledWith(URL, expect.objectContaining({ credentials: 'omit', redirect: 'manual' }));
  transport.dispose();
});

it('canonicalizes only exact first-party proxy URLs, never arbitrary proxy hosts or unsafe repository identities', () => {
  expect(canonicalBitbucketApiUrl(NATIVE).href).toBe(URL);
  for (const value of ['https://example.com/!api/2.0/repositories/acme/widgets', 'https://bitbucket.org/not-api/2.0/repositories/acme/widgets', 'https://bitbucket.org/!api/internal/repositories/acme/widgets', 'https://bitbucket.org/!api/2.0/repositories/acme%2Fother/widgets', 'https://user:secret@bitbucket.org/!api/2.0/repositories/acme/widgets', `${URL}#unexpected`]) expect(() => canonicalBitbucketApiUrl(value)).toThrow('untrusted');
});

it('rejects redirects, unexpected final URLs, and non-read operations without trying another transport', async () => {
  for (const result of [new Response('', { status: 302, headers: { location: URL } }), response({}, 200, {}, URL), response({}, 200, {}, NATIVE.replace('/widgets/', '/other/')), response({}, 200, {}, NATIVE.replace('/!api/', '/other/')), response({}, 200, {}, 'https://example.com/collect')]) {
    const transport = createBitbucketTransport({ origin: () => 'https://bitbucket.org', store: memory().store });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result);
    await expect(transport.fetch(URL, {}, fetcher)).rejects.toMatchObject({ reason: 'invalid-response' });
    expect(fetcher).toHaveBeenCalledOnce();
    transport.dispose();
  }
  const transport = createBitbucketTransport({ store: memory().store });
  const fetcher = vi.fn<typeof fetch>();
  await expect(transport.fetch(URL, { method: 'POST' }, fetcher)).rejects.toMatchObject({ reason: 'invalid-response' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('blocks every source and a reloaded transport after a 429 without a usable Retry-After', async () => {
  const backing = memory();
  const transport = createBitbucketTransport({ origin: () => 'https://bitbucket.org', now: () => NOW, store: backing.store });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, 429));
  await expect(transport.fetch(URL, {}, fetcher)).rejects.toMatchObject({ reason: 'rate-limited', retryAfterMs: 3_600_000 });
  expect(backing.get()).toBe(NOW + 3_600_000);
  transport.dispose();
  const reloaded = createBitbucketTransport({ origin: () => null, now: () => NOW, store: backing.store });
  for (const path of ['/pullrequests/42/comments', '/diff/abc', '/commit/abc', '/src/abc/.github/geld.yml', '']) await expect(reloaded.fetch(`${ROOT}${path}`, {}, fetcher)).rejects.toMatchObject({ reason: 'rate-limited', retryAfterMs: 3_600_000 });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(vi.mocked(backing.store.write).mock.calls.every(([value]) => typeof value === 'number')).toBe(true);
  reloaded.dispose();
});

it('persists only the provider cooldown timestamp through the default WXT storage path and reloads it', async () => {
  persisted.value = 0; persisted.keys.length = 0; persisted.values.length = 0;
  const first = createBitbucketTransport({ now: () => NOW, origin: () => null });
  await expect(first.fetch(URL, {}, vi.fn<typeof fetch>().mockResolvedValue(response({}, 429)))).rejects.toMatchObject({ reason: 'rate-limited' });
  first.dispose();
  const reloaded = createBitbucketTransport({ now: () => NOW, origin: () => null });
  const fetcher = vi.fn<typeof fetch>();
  await expect(reloaded.fetch(URL, {}, fetcher)).rejects.toMatchObject({ retryAfterMs: 3_600_000 });
  expect(fetcher).not.toHaveBeenCalled();
  expect(persisted.values).toEqual([NOW + 3_600_000]);
  expect(persisted.keys.every((key) => key === 'local:bitbucketApiCooldownUntil')).toBe(true);
  reloaded.dispose();
  expect(persisted.listeners.size).toBe(0);
});

it.each(['', '-1', 'not a date'])('uses one hour for an invalid Retry-After %j', async (retry) => {
  const transport = createBitbucketTransport({ store: memory().store, now: () => NOW });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, 429, { 'retry-after': retry }));
  await expect(transport.fetch(URL, {}, fetcher)).rejects.toMatchObject({ retryAfterMs: 3_600_000 });
  transport.dispose();
});

it.each([['12', 12_000], ['7200', 7_200_000], [new Date(NOW + 7_200_000).toUTCString(), 7_200_000], ['Sunday, 01-Nov-26 19:00:00 GMT', 7_200_000], ['Sun Nov  1 19:00:00 2026', 7_200_000], ['0', 0]])('honors valid Retry-After %s without capping its delay', async (retry, delay) => {
  const backing = memory();
  const transport = createBitbucketTransport({ store: backing.store, now: () => NOW });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, 429, { 'retry-after': retry }));
  await expect(transport.fetch(URL, {}, fetcher)).rejects.toMatchObject({ retryAfterMs: delay });
  expect(backing.get()).toBe(NOW + delay);
  transport.dispose();
});

it('repairs stale shorter persisted expiries while retaining the provider-wide maximum', async () => {
  const backing = memory();
  const transport = createBitbucketTransport({ store: backing.store, now: () => NOW });
  await expect(transport.fetch(URL, {}, vi.fn<typeof fetch>().mockResolvedValue(response({}, 429, { 'retry-after': '7200' })))).rejects.toMatchObject({ reason: 'rate-limited' });
  backing.force(NOW + 60_000);
  await vi.waitFor(() => expect(backing.get()).toBe(NOW + 7_200_000));
  const fetcher = vi.fn<typeof fetch>();
  await expect(transport.fetch(URL, {}, fetcher)).rejects.toMatchObject({ retryAfterMs: 7_200_000 });
  expect(fetcher).not.toHaveBeenCalled();
  transport.dispose();
});

it('permits a request after the persisted expiry and preserves a native authentication failure as a response', async () => {
  let now = NOW;
  const transport = createBitbucketTransport({ store: memory(NOW + 1000).store, now: () => now });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, 401));
  await expect(transport.fetch(URL, {}, fetcher)).rejects.toMatchObject({ reason: 'rate-limited' });
  now += 1001;
  expect((await transport.fetch(URL, {}, fetcher)).status).toBe(401);
  expect(fetcher).toHaveBeenCalledOnce();
  transport.dispose();
});

it('does no storage or network work for a pre-aborted request and aborts a pending cooldown read', async () => {
  const backing = memory();
  const transport = createBitbucketTransport({ store: backing.store });
  const fetcher = vi.fn<typeof fetch>();
  const aborted = new AbortController(); aborted.abort();
  await expect(transport.fetch(URL, { signal: aborted.signal }, fetcher)).rejects.toMatchObject({ name: 'AbortError' });
  expect(backing.store.read).not.toHaveBeenCalled();
  let finish: (value: unknown) => void = () => undefined;
  const pendingStore: BitbucketCooldownStore = { read: () => new Promise((resolve) => { finish = resolve; }), write: async () => undefined };
  const pending = createBitbucketTransport({ store: pendingStore });
  const controller = new AbortController();
  const request = pending.fetch(URL, { signal: controller.signal }, fetcher);
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  finish(0);
  expect(fetcher).not.toHaveBeenCalled();
  pending.dispose(); transport.dispose();
});

it('forwards cancellation to an in-flight native fetch without retrying on the public API', async () => {
  const transport = createBitbucketTransport({ origin: () => 'https://bitbucket.org', store: memory().store });
  const controller = new AbortController();
  let started: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    started();
    if (signal === null || signal === undefined) { reject(new Error('Missing forwarded signal')); return; }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const request = transport.fetch(URL, { signal: controller.signal }, fetcher);
  await ready;
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(NATIVE);
  transport.dispose();
});
