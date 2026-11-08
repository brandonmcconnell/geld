type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

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
  // A signal from the content script's world is not the page's: the caller's own deadline ends its wait there instead.
  const pageInit: RequestInit = { ...init };
  delete pageInit.signal;
  const answer = await page(url.href, pageInit);
  const type = answer.headers.get('content-type');
  const body = NULL_BODY_STATUSES.has(answer.status) ? null : await answer.text();
  return new Response(body, { status: answer.status, statusText: answer.statusText, headers: type === null ? {} : { 'Content-Type': type } });
}
