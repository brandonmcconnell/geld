import { ProviderDiffCache, providerDiffKey } from './diff-cache';
import { immutableProviderPage } from './types';
import type { ProviderAdapter, ProviderDiffResult, ProviderPage } from './types';
export { providerDiffKey } from './diff-cache';

export type ProviderDiffState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly result: ProviderDiffResult; readonly cached?: true; readonly provisional?: true; readonly refreshing?: true; readonly refreshError?: string }
  | { readonly status: 'failed'; readonly reason: string };

interface Request {
  readonly key: string;
  readonly page: ProviderPage;
  state: ProviderDiffState;
  at: number;
  retryAt: number;
  attempts: number;
  abort: AbortController | null;
  queued: boolean;
  hydrated: boolean;
  hydrating: boolean;
  priority: boolean;
  visit: number;
  demandedAt: number;
}

interface Lane { nextStart: number; cooldownUntil: number }

const TTL_MS = 60_000;
const LIMIT = 200;
const RETRIES = [4000, 15_000, 45_000];

function knownHead(page: ProviderPage): boolean { return immutableProviderPage(page); }
function laneKey(page: ProviderPage): string { return `${page.provider}:${page.repository.origin}`; }

export function providerRetryAfter(error: unknown, now = Date.now()): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const milliseconds: unknown = Reflect.get(error, 'retryAfterMs');
  if (typeof milliseconds === 'number' && Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  const header: unknown = Reflect.get(error, 'retryAfter');
  if (typeof header !== 'string') return null;
  if (/^\d+(?:\.\d+)?$/.test(header.trim())) {
    const delay = Number(header) * 1000;
    return Number.isFinite(delay) ? delay : null;
  }
  const until = Date.parse(header);
  return Number.isFinite(until) ? Math.max(0, until - now) : null;
}

export class ProviderDiffSource {
  private readonly requests = new Map<string, Request>();
  private readonly queue: Request[] = [];
  private readonly lanes = new Map<string, Lane>();
  private readonly cache: ProviderDiffCache;
  private running = 0;
  private active = true;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private visit = 0;
  private visitKey: string | null = null;
  private clearing = false;

  constructor(private readonly adapter: ProviderAdapter, private readonly changed: () => void, cache?: ProviderDiffCache) {
    this.cache = cache ?? new ProviderDiffCache(undefined, () => { if (!this.stopped && this.active) this.changed(); });
  }

  beginVisit(key: string): void {
    if (this.stopped || key === this.visitKey) return;
    this.visitKey = key;
    this.visit += 1;
    this.cancelTimer();
    this.queue.length = 0;
    for (const [id, request] of this.requests) {
      request.abort?.abort();
      if (request.abort !== null || request.queued || request.hydrating || request.state.status !== 'ready') this.requests.delete(id);
      else if (!knownHead(request.page)) request.state = { status: 'ready', result: request.state.result, cached: true, provisional: true };
    }
    this.running = 0;
  }

  get(page: ProviderPage, priority = false): ProviderDiffState {
    if (this.stopped || this.clearing) return { status: 'loading' };
    const key = providerDiffKey(page);
    let request = this.requests.get(key);
    if (request === undefined) {
      request = { key, page, state: { status: 'loading' }, at: 0, retryAt: 0, attempts: 0, abort: null, queued: false, hydrated: false, hydrating: false, priority, visit: this.visit, demandedAt: Date.now() };
    }
    this.requests.delete(key);
    this.requests.set(key, request);
    this.prune();
    request.priority ||= priority;
    if (priority && request.queued) {
      const queued = this.queue.indexOf(request);
      if (queued >= 0) this.queue.splice(queued, 1);
      this.queue.unshift(request);
    }
    request.visit = this.visit;
    request.demandedAt = Date.now();
    const cached = this.cache.get(page, priority);
    if (cached !== null && (request.state.status === 'loading' || request.state.status === 'failed' || (request.state.status === 'ready' && request.state.cached && cached.storedAt > request.at))) {
      request.state = { status: 'ready', result: cached.result, cached: true, ...(cached.exact ? {} : { provisional: true }) };
      request.at = cached.storedAt;
    }
    if (priority && request.state.status === 'ready' && request.state.provisional) request.state = { status: 'loading' };
    if (!this.stopped && !request.hydrated && !request.hydrating) {
      request.hydrating = true;
      const visit = this.visit;
      const current = request;
      void this.cache.load(page).catch(() => undefined).finally(() => {
        if (this.stopped || this.visit !== visit || this.requests.get(key) !== current) return;
        current.hydrating = false;
        current.hydrated = true;
        this.get(current.page, current.priority);
        if (this.active) this.changed();
      });
    }
    const ready = request.state.status === 'ready';
    const needsRefresh = !ready || (!knownHead(page) && (request.state.status !== 'ready' || (request.state.cached ? cached === null || !cached.fresh : Date.now() - request.at >= TTL_MS)));
    if (!this.stopped && request.hydrated && request.abort === null && !request.queued && Date.now() >= request.retryAt && needsRefresh) this.enqueue(request);
    return request.state;
  }

