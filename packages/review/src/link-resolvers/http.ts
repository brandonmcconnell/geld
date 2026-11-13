import { BODY_CAP, type FailureReason, type FetchLike, type Resolution } from './types';

export type Json = Readonly<Record<string, unknown>>;

export function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

export function at(value: unknown, ...path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const next = record(current);
    if (next === null) return undefined;
    current = next[key];
  }
  return current;
}

export function text(value: unknown, ...path: readonly string[]): string | null {
  const found = at(value, ...path);
  return typeof found === 'string' && found.trim() !== '' ? found : null;
}

export function list(value: unknown, ...path: readonly string[]): readonly unknown[] {
  const found = at(value, ...path);
  return Array.isArray(found) ? found : [];
}

export function capBody(body: string | null): string | null {
  if (body === null) return null;
  const trimmed = body.replace(/\r\n/g, '\n').trim();
  if (trimmed === '') return null;
  return trimmed.length <= BODY_CAP ? trimmed : `${trimmed.slice(0, BODY_CAP - 1).trimEnd()}…`;
}

/** The first line of a message, cut to a title's length. */
export function titleLine(message: string, max = 120): string {
  const line = message.split('\n').map((part) => part.trim()).find((part) => part !== '') ?? '';
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63] ?? '';
    out += BASE64[(triple >> 12) & 63] ?? '';
    out += index + 1 < bytes.length ? (BASE64[(triple >> 6) & 63] ?? '') : '=';
    out += index + 2 < bytes.length ? (BASE64[triple & 63] ?? '') : '=';
  }
  return out;
}

export function basicAuth(user: string, secret: string): string {
  return `Basic ${base64(`${user}:${secret}`)}`;
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset !== null && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - Date.now());
  return null;
}

export function failed(reason: FailureReason, message: string | null = null, retry: number | null = null): Resolution {
  return { status: 'failed', reason, retryAfterMs: retry, message };
}

/**
 * What an answer other than 2xx means for a link. Most services answer 404 for something the account may not see, so
 * 404 is `no-access`; 401 is the connection itself failing.
 */
export function httpFailure(response: Response): Resolution {
  const { status } = response;
  if (status === 401) return failed('unauthorized', 'The service refused this connection’s key');
  if (status === 429) return failed('rate-limited', 'The service asked Geld to slow down', retryAfterMs(response));
  if (status === 403 && response.headers.get('x-ratelimit-remaining') === '0') return failed('rate-limited', 'The service asked Geld to slow down', retryAfterMs(response));
  if (status === 403 || status === 404 || status === 410) return { status: 'no-access' };
  if (status >= 500) return failed('unavailable', `The service answered ${status}`, retryAfterMs(response));
  return failed('invalid', `The service answered ${status}`);
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return null;
  }
}

/** Calls `fetch`, turning a network error into a failed resolution rather than a throw. */
export async function request(fetch: FetchLike, url: string, init: RequestInit): Promise<Response | Resolution> {
  try {
    return await fetch(url, init);
  } catch (error) {
    return failed('unavailable', error instanceof Error ? error.message : 'The request did not go through');
  }
}

export function isResponse(value: Response | Resolution): value is Response {
  return typeof value.status === 'number';
}

/** The identify failure's words for a status. */
export function identifyMessage(status: number, service: string): string {
  if (status === 401 || status === 403) return `${service} did not accept this key`;
  if (status === 404) return `${service} did not find that site`;
  if (status === 429) return `${service} asked Geld to slow down. Try again in a minute`;
  return `${service} answered ${status}`;
}

export function hostOf(value: string | null, fallback: string): string {
  if (value === null || value.trim() === '') return fallback;
  const trimmed = value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return trimmed.toLowerCase();
}
