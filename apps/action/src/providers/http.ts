import { ProviderCiError } from './config';
import type { ProviderCiConfig } from './config';

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_RECORDS = 20_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ProviderCiError('The provider returned an invalid object.');
  return value;
}

export function text(value: unknown): string {
  if (typeof value !== 'string') throw new ProviderCiError('The provider returned an invalid string.');
  return value;
}

export function id(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
  throw new ProviderCiError('The provider returned an invalid native ID.');
}

export function time(value: unknown): string {
  const valueText = text(value);
  if (!Number.isFinite(Date.parse(valueText))) throw new ProviderCiError('The provider returned an invalid timestamp.');
  return valueText;
}

export function sha(value: unknown): string {
  const valueText = text(value);
  if (!/^[a-f0-9]{40}$/i.test(valueText)) throw new ProviderCiError('The provider returned an invalid commit SHA.');
  return valueText;
}

export function sameReviewUrl(value: unknown, reviewUrl: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, reviewUrl);
    const review = new URL(reviewUrl);
    return url.origin === review.origin && url.protocol === 'https:' && url.username === '' && url.password === '' && (url.pathname === review.pathname || url.pathname.startsWith(`${review.pathname}/`)) ? url.href : null;
  } catch {
    return null;
  }
}

export class ProviderHttp {
  constructor(readonly config: ProviderCiConfig, private readonly fetcher: typeof fetch = fetch) {}

  private url(path: string): URL {
    const base = new URL(this.config.apiBase);
    const url = new URL(path, `${this.config.apiBase}/`);
    if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`) || url.username !== '' || url.password !== '' || url.hash !== '') throw new ProviderCiError('The provider returned an untrusted API URL.');
    return url;
  }

  async request(path: string, method = 'GET', body?: unknown): Promise<{ readonly value: unknown; readonly headers: Headers }> {
    const url = this.url(path);
    const authorization = this.config.tokenType === 'basic' ? `Basic ${Buffer.from(`${this.config.username}:${this.config.token}`, 'utf8').toString('base64')}` : `Bearer ${this.config.token}`;
    const headers = new Headers({ accept: 'application/json', authorization });
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await this.fetcher(url.href, { method, headers, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(30_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status >= 300 && response.status < 400) throw new ProviderCiError('The provider redirected an authenticated API request.');
    if (response.url !== '' && this.url(response.url).href !== url.href) throw new ProviderCiError('The provider returned data from a different API resource.');
    if (!response.ok) throw new ProviderCiError(`The provider API returned HTTP ${response.status}.`, response.status);
    const type = response.headers.get('content-type');
    if (type === null || !/^application\/(?:[\w.+-]*\+)?json\b/i.test(type)) throw new ProviderCiError('The provider did not return JSON.');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new ProviderCiError('The provider response exceeds the size limit.');
    if (response.body === null) throw new ProviderCiError('The provider returned no JSON body.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let raw = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          throw new ProviderCiError('The provider response exceeds the size limit.');
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    try {
      const value: unknown = JSON.parse(raw);
      return { value, headers: response.headers };
    } catch {
      throw new ProviderCiError('The provider returned invalid JSON.');
    }
  }

  async gitlabArray(path: string): Promise<readonly unknown[]> {
    const initial = this.url(path);
    const values: unknown[] = [];
    let page = '1';
    const visited = new Set<string>();
    let expected: number | null = null;
    for (;;) {
      if (visited.has(page) || visited.size >= MAX_PAGES) throw new ProviderCiError('GitLab pagination did not finish.');
      visited.add(page);
      const url = new URL(initial);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', page);
      const response = await this.request(url.href);
      if (!Array.isArray(response.value)) throw new ProviderCiError('GitLab returned an invalid collection.');
      values.push(...response.value);
      if (values.length > MAX_RECORDS) throw new ProviderCiError('GitLab review exceeds the record limit.');
      const total = response.headers.get('x-total');
      if (total !== null && /^\d+$/.test(total)) expected = Number(total);
      const next = response.headers.get('x-next-page');
      if (next === '' || next === null && response.value.length < 100) break;
      if (next !== null && !/^[1-9]\d*$/.test(next)) throw new ProviderCiError('GitLab returned an invalid next page.');
      page = next ?? String(Number(page) + 1);
    }
    if (expected !== null && values.length !== expected) throw new ProviderCiError('GitLab returned an incomplete collection.');
    return values;
  }

  async bitbucketValues(path: string): Promise<readonly unknown[]> {
    const initial = this.url(path);
    initial.searchParams.set('pagelen', '100');
    const values: unknown[] = [];
    let next: URL | null = initial;
    const visited = new Set<string>();
    let expected: number | null = null;
    while (next !== null) {
      if (visited.has(next.href) || visited.size >= MAX_PAGES) throw new ProviderCiError('Bitbucket pagination did not finish.');
      visited.add(next.href);
      const page = object((await this.request(next.href)).value);
      if (!Array.isArray(page.values)) throw new ProviderCiError('Bitbucket returned an invalid collection.');
      values.push(...page.values);
      if (values.length > MAX_RECORDS) throw new ProviderCiError('Bitbucket review exceeds the record limit.');
      if (page.size !== undefined) {
        if (typeof page.size !== 'number' || !Number.isSafeInteger(page.size) || page.size < 0) throw new ProviderCiError('Bitbucket returned an invalid collection size.');
        expected = page.size;
      }
      next = page.next === undefined || page.next === null ? null : this.url(text(page.next));
      if (next !== null && next.pathname !== initial.pathname) throw new ProviderCiError('Bitbucket pagination changed API resources.');
    }
    if (expected !== null && values.length !== expected) throw new ProviderCiError('Bitbucket returned an incomplete collection.');
    return values;
  }
}
