type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** What callers read from an answer's headers. */
const KEPT_HEADERS = ['content-type', 'link'];

function isFetch(value: unknown): value is Fetch {
  return typeof value === 'function';
}

/** Firefox's `content.fetch`, the page's own, or null where content scripts have none (Chrome, Safari). */
function contentFetch(): Fetch | null {
  const page: unknown = Reflect.get(globalThis, 'content');
  if (typeof page !== 'object' || page === null) return null;
  const own: unknown = Reflect.get(page, 'fetch');
  return isFetch(own) ? (input, init) => own.call(page, input, init) : null;
}

/**
 * A request to the page's host, sent as the page sends it. Firefox runs a content script's `fetch` in the extension's
 * sandbox: a relative path throws, and an absolute one goes out with no Origin or Referer, which GitHub's CSRF check
 * refuses on every write ("Your browser did something unexpected"). `content.fetch` sends it as the page, and its
 * answer is read into a Response of the content script's, since what it parses would otherwise belong to the page.
 */
export async function pageFetch(path: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(path, location.href);
  const page = url.origin === location.origin ? contentFetch() : null;
  if (page === null) return fetch(url, init);
  // A signal from the content script's world is not the page's, so it is honoured here: the request may still finish
  // in the page, but an aborted caller gets the abort, never a late answer to act on.
  const signal = init?.signal ?? null;
  signal?.throwIfAborted();
  const pageInit: RequestInit = { ...init };
  delete pageInit.signal;
  const answer = await untilAborted(page(url.href, pageInit), signal);
  const headers: Record<string, string> = {};
  // The page's headers are the page's objects: the ones read are copied over (`Link` pages GitHub's timeline data).
  for (const name of KEPT_HEADERS) {
    const value = answer.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const body = NULL_BODY_STATUSES.has(answer.status) ? null : await untilAborted(answer.text(), signal);
  signal?.throwIfAborted();
  return new Response(body, { status: answer.status, statusText: answer.statusText, headers });
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal | null): Promise<T> {
  if (signal === null) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      const reason: unknown = signal.reason;
      reject(reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
