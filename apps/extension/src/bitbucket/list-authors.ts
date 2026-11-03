import { normalizeReviewAccountId } from '@geld/core';
import type { ProviderListAuthor, ProviderListAuthorFetcher } from '../providers/types';
import { describeBitbucketPage } from './page';
import { bitbucketTransport } from './transport';
import type { BitbucketTransport } from './transport';

const NATIVE = 'https://bitbucket.org';
const MAX_BYTES = 256 * 1024;
const FIELDS = 'values.id,values.author.uuid,values.author.display_name';
const STATES = new Set(['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED']);

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function selection(url: URL): { readonly repository: string; readonly endpoint: URL } | null {
  if (url.origin !== NATIVE || url.username !== '' || url.password !== '' || url.hash !== '') return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull-requests\/?$/.exec(url.pathname);
  const states = url.searchParams.getAll('state');
  if (match === null || states.length !== 1 || !STATES.has(states[0] ?? '') || [...url.searchParams.keys()].some((key) => key !== 'state')) return null;
  let parts: string[];
  try { parts = match.slice(1).map(decodeURIComponent); } catch { return null; }
  if (parts.some((part) => part === '' || part === '.' || part === '..' || /[\s\\/?#%\u0000-\u001f]/.test(part))) return null;
  const endpoint = new URL(`/2.0/repositories/${parts.map(encodeURIComponent).join('/')}/pullrequests`, 'https://api.bitbucket.org');
  // Native public list requests use this fixed predicate and page size; the generic 100 limit is not endpoint proof.
  endpoint.searchParams.set('q', `state="${states[0] ?? ''}"`);
  endpoint.searchParams.set('pagelen', '25');
  endpoint.searchParams.set('fields', FIELDS);
  return { repository: parts.join('/'), endpoint };
}

async function body(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') ?? '') || response.body === null) throw new Error('Bitbucket list authors are unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Bitbucket list authors exceed the bounded response'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    signal.throwIfAborted();
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

/** Documented one-page collection projection; omitted/unknown authors remain visible, never fetch another page. */
export function createBitbucketListAuthorFetcher(fetcher: typeof fetch = fetch, transport: BitbucketTransport = bitbucketTransport): ProviderListAuthorFetcher {
  return async (listUrl, visibleReviewUrls, signal): Promise<readonly ProviderListAuthor[]> => {
    signal.throwIfAborted();
    const current = selection(listUrl);
    if (current === null || visibleReviewUrls.length === 0 || visibleReviewUrls.length > 100) return [];
    const expected = new Map<number, string>();
    for (const value of visibleReviewUrls) {
      let url: URL;
      try { url = new URL(value); } catch { return []; }
      const page = describeBitbucketPage(url);
      if (page === null || page.kind !== 'overview' || page.repository.path !== current.repository || value !== page.url) return [];
      const id = Number(page.number);
      if (!Number.isSafeInteger(id) || id <= 0) return [];
      expected.set(id, page.url);
    }
    const response = await transport.fetch(current.endpoint, { signal, cache: 'no-cache', headers: { Accept: 'application/json' } }, fetcher);
    if (response.url !== current.endpoint.href) throw new Error('Bitbucket list author response left its scope');
    const value = await body(response, signal);
    if (!record(value) || !Array.isArray(value.values) || value.values.length > 25) throw new Error('Bitbucket list author response is invalid');
    const result: ProviderListAuthor[] = [];
    const seen = new Set<number>();
    for (const entry of value.values) {
      if (!record(entry) || typeof entry.id !== 'number' || !Number.isSafeInteger(entry.id) || entry.id <= 0 || seen.has(entry.id)) throw new Error('Bitbucket list author response has an ambiguous review');
      seen.add(entry.id);
      const url = expected.get(entry.id);
      if (url === undefined || !record(entry.author) || typeof entry.author.uuid !== 'string') continue;
      const uuid = normalizeReviewAccountId('bitbucket', entry.author.uuid);
      if (uuid === null) continue;
      result.push({ url, author: `bitbucket.org/uuid/${uuid}`, authorName: typeof entry.author.display_name === 'string' && entry.author.display_name.trim() !== '' ? entry.author.display_name : null });
    }
    return result;
  };
}

export const fetchBitbucketListAuthors = createBitbucketListAuthorFetcher();
