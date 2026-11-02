import { repositoryKey } from '@geld/core';
import { providerFullSha, providerSourcePath } from './source-facts';
import type { ProviderNewFileRevision } from './source-facts';

export const WHOLE_SOURCE_FILE_BYTES = 512 * 1024;
export const WHOLE_SOURCE_TOTAL_BYTES = 4 * 1024 * 1024;
export const WHOLE_SOURCE_FILES = 16;
export const WHOLE_SOURCE_LINES = 10_000;
export interface ProviderWholeSourceLease {
  readonly revision: ProviderNewFileRevision;
  readonly subjectKey: string;
  readonly root: HTMLElement;
  current(): boolean;
}
export interface ProviderWholeSourceBody { readonly lines: readonly string[]; readonly bytes: number }
export interface ProviderWholeSourceValue extends ProviderWholeSourceBody { readonly token: number }
export type ProviderWholeSourceReader = (revision: ProviderNewFileRevision, signal: AbortSignal, current: () => boolean) => Promise<ProviderWholeSourceBody>;
interface Consumer { readonly lease: ProviderWholeSourceLease; readonly signal: AbortSignal; readonly resolve: (body: ProviderWholeSourceValue) => void; readonly reject: (error: unknown) => void; cleanup(): void }
interface Entry { readonly key: string; readonly origin: string; readonly revision: ProviderNewFileRevision; readonly abort: AbortController; readonly consumers: Set<Consumer>; state: 'pending' | 'ready' | 'failed'; body?: ProviderWholeSourceValue; error?: unknown; started: boolean; at: number }
const cancelled = (): DOMException => new DOMException('Source context cancelled', 'AbortError');
function current(lease: ProviderWholeSourceLease): boolean { try { return lease.current(); } catch { return false; } }

export class ProviderWholeSourceCache {
  private readonly entries = new Map<string, Entry>();
  private readonly activeOrigins = new Set<string>();
  private token = 0;
  private order = 0;
  private retainedBytes = 0;
  private reservedBytes = 0;
  private closed = false;
  constructor(private readonly read: ProviderWholeSourceReader, private readonly timeoutMs = 15_000) {}

  ready(key: string): ProviderWholeSourceValue | null {
    const entry = this.entries.get(key);
    if (entry?.state !== 'ready' || entry.body === undefined) return null;
    entry.at = this.order++;return entry.body;
  }

