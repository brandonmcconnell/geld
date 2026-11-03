import { storage } from 'wxt/utils/storage';

const API = 'https://api.bitbucket.org';
const NATIVE = 'https://bitbucket.org';
const COOLDOWN_KEY = 'local:bitbucketApiCooldownUntil';
const FALLBACK_COOLDOWN_MS = 60 * 60_000;

export class BitbucketTransportError extends Error {
  constructor(readonly reason: 'invalid-response' | 'rate-limited', message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'BitbucketTransportError';
  }
}

export interface BitbucketCooldownStore {
  read(): Promise<unknown>;
  write(until: number): Promise<void>;
  watch?(changed: (value: unknown) => void): () => void;
}

export interface BitbucketTransport {
  fetch(input: RequestInfo | URL, init?: RequestInit, fetcher?: typeof fetch): Promise<Response>;
  dispose(): void;
}

const persistentStore: BitbucketCooldownStore = {
  read: () => storage.getItem<unknown>(COOLDOWN_KEY),
  write: (until) => storage.setItem(COOLDOWN_KEY, until),
  watch: (changed) => storage.watch<unknown>(COOLDOWN_KEY, changed),
};

function invalid(): never {
  throw new BitbucketTransportError('invalid-response', 'Bitbucket returned an untrusted API resource.');
}

export function canonicalBitbucketApiUrl(value: string | URL, base?: URL): URL {
  let url: URL;
  try { url = new URL(value, base); } catch { return invalid(); }
  if (url.username !== '' || url.password !== '' || url.hash !== '') return invalid();
  if (url.origin === NATIVE && url.pathname.startsWith('/!api/2.0/repositories/')) url = new URL(`${url.pathname.slice('/!api'.length)}${url.search}`, API);
  if (url.origin !== API) return invalid();
  const match = /^\/2\.0\/repositories\/([^/]+)\/([^/]+)(?:\/|$)/.exec(url.pathname);
  if (match === null) return invalid();
  for (const part of match.slice(1)) {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { return invalid(); }
    if (decoded === '' || decoded === '.' || decoded === '..' || /[\s\\/?#%\u0000-\u001f]/.test(decoded)) return invalid();
  }
  return url;
}

function expiry(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function retryDelay(header: string | null, now: number): number {
  if (header !== null) {
    const text = header.trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const delay = Math.ceil(Number(text) * 1000);
      if (Number.isFinite(delay)) return delay;
    } else if (/^(?:[a-z]{3,9}, |[a-z]{3} [a-z]{3} {1,2}\d{1,2} )/i.test(text)) {
      const date = Date.parse(text);
      if (Number.isFinite(date)) return Math.max(0, date - now);
    }
  }
  return FALLBACK_COOLDOWN_MS;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (signal === null || signal === undefined) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    promise.then((value) => { signal.removeEventListener('abort', aborted); resolve(value); }, (error: unknown) => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}

export function createBitbucketTransport(options: {
  readonly store?: BitbucketCooldownStore;
  readonly origin?: () => string | null;
  readonly now?: () => number;
} = {}): BitbucketTransport {
  const store = options.store ?? persistentStore;
  const now = options.now ?? Date.now;
  const origin = options.origin ?? (() => typeof location === 'undefined' ? null : location.origin);
  let until = 0;
  let writeQueue: Promise<void> = Promise.resolve();
  let watching = false;
  let unwatch: (() => void) | null = null;
  const read = async (): Promise<number> => { try { return expiry(await store.read()); } catch { return 0; } };
  const persistMax = (): Promise<void> => {
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      const stored = await read();
      until = Math.max(until, stored);
      if (stored < until) await store.write(until);
    }).catch(() => undefined);
    return writeQueue;
  };
  const dispose = (): void => {
    unwatch?.(); unwatch = null; watching = false;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', dispose);
  };
  const watch = (): void => {
    if (watching) return;
    watching = true;
    try {
      unwatch = store.watch?.((value) => {
        const next = expiry(value);
        until = Math.max(until, next);
        if (next < until && until > now()) void persistMax();
      }) ?? null;
      if (unwatch !== null && typeof window !== 'undefined') window.addEventListener('pagehide', dispose, { once: true });
    } catch { unwatch = null; }
  };
  return {
    dispose,
    fetch: async (input, init, fetcher = fetch): Promise<Response> => {
      const request = input instanceof Request ? input : null;
      if ((init?.method ?? request?.method ?? 'GET').toUpperCase() !== 'GET') return invalid();
      const logical = canonicalBitbucketApiUrl(request?.url ?? String(input));
      const signal = init?.signal === undefined ? request?.signal : init.signal;
      signal?.throwIfAborted();
      watch();
      until = Math.max(until, await abortable(read(), signal));
      signal?.throwIfAborted();
      if (until > now()) throw new BitbucketTransportError('rate-limited', 'Bitbucket API requests are paused until its rate limit resets.', until - now());
      const native = origin() === NATIVE;
      const target = native ? new URL(`/!api${logical.pathname}${logical.search}`, NATIVE) : logical;
      const response = await fetcher.call(globalThis, target.href, { ...(request === null ? {} : { headers: request.headers, cache: request.cache }), ...init, ...(signal === undefined ? {} : { signal }), method: 'GET', credentials: native ? 'same-origin' : 'omit', redirect: 'manual' });
      if (response.redirected || response.type === 'opaqueredirect' || response.type === 'opaque' || response.type === 'error' || response.status === 0 || response.status >= 300 && response.status < 400) return invalid();
      if (response.url !== '' && response.url !== target.href) return invalid();
      if (response.status === 429) {
        const at = now();
        const delay = retryDelay(response.headers.get('retry-after'), at);
        until = Math.max(until, at + delay);
        await abortable(persistMax(), signal);
        signal?.throwIfAborted();
        throw new BitbucketTransportError('rate-limited', 'Bitbucket is limiting API requests.', Math.max(delay, until - at));
      }
      signal?.throwIfAborted();
      const canonical = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(canonical, 'url', { value: logical.href });
      return canonical;
    },
  };
}

export const bitbucketTransport = createBitbucketTransport();
