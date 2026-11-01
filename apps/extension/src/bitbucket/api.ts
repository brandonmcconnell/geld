import type { FileStats } from '@geld/core';
import { parseUnifiedDiff } from '@geld/core';
import { looksLikeHtml } from '../lib/http';
import type { ProviderDiffResult, ProviderReviewPage } from '../providers/types';

const API_ORIGIN = 'https://api.bitbucket.org';
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_DIFF_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 100;

export type BitbucketFailure = 'authentication' | 'forbidden' | 'rate-limited' | 'unavailable' | 'invalid-response' | 'incomplete' | 'changed';

export class BitbucketApiError extends Error {
  constructor(readonly reason: BitbucketFailure, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'BitbucketApiError';
  }
}

export interface BitbucketAuthor {
  readonly id: string;
  readonly login: string;
  readonly name: string;
}

export interface BitbucketParticipant {
  readonly author: BitbucketAuthor;
  readonly role: string;
  readonly approved: boolean;
  readonly changesRequested: boolean;
}

export interface BitbucketPullRequest {
  readonly id: number;
  readonly title: string;
  readonly state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  readonly headSha: string;
  readonly baseSha: string;
  readonly author: BitbucketAuthor | null;
  readonly participants: readonly BitbucketParticipant[];
}

export interface BitbucketComment {
  readonly id: number;
  readonly parentId: number | null;
  readonly author: BitbucketAuthor | null;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deleted: boolean;
  readonly path: string | null;
  readonly line: number | null;
  readonly resolved: boolean | null;
  readonly outdated: boolean | null;
  readonly url: string | null;
}

export interface BitbucketTask {
  readonly id: number;
  readonly body: string;
  readonly state: 'OPEN' | 'RESOLVED';
  readonly commentId: number | null;
  readonly creator: BitbucketAuthor | null;
  readonly createdAt: string | null;
  readonly url: string | null;
}

export interface BitbucketStatus {
  readonly key: string;
  readonly name: string;
  readonly state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'STOPPED';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url: string | null;
  readonly sha: string | null;
}

export interface BitbucketActivity {
  readonly kind: 'approval' | 'changes-requested' | 'comment' | 'update' | 'unknown';
  readonly at: string | null;
  readonly author: BitbucketAuthor | null;
  readonly commentId: number | null;
  readonly state: string | null;
  readonly previousState: string | null;
  readonly headSha: string | null;
  readonly reason: string | null;
}

export interface BitbucketCapabilities {
  readonly approve: 'unavailable' | 'unverified';
  readonly requestChanges: 'unavailable' | 'unverified';
  readonly comment: 'unavailable' | 'unverified';
  readonly resolve: 'unavailable' | 'unverified';
}

export function bitbucketCapabilities(signedIn: boolean): BitbucketCapabilities {
  const state = signedIn ? 'unverified' : 'unavailable';
  return { approve: state, requestChanges: state, comment: state, resolve: state };
}

function invalid(message: string): never {
  throw new BitbucketApiError('invalid-response', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : invalid('Bitbucket returned an invalid object.');
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : invalid('Bitbucket returned an invalid string.');
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid('Bitbucket returned an invalid count.');
}

function nullableId(value: unknown): number | null {
  return value === undefined || value === null ? null : integer(record(value).id);
}

function timestamp(value: unknown): string {
  const text = string(value);
  return Number.isFinite(Date.parse(text)) ? text : invalid('Bitbucket returned an invalid timestamp.');
}

function commit(value: unknown): string {
  const sha = string(record(record(value).commit).hash);
  return /^[a-f0-9]{40,64}$/i.test(sha) ? sha : invalid('Bitbucket returned an invalid commit.');
}

function author(value: unknown): BitbucketAuthor | null {
  if (value === undefined || value === null) return null;
  const user = record(value);
  const id = typeof user.uuid === 'string' && user.uuid !== '' ? user.uuid : typeof user.account_id === 'string' && user.account_id !== '' ? user.account_id : invalid('Bitbucket returned an author without an identity.');
  const name = string(user.display_name);
  return { id, login: typeof user.nickname === 'string' && user.nickname !== '' ? user.nickname : id, name };
}

function content(value: unknown, optional = false): string {
  if (value === undefined || value === null) return optional ? '' : invalid('Bitbucket omitted comment content.');
  const raw = record(value).raw;
  return raw === undefined && optional ? '' : string(raw);
}

function webUrl(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const url = new URL(string(value));
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : null;
  } catch {
    return null;
  }
}

function link(value: unknown, name: string): string | null {
  if (!isRecord(value) || !isRecord(value[name])) return null;
  return webUrl(value[name].href);
}