  load(lease: ProviderWholeSourceLease, signal: AbortSignal): Promise<ProviderWholeSourceValue> {
    if (!providerFullSha(lease.revision.headSha) || !providerSourcePath(lease.revision.path) || lease.revision.key !== JSON.stringify([repositoryKey(lease.revision.repository), lease.revision.headSha, lease.revision.path])) return Promise.reject(new Error('Invalid immutable source key'));
    if (this.closed || signal.aborted || !current(lease)) return Promise.reject(cancelled());
    let entry = this.entries.get(lease.revision.key);
    if (entry?.state === 'ready' && entry.body !== undefined) { entry.at = this.order++;return Promise.resolve(entry.body); }
    if (entry?.state === 'failed') return Promise.reject(entry.error);
    if (entry === undefined) {
      if (this.entries.size >= WHOLE_SOURCE_FILES && !this.evict()) return Promise.reject(new Error('Source context capacity reached'));
      entry = { key: lease.revision.key, origin: lease.revision.repository.origin, revision: lease.revision, abort: new AbortController(), consumers: new Set(), state: 'pending', started: false, at: this.order++ };
      this.entries.set(entry.key, entry);
    }
    const pending = entry;
    return new Promise<ProviderWholeSourceValue>((resolve, reject) => {
      const abort = (): void => { pending.consumers.delete(consumer);consumer.cleanup();reject(signal.reason ?? cancelled());if (pending.consumers.size === 0) { pending.abort.abort(cancelled());if (!pending.started) { pending.state = 'failed';pending.error = cancelled(); } }this.pump(); };
      const consumer: Consumer = { lease, signal, resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) };
      pending.consumers.add(consumer);signal.addEventListener('abort', abort, { once: true });this.pump();
    });
  }

  destroy(): void {
    this.closed = true;
    for (const entry of this.entries.values()) {
      entry.abort.abort(cancelled());
      for (const consumer of entry.consumers) { consumer.cleanup();consumer.reject(cancelled()); }
      entry.consumers.clear();
    }
    this.entries.clear();this.retainedBytes = 0;
  }

  private evict(): boolean {
    const victim = [...this.entries.values()].filter((entry) => entry.state !== 'pending').sort((a, b) => a.at - b.at)[0];
    if (victim === undefined) return false;
    this.retainedBytes -= victim.body?.bytes ?? 0;this.entries.delete(victim.key);return true;
  }

  private pump(): void {
    if (this.closed) return;
    for (const entry of this.entries.values()) {
      if (entry.state !== 'pending' || entry.started || this.activeOrigins.has(entry.origin)) continue;
      for (const consumer of [...entry.consumers]) if (consumer.signal.aborted || !current(consumer.lease)) { entry.consumers.delete(consumer);consumer.cleanup();consumer.reject(cancelled()); }
      if (entry.consumers.size === 0) { entry.state = 'failed';entry.error = cancelled();continue; }
      while (this.retainedBytes + this.reservedBytes + WHOLE_SOURCE_FILE_BYTES > WHOLE_SOURCE_TOTAL_BYTES) if (!this.evict()) return;
      entry.started = true;this.activeOrigins.add(entry.origin);this.reservedBytes += WHOLE_SOURCE_FILE_BYTES;
      const live = (): boolean => !entry.abort.signal.aborted && [...entry.consumers].some((consumer) => !consumer.signal.aborted && current(consumer.lease));
      const timeout = setTimeout(() => entry.abort.abort(new Error('Source context timed out')), this.timeoutMs);
      let stop: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => { stop = () => reject(entry.abort.signal.reason ?? cancelled());entry.abort.signal.addEventListener('abort', stop, { once: true }); });
      Promise.race([Promise.resolve().then(() => { if (!live()) throw cancelled();return this.read(entry.revision, entry.abort.signal, live); }), aborted])
        .then((body) => {
          entry.abort.signal.throwIfAborted();if (!live()) throw cancelled();
          const bytes = new TextEncoder().encode(body.lines.join('\n')).byteLength;
          if (!Number.isSafeInteger(body.bytes) || body.bytes < bytes || body.bytes > WHOLE_SOURCE_FILE_BYTES || body.lines.length > WHOLE_SOURCE_LINES || body.lines.some((line) => typeof line !== 'string')) throw new Error('Source context exceeds its bounds');
          const value: ProviderWholeSourceValue = Object.freeze({ lines: Object.freeze([...body.lines]), bytes: body.bytes, token: ++this.token });
          if (!this.closed) { entry.state = 'ready';entry.body = value;this.retainedBytes += value.bytes; }
          for (const consumer of entry.consumers) { consumer.cleanup();if (!consumer.signal.aborted && current(consumer.lease)) consumer.resolve(value);else consumer.reject(cancelled()); }
          entry.consumers.clear();
        })
        .catch((error: unknown) => {
          entry.state = 'failed';entry.error = error;
          for (const consumer of entry.consumers) { consumer.cleanup();consumer.reject(error); }
          entry.consumers.clear();
        })
        .finally(() => { clearTimeout(timeout);if (stop !== undefined) entry.abort.signal.removeEventListener('abort', stop);this.activeOrigins.delete(entry.origin);this.reservedBytes -= WHOLE_SOURCE_FILE_BYTES;this.pump(); });
    }
  }
}

export async function readProviderWholeSource(response: Response, signal: AbortSignal): Promise<ProviderWholeSourceBody> {
  if (!response.ok) { await response.body?.cancel().catch(() => undefined);throw Object.assign(new Error(`Source context HTTP ${response.status}`), { status: response.status, retryAfter: response.headers.get('retry-after') }); }
  const type = response.headers.get('content-type') ?? '';
  if (!/^(?:text\/(?!html\b)[^;]+|application\/octet-stream)(?:;|$)/i.test(type)) { await response.body?.cancel().catch(() => undefined);throw new Error('Source context is not plain text'); }
  const length = response.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > WHOLE_SOURCE_FILE_BYTES) { await response.body?.cancel().catch(() => undefined);throw new Error('Source context is too large'); }
  const reader = response.body?.getReader();let bytes = 0;let text = '';let done = false;
  const abort = (): void => { void reader?.cancel().catch(() => undefined); };signal.addEventListener('abort', abort, { once: true });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    if (reader === undefined) {
      const body = new Uint8Array(await response.arrayBuffer());bytes = body.byteLength;if (bytes > WHOLE_SOURCE_FILE_BYTES) throw new Error('Source context is too large');text = decoder.decode(body);
    } else {
      for (;;) {
        signal.throwIfAborted();const chunk = await reader.read();
        if (chunk.done) { done = true;break; }
        bytes += chunk.value.byteLength;if (bytes > WHOLE_SOURCE_FILE_BYTES) throw new Error('Source context is too large');
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    }
    signal.throwIfAborted();
    if (text.includes('\0') || /^\s*<(?:!doctype|html|head|body)\b/i.test(text)) throw new Error('Source context is binary or a page');
    const lines = text.split(/\r?\n/);if (lines.length > WHOLE_SOURCE_LINES) throw new Error('Source context has too many lines');
    return { lines, bytes };
  } finally { signal.removeEventListener('abort', abort);if (reader !== undefined && !done) await reader.cancel().catch(() => undefined); }
}
