import type { GeldSettings } from '@geld/core';
import { normalizeSettings } from '@geld/core';

/**
 * Settings live in a **secret Gist on the user's own GitHub account**. Nobody
 * else — not even Geld's author — can read or change it: there is no server,
 * and the token that can touch it stays on the user's device.
 */

const API = 'https://api.github.com';
export const GIST_FILE = 'geld-settings.json';
export const GIST_DESCRIPTION = 'Geld browser extension settings (managed by Geld; safe to delete)';

export interface RemoteSettings {
  readonly gistId: string;
  readonly settings: GeldSettings;
  /** Gist `updated_at` (ISO). */
  readonly updatedAt: string;
}

interface GistPayload {
  readonly geld: 1;
  readonly savedAt: string;
  readonly settings: GeldSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function headers(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function api(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(token), ...(init.headers ?? {}) } });
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  if (response.status === 204) return null;
  return response.json();
}

/** Thrown when the token has been revoked or expired. */
export class SignedOutError extends Error {
  constructor() {
    super('GitHub sign-in is no longer valid.');
    this.name = 'SignedOutError';
  }
}

function parsePayload(content: string): GeldSettings | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed) || !('settings' in parsed)) return null;
    return normalizeSettings(parsed.settings);
  } catch {
    return null;
  }
}

interface GistSummary {
  readonly id: string;
  readonly updatedAt: string;
  readonly hasFile: boolean;
}

function readGist(value: unknown): GistSummary | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const updatedAt = value.updated_at;
  const files = value.files;
  if (typeof id !== 'string' || typeof updatedAt !== 'string' || !isRecord(files)) return null;
  return { id, updatedAt, hasFile: GIST_FILE in files };
}

/** Find the Geld gist on the account (by file name), newest first. */
export async function findSettingsGist(token: string): Promise<GistSummary | null> {
  for (let page = 1; page <= 5; page += 1) {
    const list: unknown = await api(token, `/gists?per_page=100&page=${page}`);
    if (!Array.isArray(list) || list.length === 0) return null;
    const match = list.map(readGist).find((gist) => gist !== null && gist.hasFile);
    if (match !== undefined && match !== null) return match;
    if (list.length < 100) return null;
  }
  return null;
}

export async function readRemote(token: string, gistId: string): Promise<RemoteSettings | null> {
  const gist: unknown = await api(token, `/gists/${gistId}`);
  if (!isRecord(gist) || typeof gist.updated_at !== 'string') return null;
  const files = gist.files;
  if (!isRecord(files)) return null;
  const file = files[GIST_FILE];
  if (!isRecord(file)) return null;
  let content = typeof file.content === 'string' ? file.content : null;
  if ((content === null || file.truncated === true) && typeof file.raw_url === 'string') {
    const raw = await fetch(file.raw_url, { headers: { Authorization: `Bearer ${token}` } });
    content = raw.ok ? await raw.text() : null;
  }
  if (content === null) return null;
  const settings = parsePayload(content);
  return settings === null ? null : { gistId, settings, updatedAt: gist.updated_at };
}

export async function writeRemote(token: string, gistId: string | null, settings: GeldSettings): Promise<RemoteSettings> {
  const payload: GistPayload = { geld: 1, savedAt: new Date().toISOString(), settings };
  const body = JSON.stringify({
    description: GIST_DESCRIPTION,
    public: false,
    files: { [GIST_FILE]: { content: `${JSON.stringify(payload, null, 2)}\n` } },
  });
  const gist: unknown =
    gistId === null ? await api(token, '/gists', { method: 'POST', body }) : await api(token, `/gists/${gistId}`, { method: 'PATCH', body });
  const summary = readGist(gist);
  if (summary === null) throw new Error('GitHub did not return the saved gist.');
  return { gistId: summary.id, settings, updatedAt: summary.updatedAt };
}

/** Structural comparison; key order in stored JSON is irrelevant. */
export function settingsEqual(a: GeldSettings, b: GeldSettings): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