function optionalCommit(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.commit) || typeof value.commit.hash !== 'string') return null;
  return /^[a-f0-9]{40,64}$/i.test(value.commit.hash) ? value.commit.hash : null;
}

function parsePullRequest(value: unknown): BitbucketPullRequest {
  const pr = record(value);
  const state = pr.state;
  if (state !== 'OPEN' && state !== 'MERGED' && state !== 'DECLINED' && state !== 'SUPERSEDED') return invalid('Bitbucket returned an invalid pull request state.');
  if (!Array.isArray(pr.participants)) return invalid('Bitbucket omitted review participants.');
  const participants = pr.participants.map((value: unknown): BitbucketParticipant => {
    const entry = record(value);
    const user = author(entry.user);
    if (user === null || typeof entry.approved !== 'boolean') return invalid('Bitbucket returned an invalid participant.');
    return { author: user, role: string(entry.role), approved: entry.approved, changesRequested: entry.state === 'changes_requested' };
  });
  return { id: integer(pr.id), title: string(pr.title), state, headSha: commit(pr.source), baseSha: commit(pr.destination), author: author(pr.author), participants };
}

function parseDiffstat(value: unknown): FileStats {
  const file = record(value);
  const status = file.status;
  const oldFile = file.old === null || file.old === undefined ? null : record(file.old);
  const newFile = file.new === null || file.new === undefined ? null : record(file.new);
  const path = string(newFile?.path ?? oldFile?.path);
  if (path === '' || path.includes('\0')) return invalid('Bitbucket returned an invalid file path.');
  if (status !== 'added' && status !== 'removed' && status !== 'renamed' && status !== 'modified') return invalid('Bitbucket returned an unknown file status.');
  return { path, additions: integer(file.lines_added), deletions: integer(file.lines_removed), status: status === 'removed' ? 'deleted' : status };
}

function parseComment(value: unknown): BitbucketComment {
  const comment = record(value);
  if (typeof comment.deleted !== 'boolean') return invalid('Bitbucket omitted comment visibility.');
  const inline = comment.inline === null || comment.inline === undefined ? null : record(comment.inline);
  const line = inline?.to ?? inline?.from;
  const resolution = comment.resolution === null || comment.resolution === undefined ? null : record(comment.resolution);
  const resolved = typeof comment.resolved === 'boolean' ? comment.resolved : resolution !== null ? true : comment.resolution === null ? false : null;
  return {
    id: integer(comment.id), parentId: nullableId(comment.parent), author: author(comment.user),
    body: content(comment.content, comment.deleted), createdAt: timestamp(comment.created_on), updatedAt: timestamp(comment.updated_on),
    deleted: comment.deleted, path: inline === null ? null : string(inline.path),
    line: line === undefined || line === null ? null : integer(line), resolved,
    outdated: typeof inline?.outdated === 'boolean' ? inline.outdated : typeof comment.outdated === 'boolean' ? comment.outdated : null,
    url: link(comment.links, 'html'),
  };
}

function parseTask(value: unknown): BitbucketTask {
  const task = record(value);
  const state = task.state;
  if (state !== 'OPEN' && state !== 'RESOLVED') return invalid('Bitbucket returned an invalid task state.');
  return { id: integer(task.id), body: content(task.content), state, commentId: nullableId(task.comment), creator: author(task.creator), createdAt: task.created_on === undefined ? null : timestamp(task.created_on), url: link(task.links, 'html') };
}

function parseStatus(value: unknown, repositoryPath: string): BitbucketStatus {
  const status = record(value);
  const state = status.state;
  if (state !== 'SUCCESSFUL' && state !== 'FAILED' && state !== 'INPROGRESS' && state !== 'STOPPED') return invalid('Bitbucket returned an invalid build state.');
  const self = link(status.links, 'self');
  const selfUrl = self === null ? null : new URL(self);
  const selfSha = selfUrl?.origin === API_ORIGIN && selfUrl.pathname.startsWith(`${repositoryPath}/commit/`) ? /\/commit\/([a-f0-9]{40,64})\/statuses(?:\/|$)/i.exec(selfUrl.pathname)?.[1] ?? null : null;
  const sha = optionalCommit(status) ?? selfSha;
  return { key: string(status.key), name: string(status.name), state, createdAt: timestamp(status.created_on), updatedAt: timestamp(status.updated_on), url: webUrl(status.url), sha };
}

