import { storage } from 'wxt/utils/storage';
import { describeRepository, isChangeKindId, repositoryKey } from '@geld/core';
import type { FileStats } from '@geld/core';
import { immutableProviderPage, isProviderReviewPage } from './types';
import type { ProviderDiffResult, ProviderPage } from './types';

export const PROVIDER_CACHE_SLOTS = 64;
export const PROVIDER_CACHE_MAX_BYTES = 64 * 1024;
export const PROVIDER_CACHE_EXACT_MS = 7 * 24 * 60 * 60_000;
export const PROVIDER_CACHE_LATEST_MS = 24 * 60 * 60_000;
export const PROVIDER_CACHE_FRESH_MS = 30 * 60_000;

export interface ProviderCacheStorage {
  read(slot: number): Promise<unknown>;
  write(slot: number, value: unknown): Promise<void>;
  watch(slot: number, changed: (value: unknown) => void): () => void;
}

interface CachedDiff {
  readonly schema: 1;
  readonly key: string;
  readonly storedAt: number;
  readonly revision: string;
  readonly files: readonly FileStats[];
}

interface Slot {
  entry: CachedDiff | null;
  loaded: Promise<void> | null;
  changed: number;
  unwatch: (() => void) | null;
}

export interface ProviderCacheHit {
  readonly result: ProviderDiffResult;
  readonly storedAt: number;
  readonly exact: boolean;
  readonly fresh: boolean;
}

function storageKey(slot: number): `local:${string}` { return `local:providerDiffCache:${slot}`; }

const browserStorage: ProviderCacheStorage = {
  read: (slot) => storage.getItem<unknown>(storageKey(slot)),
  write: (slot, value) => storage.setItem(storageKey(slot), value),
  watch: (slot, changed) => storage.watch<unknown>(storageKey(slot), changed),
};

let writes: Promise<void> = Promise.resolve();

export async function clearProviderDiffCache(): Promise<void> {
  await storage.removeItems(Array.from({ length: PROVIDER_CACHE_SLOTS }, (_, slot) => storageKey(slot)));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !array(value);
}

function array(value: unknown): value is readonly unknown[] { return Array.isArray(value); }

function validHead(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40,64}$/i.test(value);
}

function canonicalSubject(page: ProviderPage): string {
  const url = new URL(page.url);
  const repository = describeRepository(url, page.provider);
  let path: string;
  if (isProviderReviewPage(page)) {
    path = page.provider === 'gitlab' ? `/${page.repository.path}/-/merge_requests/${page.number}` : `/${page.repository.path}/pull-requests/${page.number}`;
    if (!/^[1-9]\d*$/.test(page.number)) throw new Error('Invalid provider review identity');
  } else {
    if (page.provider === 'bitbucket') {
      if (page.kind !== 'commit' || !/^(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/i.test(page.ref)) throw new Error('Unsupported standalone diff identity');
      path = `/${page.repository.path}/commits/${encodeURIComponent(page.ref)}`;
    } else path = page.kind === 'commit' ? `/${page.repository.path}/-/commit/${encodeURIComponent(page.ref)}` : `/${page.repository.path}/-/compare/${encodeURIComponent(page.from)}...${encodeURIComponent(page.to)}`;
  }
  if (repository === null || repositoryKey(repository) !== repositoryKey(page.repository) || url.pathname.replace(/\/$/, '') !== path) throw new Error('Invalid provider diff identity');
  return `${url.origin}${path}`;
}

export function providerDiffKey(page: ProviderPage): string {
  return JSON.stringify([repositoryKey(page.repository), canonicalSubject(page), page.version, page.headSha?.toLowerCase() ?? null]);
}

export function providerCacheSlot(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) % PROVIDER_CACHE_SLOTS;
}

