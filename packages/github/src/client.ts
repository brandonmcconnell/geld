import type { FetchLike, TokenSource } from './auth';

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'signed_out' | 'unavailable' | 'invalid_response' | 'not_found' | 'unsupported' }
  | { readonly ok: false; readonly reason: 'permission'; readonly required: string | null; readonly url: string | null }
  | { readonly ok: false; readonly reason: 'rate_limit'; readonly retryAt: number | null };

export interface ApiTransport {
  request(path: string, options?: { readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; readonly body?: unknown; readonly rawBody?: string; readonly contentType?: 'application/x-www-form-urlencoded' | 'text/plain'; readonly text?: boolean; readonly accept?: string }): Promise<ApiResult<unknown>>;
}

export function createApiTransport(options: { readonly baseUrl: string; readonly source: TokenSource; readonly fetch?: FetchLike; readonly anonymousReads?: boolean; readonly anonymousWrites?: boolean; readonly now?: () => number }): ApiTransport {
  const base = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Invalid provider API origin');
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  return {
    async request(path, init = {}) {
      if (path.startsWith('/') || path.includes('\\')) return { ok: false, reason: 'invalid_response' };
      const url = new URL(path, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return { ok: false, reason: 'invalid_response' };
      const method = init.method ?? 'GET';
      const sources = [options.source, ...(options.source.alternatives ?? [])];
      candidates: for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        if (!source) continue;
        const moreSources = index < sources.length - 1;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const access = await source.get({ force: attempt === 1 });
          if (access.status !== 'ok' && moreSources) continue candidates;
          if (access.status === 'unavailable') return { ok: false, reason: 'unavailable' };
          if (access.status === 'signed-out' && !(options.anonymousReads === true && method === 'GET') && !(options.anonymousWrites === true && method === 'POST')) return { ok: false, reason: 'signed_out' };
          const headers: Record<string, string> = { Accept: init.accept ?? 'application/json' };
          if (access.status === 'ok') headers.Authorization = `Bearer ${access.token}`;
          if (base.hostname === 'api.github.com' || base.pathname.includes('/api/v3')) headers['X-GitHub-Api-Version'] = '2022-11-28';
          if (init.body !== undefined && init.rawBody !== undefined) return { ok: false, reason: 'invalid_response' };
          if (init.body !== undefined || init.rawBody !== undefined) headers['Content-Type'] = init.contentType ?? 'application/json';
          let response: Response;
          try {
            let target = url;
            for (let redirects = 0; ; redirects += 1) {
              response = await fetchImpl(target.toString(), { method, headers, redirect: 'manual', ...(init.rawBody !== undefined ? { body: init.rawBody } : init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
              if (![301,302,303,307,308].includes(response.status)) break;
              const location = response.headers.get('location');
              if (method !== 'GET' || !location || redirects >= 2) return { ok: false, reason: 'unavailable' };
              const next = new URL(location, target);
              if (next.origin !== base.origin || !next.pathname.startsWith(base.pathname) || next.username || next.password) return { ok: false, reason: 'permission', required: null, url: null };
              target = next;
            }
          } catch {
            return { ok: false, reason: 'unavailable' };
          }
          if (response.status === 401 && attempt === 0 && access.status === 'ok') continue;
          if (response.status === 401) { if (moreSources) continue candidates; return { ok: false, reason: 'signed_out' }; }
          if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
            const retry = Number(response.headers.get('retry-after'));
            const reset = Number(response.headers.get('x-ratelimit-reset'));
            return { ok: false, reason: 'rate_limit', retryAt: retry > 0 ? now() + retry * 1000 : reset > 0 ? reset * 1000 : null };
          }
          if (response.status === 403) { if (moreSources) continue candidates; return { ok: false, reason: 'permission', required: response.headers.get('x-accepted-github-permissions'), url: null }; }
          if (response.status === 404) { if (moreSources) continue candidates; return { ok: false, reason: 'not_found' }; }
          if (!response.ok) return { ok: false, reason: 'unavailable' };
          if (response.status === 204) return { ok: true, value: null };
          try {
            const value: unknown = init.text === true ? await response.text() : await response.json();
            return { ok: true, value };
          } catch {
            return { ok: false, reason: 'invalid_response' };
          }
        }
      }
      return { ok: false, reason: 'signed_out' };
    },
  };
}