function parseActivity(value: unknown): BitbucketActivity {
  const activity = record(value);
  for (const [key, kind] of [['approval', 'approval'], ['changes_requested', 'changes-requested'], ['comment', 'comment'], ['update', 'update']] as const) {
    if (activity[key] === undefined) continue;
    const entry = record(activity[key]);
    const date = entry.date ?? entry.created_on ?? entry.updated_on;
    const changes = isRecord(entry.changes) && isRecord(entry.changes.state) ? entry.changes.state : null;
    const sourceChange = isRecord(entry.changes) && isRecord(entry.changes.source) ? entry.changes.source : null;
    const changedHead = sourceChange === null ? null : optionalCommit(sourceChange.new);
    const previousHead = sourceChange === null ? null : optionalCommit(sourceChange.old);
    return {
      kind, at: date === undefined ? null : timestamp(date), author: author(entry.user ?? entry.author), commentId: kind === 'comment' ? integer(entry.id) : null,
      state: typeof changes?.new === 'string' ? changes.new : typeof entry.state === 'string' ? entry.state : null,
      previousState: typeof changes?.old === 'string' ? changes.old : null,
      headSha: changedHead !== null && previousHead !== null && changedHead !== previousHead ? changedHead : null,
      reason: typeof entry.reason === 'string' ? entry.reason : null,
    };
  }
  return { kind: 'unknown', at: null, author: null, commentId: null, state: null, previousState: null, headSha: null, reason: null };
}