  async clearCache(): Promise<void> {
    if (this.stopped || this.clearing) return;
    const active = this.active;
    this.active = false;
    this.clearing = true;
    this.beginVisit(`cleared:${this.visit + 1}`);
    this.requests.clear();
    try { await this.cache.clear(); }
    finally {
      this.clearing = false;
      this.active = active;
      if (!this.stopped && this.active) this.changed();
    }
  }

  setActive(active: boolean): void {
    this.active = active;
    this.cancelTimer();
    if (active && !this.stopped) this.timer = setTimeout(() => { this.timer = null; this.pump(); }, 0);
  }

  stop(): void {
    this.stopped = true;
    this.visit += 1;
    this.cancelTimer();
    for (const request of this.requests.values()) request.abort?.abort();
    this.queue.length = 0;
    this.requests.clear();
    this.cache.stop();
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private prune(): void {
    for (const [key, request] of this.requests) {
      if (this.requests.size <= LIMIT) break;
      if (request.abort !== null) continue;
      this.requests.delete(key);
      const queued = this.queue.indexOf(request);
      if (queued >= 0) this.queue.splice(queued, 1);
    }
  }

  private enqueue(request: Request): void {
    request.queued = true;
    if (request.state.status === 'ready') request.state = { ...request.state, refreshing: true };
    if (request.priority) this.queue.unshift(request);
    else this.queue.push(request);
    this.pump();
  }

  private pump(): void {
    if (this.stopped || !this.active) return;
    const now = Date.now();
    for (const request of this.requests.values()) {
      if (request.visit === this.visit && request.attempts > 0 && request.abort === null && !request.queued && request.retryAt <= now && now - request.demandedAt <= TTL_MS) {
        request.queued = true;
        if (request.priority) this.queue.unshift(request); else this.queue.push(request);
      }
    }
    let next = Number.POSITIVE_INFINITY;
    let index = -1;
    for (let i = 0; i < this.queue.length; i += 1) {
      const request = this.queue[i];
      if (request === undefined || request.visit !== this.visit) continue;
      const lane = this.lanes.get(laneKey(request.page));
      const due = Math.max(request.retryAt, lane?.nextStart ?? 0, lane?.cooldownUntil ?? 0);
      next = Math.min(next, due);
      if (index < 0 && due <= now) index = i;
    }
    for (const request of this.requests.values()) {
      if (request.visit === this.visit && request.attempts > 0 && request.abort === null && !request.queued && now - request.demandedAt <= TTL_MS) next = Math.min(next, request.retryAt);
    }
    this.cancelTimer();
    if (this.running < 2 && index >= 0) {
      const request = this.queue.splice(index, 1)[0];
      if (request === undefined) return;
      request.queued = false;
      request.abort = new AbortController();
      const visit = this.visit;
      const laneId = laneKey(request.page);
      const lane = this.lanes.get(laneId) ?? { nextStart: 0, cooldownUntil: 0 };
      lane.nextStart = now + 750;
      this.lanes.set(laneId, lane);
      this.running += 1;
      const signal = request.abort.signal;
      void Promise.resolve().then(() => {
        if (this.stopped || this.visit !== visit || this.requests.get(request.key) !== request) throw new DOMException('Aborted', 'AbortError');
        return this.adapter.fetchDiff(request.page, signal);
      }).then((result) => {
        if (this.stopped || this.visit !== visit || this.requests.get(request.key) !== request) return;
        if (!result.complete) throw new Error('The provider returned an incomplete diff');
        request.state = { status: 'ready', result };
        request.at = Date.now();
        request.attempts = 0;
        request.retryAt = 0;
        this.cache.set(request.page, result);
      }).catch((error: unknown) => {
        if (this.stopped || this.visit !== visit || this.requests.get(request.key) !== request) return;
        request.attempts += 1;
        const retryAfter = providerRetryAfter(error);
        const message = error instanceof Error ? error.message : 'Diff unavailable';
        const reason: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'reason') : undefined;
        const rateLimited = reason === 'rate-limited' || /\b429\b|rate.limit/i.test(message);
        const delay = retryAfter !== null ? retryAfter + 2000 : rateLimited ? Math.min(60_000 * 2 ** (request.attempts - 1), 15 * 60_000) : RETRIES[Math.min(request.attempts - 1, RETRIES.length - 1)] ?? 45_000;
        if (retryAfter !== null || rateLimited) lane.cooldownUntil = Math.max(lane.cooldownUntil, Date.now() + delay);
        const definitive = !rateLimited && (reason === 'authentication' || reason === 'forbidden' || /Sign in to (?:GitLab|Bitbucket)|diff too large|HTTP (?:401|403|404)\b/i.test(message));
        request.retryAt = definitive || request.attempts >= 8 ? Number.POSITIVE_INFINITY : Date.now() + delay;
        request.state = request.state.status === 'ready' ? { status: 'ready', result: request.state.result, cached: true, provisional: true, refreshError: message } : { status: 'failed', reason: message };
      }).finally(() => {
        if (this.stopped || this.visit !== visit) return;
        request.abort = null;
        this.running -= 1;
        this.changed();
        this.pump();
      });
      this.pump();
      return;
    }
    if (Number.isFinite(next) && next > now) this.timer = setTimeout(() => { this.timer = null; this.pump(); }, Math.min(next - now, 2_147_000_000));
  }
}
