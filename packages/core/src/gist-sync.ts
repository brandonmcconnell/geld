import type { GeldSettings } from './settings';
import { normalizeSettings } from './settings';

/**
 * Settings live in a **secret Gist on the user's own GitHub account**. Nobody
 * else — not even Geld's author — can read or change it: there is no Geld
 * server holding data, and any token that can touch the gist is either on the
 * user's device (extension) or in their own browser session (geld.sh).
 *
 * Both the extension and the website use this module, so the file name, the
 * payload shape and the equality rule are defined exactly once.
 */

const API = 'https://api.github.com';
export const GIST_FILE = 'geld-settings.json';
export const GIST_DESCRIPTION = 'Geld browser extension settings (managed by Geld; safe to delete)';
/** OAuth scope needed to read and write the gist. */
export const OAUTH_SCOPE = 'gist';

export interface RemoteSettings {
  readonly gistId: string;
  readonly settings: GeldSettings;
  /** Gist `updated_at` (ISO). */
  readonly updatedAt: string;
}

/** The JSON document stored in the gist (and produced by "Export settings"). */
export interface SettingsPayload {
  readonly geld: 1;
  readonly savedAt: string;
  readonly settings: GeldSettings;
}

/** Public profile of the signed-in GitHub user. */
export interface GitHubProfile {
  readonly login: string;
  readonly id: number;
  readonly avatarUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function serializeSettingsPayload(settings: GeldSettings, now: Date = new Date()): string {
  const payload: SettingsPayload = { geld: 1, savedAt: now.toISOString(), settings };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Accepts the wrapped payload or a bare settings object; `null` when unreadable. */
export function parseSettingsPayload(content: string): GeldSettings | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) return null;
    return normalizeSettings('settings' in parsed ? parsed.settings : parsed);
  } catch {
    return null;
  }
}

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

/** Thrown when the token has been revoked or expired. */
export class SignedOutError extends Error {
  constructor() {
    super('GitHub sign-in is no longer valid.');
    this.name = 'SignedOutError';
  }
}

async function api(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(token), ...(init.headers ?? {}) } });
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  if (response.status === 204) return null;
  return response.json();
}

export async function fetchGitHubProfile(token: string): Promise<GitHubProfile> {
  const body = await api(token, '/user');
  if (!isRecord(body)) throw new Error('Unexpected profile response.');
  const login = body.login;
  const id = body.id;
  const avatarUrl = body.avatar_url;
  if (typeof login !== 'string' || typeof id !== 'number' || typeof avatarUrl !== 'string') {
    throw new Error('Incomplete profile response.');
  }
  return { login, id, avatarUrl };
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
  const settings = parseSettingsPayload(content);
  return settings === null ? null : { gistId, settings, updatedAt: gist.updated_at };
}

export async function writeRemote(token: string, gistId: string | null, settings: GeldSettings): Promise<RemoteSettings> {
  const body = JSON.stringify({
    description: GIST_DESCRIPTION,
    public: false,
    files: { [GIST_FILE]: { content: serializeSettingsPayload(settings) } },
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