async function boundedText(response: Response, limit: number): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) throw new BitbucketApiError('incomplete', 'Bitbucket response exceeds the size limit.');
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new BitbucketApiError('incomplete', 'Bitbucket response exceeds the size limit.');
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export class BitbucketClient {
  private readonly repositoryPath: string;
  private readonly pullPath: string;

  constructor(readonly page: ProviderReviewPage, private readonly fetcher: typeof fetch = fetch) {
    if (page.provider !== 'bitbucket' || page.repository.provider !== 'bitbucket' || page.repository.origin !== 'https://bitbucket.org' || !/^[1-9]\d*$/.test(page.number)) throw new BitbucketApiError('invalid-response', 'Invalid Bitbucket review identity.');
    const parts = page.repository.path.split('/');
    if (parts.length !== 2 || parts.some((part) => part === '' || part === '.' || part === '..' || /[\0/\\?#]/.test(part))) throw new BitbucketApiError('invalid-response', 'Invalid Bitbucket repository identity.');
    this.repositoryPath = `/2.0/repositories/${parts.map(encodeURIComponent).join('/')}`;
    this.pullPath = `${this.repositoryPath}/pullrequests/${page.number}`;
  }

  private trustedUrl(value: string, initial: URL, allowDiffRedirect = false): URL {
    const url = new URL(value, initial);
    const samePath = url.pathname === initial.pathname;
    const diffPath = allowDiffRedirect && url.pathname.startsWith(`${this.repositoryPath}/diff/`);
    if (url.origin !== API_ORIGIN || url.username !== '' || url.password !== '' || url.hash !== '' || (!samePath && !diffPath)) throw new BitbucketApiError('invalid-response', 'Bitbucket returned an untrusted resource URL.');
    return url;
  }

  private async response(url: URL, signal: AbortSignal, raw = false): Promise<Response> {
    let current = url;
    const visited = new Set<string>();
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      if (visited.has(current.href)) throw new BitbucketApiError('invalid-response', 'Bitbucket returned a redirect loop.');
      visited.add(current.href);
      const response = await this.fetcher(current.href, { signal, credentials: 'omit', redirect: 'manual', headers: { Accept: raw ? 'text/plain' : 'application/json' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null) throw new BitbucketApiError('invalid-response', 'Bitbucket returned a redirect without a destination.');
        current = this.trustedUrl(location, url, raw);
        continue;
      }
      if (response.url !== '') this.trustedUrl(response.url, url, raw);
      if (response.status === 401) throw new BitbucketApiError('authentication', 'Sign in to Bitbucket to read this review.');
      if (response.status === 403) throw new BitbucketApiError('forbidden', 'Bitbucket did not allow this review source.');
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = retry === null ? NaN : Number(retry);
        const after = retry === null ? NaN : Date.parse(retry) - Date.now();
        const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.isFinite(after) ? Math.max(0, after) : 60_000;
        throw new BitbucketApiError('rate-limited', 'Bitbucket is limiting review requests.', delay);
      }
      if (!response.ok) throw new BitbucketApiError('unavailable', `Bitbucket review source returned ${response.status}.`);
      return response;
    }
    throw new BitbucketApiError('invalid-response', 'Bitbucket returned too many redirects.');
  }

  private async json(url: URL, signal: AbortSignal): Promise<unknown> {
    const response = await this.response(url, signal);
    const type = response.headers.get('content-type');
    const text = await boundedText(response, MAX_JSON_BYTES);
    if (looksLikeHtml(type, text) || type === null || !/^application\/(?:[\w.+-]*\+)?json\b/i.test(type)) throw new BitbucketApiError('invalid-response', 'Bitbucket did not return review data.');
    try {
      const value: unknown = JSON.parse(text);
      return value;
    } catch {
      return invalid('Bitbucket returned invalid JSON.');
    }
  }

  private async collection<T>(resource: string, parse: (value: unknown) => T, signal: AbortSignal): Promise<readonly T[]> {
    const initial = new URL(`${API_ORIGIN}${this.pullPath}/${resource}?pagelen=100`);
    let current: URL | null = initial;
    const visited = new Set<string>();
    const items: T[] = [];
    let expected: number | null = null;
    while (current !== null) {
      if (visited.has(current.href) || visited.size >= MAX_PAGES) throw new BitbucketApiError('incomplete', 'Bitbucket review pagination did not finish.');
      visited.add(current.href);
      const page = record(await this.json(current, signal));
      if (!Array.isArray(page.values)) return invalid('Bitbucket omitted collection values.');
      items.push(...page.values.map((value: unknown) => parse(value)));
      if (page.size !== undefined) expected = integer(page.size);
      current = page.next === undefined || page.next === null ? null : this.trustedUrl(string(page.next), initial);
    }
    if (expected !== null && items.length !== expected) throw new BitbucketApiError('incomplete', 'Bitbucket returned an incomplete review collection.');
    return items;
  }

  async pullRequest(signal: AbortSignal): Promise<BitbucketPullRequest> {
    const pr = parsePullRequest(await this.json(new URL(`${API_ORIGIN}${this.pullPath}`), signal));
    if (String(pr.id) !== this.page.number) return invalid('Bitbucket returned a different pull request.');
    return pr;
  }

  comments(signal: AbortSignal): Promise<readonly BitbucketComment[]> {
    return this.collection('comments', parseComment, signal);
  }

  tasks(signal: AbortSignal): Promise<readonly BitbucketTask[]> {
    return this.collection('tasks', parseTask, signal);
  }

  activity(signal: AbortSignal): Promise<readonly BitbucketActivity[]> {
    return this.collection('activity', parseActivity, signal);
  }

  statuses(signal: AbortSignal): Promise<readonly BitbucketStatus[]> {
    return this.collection('statuses', (value) => parseStatus(value, this.repositoryPath), signal);
  }

  async diff(signal: AbortSignal): Promise<ProviderDiffResult> {
    const before = await this.pullRequest(signal);
    const [stats, response] = await Promise.all([
      this.collection('diffstat', parseDiffstat, signal),
      this.response(new URL(`${API_ORIGIN}${this.pullPath}/diff`), signal, true),
    ]);
    const patch = await boundedText(response, MAX_DIFF_BYTES);
    if (looksLikeHtml(response.headers.get('content-type'), patch)) throw new BitbucketApiError('invalid-response', 'Bitbucket did not return a unified diff.');
    if (patch.trim() !== '' && !/^diff --git /m.test(patch)) throw new BitbucketApiError('invalid-response', 'Bitbucket returned an invalid unified diff.');
    const parsed = parseUnifiedDiff(patch);
    const facts = new Map(parsed.map((file) => [file.path, file]));
    const paths = new Set(stats.map((file) => file.path));
    if (paths.size !== stats.length) throw new BitbucketApiError('invalid-response', 'Bitbucket returned duplicate diff paths.');
    const complete = parsed.length === stats.length && stats.every((file) => {
      const fact = facts.get(file.path);
      return fact !== undefined && fact.additions === file.additions && fact.deletions === file.deletions;
    });
    const after = await this.pullRequest(signal);
    if (before.headSha !== after.headSha || before.baseSha !== after.baseSha) throw new BitbucketApiError('changed', 'Bitbucket changed the review while its diff was loading.');
    if (this.page.headSha !== null && this.page.headSha !== before.headSha) throw new BitbucketApiError('changed', 'Bitbucket review head changed.');
    const files = stats.map((file): FileStats => {
      const fact = facts.get(file.path);
      return fact !== undefined && fact.additions === file.additions && fact.deletions === file.deletions ? { ...fact, status: file.status ?? 'modified' } : file;
    });
    const patches = new Map<string, string>();
    for (const part of patch.split(/(?=^diff --git )/m)) {
      const file = parseUnifiedDiff(part)[0];
      if (file !== undefined && paths.has(file.path)) patches.set(file.path, part);
    }
    return { files, revision: `${before.baseSha}..${before.headSha}`, complete, patches };
  }
}