function keyHead(key: string): string | null | false {
  try {
    const parts: unknown = JSON.parse(key);
    if (!array(parts) || parts.length !== 4 || typeof parts[0] !== 'string' || typeof parts[1] !== 'string' || typeof parts[2] !== 'string' || parts[2].length > 2048 || (parts[3] !== null && !validHead(parts[3]))) return false;
    const identity: unknown = JSON.parse(parts[0]);
    if (!array(identity) || identity.length !== 3 || (identity[0] !== 'gitlab' && identity[0] !== 'bitbucket') || typeof identity[1] !== 'string' || typeof identity[2] !== 'string') return false;
    const url = new URL(parts[1]);
    const provider = identity[0];
    const repository = describeRepository(url, provider);
    if (repository === null || repositoryKey(repository) !== parts[0]) return false;
    const path = provider === 'gitlab' ? `/${repository.path}/-/merge_requests/` : `/${repository.path}/pull-requests/`;
    const review = url.pathname.startsWith(path) && /^[1-9]\d*$/.test(url.pathname.slice(path.length));
    const commitPrefix = provider === 'gitlab' ? `/${repository.path}/-/commit/` : `/${repository.path}/commits/`;
    const comparePrefix = `/${repository.path}/-/compare/`;
    const standalone = (url.pathname.startsWith(commitPrefix) && /^(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/i.test(url.pathname.slice(commitPrefix.length))) || (provider === 'gitlab' && url.pathname.startsWith(comparePrefix) && /^.+\.\.\..+$/.test(url.pathname.slice(comparePrefix.length)));
    if ((!review && !standalone) || `${url.origin}${url.pathname}` !== parts[1]) return false;
    return parts[3];
  } catch { return false; }
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positions(value: unknown): readonly number[] | null {
  if (!array(value) || value.length > 2000) return null;
  const result: number[] = [];
  for (const item of value) {
    const line: unknown = item;
    if (!nonnegative(line) || line === 0) return null;
    result.push(line);
  }
  return new Set(result).size === result.length ? result : null;
}

function fileStats(value: unknown): readonly FileStats[] | null {
  if (!array(value) || value.length > 6000) return null;
  const files: FileStats[] = [];
  for (const item of value) {
    const file: unknown = item;
    if (!record(file) || typeof file.path !== 'string' || file.path.length === 0 || file.path.length > 4096 || /[\u0000-\u001f]/.test(file.path) || !nonnegative(file.additions) || !nonnegative(file.deletions)) return null;
    const status = file.status;
    if (status !== undefined && status !== 'added' && status !== 'deleted' && status !== 'renamed' && status !== 'modified') return null;
    const kinds: NonNullable<FileStats['kinds']>[number][] = [];
    if (file.kinds !== undefined) {
      if (!array(file.kinds) || file.kinds.length > 7) return null;
      for (const candidate of file.kinds) {
        const kind: unknown = candidate;
        if (!isChangeKindId(kind)) return null;
        if (!kinds.includes(kind)) kinds.push(kind);
      }
    }
    let commentLines: FileStats['commentLines'];
    if (file.commentLines !== undefined) {
      if (!record(file.commentLines)) return null;
      const added = positions(file.commentLines.added);
      const removed = positions(file.commentLines.removed);
      if (added === null || removed === null || added.length > file.additions || removed.length > file.deletions) return null;
      commentLines = { added, removed };
    }
    files.push({ path: file.path, additions: file.additions, deletions: file.deletions, ...(status === undefined ? {} : { status }), ...(kinds.length === 0 ? {} : { kinds }), ...(commentLines === undefined ? {} : { commentLines }) });
  }
  return new Set(files.map((file) => file.path)).size === files.length ? files : null;
}

function parse(value: unknown, slot: number): CachedDiff | null {
  if (!record(value) || value.schema !== 1 || typeof value.key !== 'string' || value.key.length > 8192 || providerCacheSlot(value.key) !== slot || !nonnegative(value.storedAt) || value.storedAt > Date.now() + 60_000 || typeof value.revision !== 'string' || value.revision.length === 0 || value.revision.length > 2048) return null;
  const head = keyHead(value.key);
  if (head === false || (head !== null && !value.revision.toLowerCase().includes(head.toLowerCase()))) return null;
  const files = fileStats(value.files);
  if (files === null) return null;
  const result: CachedDiff = { schema: 1, key: value.key, storedAt: value.storedAt, revision: value.revision, files };
  return new TextEncoder().encode(JSON.stringify(result)).byteLength <= PROVIDER_CACHE_MAX_BYTES ? result : null;
}

export class ProviderDiffCache {
  private readonly slots = new Map<number, Slot>();
  private stopped = false;

  constructor(private readonly backend: ProviderCacheStorage = browserStorage, private readonly changed: () => void = () => undefined) {}

  get(page: ProviderPage, header = false): ProviderCacheHit | null {
    let key: string;
    try { key = providerDiffKey(page); } catch { return null; }
    const entry = this.slots.get(providerCacheSlot(key))?.entry;
    if (entry === undefined || entry === null || entry.key !== key) return null;
    const exact = immutableProviderPage(page) && validHead(page.headSha) && entry.revision.toLowerCase().includes(page.headSha.toLowerCase());
    if (header && !exact) return null;
    const age = Date.now() - entry.storedAt;
    if (age < 0 || age > (exact ? PROVIDER_CACHE_EXACT_MS : PROVIDER_CACHE_LATEST_MS)) return null;
    return { result: { files: entry.files, revision: entry.revision, complete: true }, storedAt: entry.storedAt, exact, fresh: exact || age <= PROVIDER_CACHE_FRESH_MS };
  }

  async load(page: ProviderPage): Promise<void> {
    if (this.stopped) return;
    let key: string;
    try { key = providerDiffKey(page); } catch { return; }
    const id = providerCacheSlot(key);
    let slot = this.slots.get(id);
    if (slot === undefined) {
      slot = { entry: null, loaded: null, changed: 0, unwatch: null };
      this.slots.set(id, slot);
    }
    const current = slot;
    if (current.loaded === null) {
      const before = current.changed;
      try {
        current.unwatch = this.backend.watch(id, (value) => {
          if (this.stopped) return;
          current.changed += 1;
          current.entry = parse(value, id);
          this.changed();
        });
      } catch { /* A retired extension has no storage API. */ }
      current.loaded = this.backend.read(id).then((value) => {
        if (!this.stopped && current.changed === before) current.entry = parse(value, id);
      }).catch(() => undefined);
    }
    await current.loaded;
  }

  set(page: ProviderPage, result: ProviderDiffResult): void {
    if (this.stopped || !result.complete) return;
    let key: string;
    try { key = providerDiffKey(page); } catch { return; }
    const id = providerCacheSlot(key);
    const entry = parse({ schema: 1, key, storedAt: Date.now(), revision: result.revision, files: result.files }, id);
    if (entry === null) return;
    void this.load(page).catch(() => undefined);
    const current = this.slots.get(id);
    if (current !== undefined) { current.entry = entry; current.changed += 1; }
    writes = writes.then(async () => {
      if (this.stopped) return;
      const previous = parse(await this.backend.read(id), id);
      if (previous !== null && previous.key === entry.key && previous.storedAt > entry.storedAt) return;
      // Fixed slots make a hash collision an eviction, never a merge that loses another slot's entry.
      await this.backend.write(id, entry);
    }).catch(() => undefined);
  }

  async clear(): Promise<void> {
    await writes;
    if (this.stopped) return;
    for (const slot of this.slots.values()) { slot.entry = null; slot.changed += 1; }
    await Promise.all(Array.from({ length: PROVIDER_CACHE_SLOTS }, (_, slot) => this.backend.write(slot, null)));
    if (!this.stopped) this.changed();
  }

  stop(): void {
    this.stopped = true;
    for (const slot of this.slots.values()) {
      try { slot.unwatch?.(); } catch { /* The extension context can already be gone. */ }
    }
    this.slots.clear();
  }
}
