export interface ProviderHttpRequest {
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly current?: () => boolean;
}
interface Job { readonly origin: string; readonly request: ProviderHttpRequest; readonly run: () => Promise<void>; readonly reject: (reason: unknown) => void; readonly order: number; cleanup(): void }
interface Lane { active: number; next: number; cooldown: number }
export interface ProviderHttpClock { now(): number; later(callback: () => void, delay: number): ReturnType<typeof setTimeout>; cancel(timer: ReturnType<typeof setTimeout>): void }
const clock: ProviderHttpClock = { now: () => Date.now(), later: (callback, delay) => setTimeout(callback, delay), cancel: (timer) => clearTimeout(timer) };

export class ProviderHttpAdmission {
  private readonly lanes = new Map<string, Lane>();
  private readonly jobs: Job[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private order = 0;
  constructor(private readonly time: ProviderHttpClock = clock, private readonly spacing = 750) {}

  paused(origin: string): boolean { return (this.lanes.get(origin)?.cooldown ?? 0) > this.time.now(); }

  run<T>(origin: string, request: ProviderHttpRequest, operation: () => Promise<T>): Promise<T> {
    if (new URL(origin).origin !== origin) return Promise.reject(new Error('Invalid provider HTTP origin'));
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => { const at = this.jobs.indexOf(job);if (at !== -1) { this.jobs.splice(at, 1);job.cleanup();reject(request.signal.reason ?? new DOMException('Aborted', 'AbortError'));this.pump(); } };
      const job: Job = { origin, request, run: async () => { resolve(await operation()); }, reject, order: this.order++, cleanup: () => request.signal.removeEventListener('abort', abort) };
      if (request.signal.aborted) { reject(request.signal.reason);return; }
      if (this.jobs.length >= 256) { reject(new Error('Provider HTTP queue is full'));return; }
      this.jobs.push(job);request.signal.addEventListener('abort', abort, { once: true });this.pump();
    });
  }

  private pump(): void {
    if (this.timer !== null) { this.time.cancel(this.timer);this.timer = null; }
    let delay = Number.POSITIVE_INFINITY;
    this.jobs.sort((a, b) => (a.request.priority ?? 1) - (b.request.priority ?? 1) || a.order - b.order);
    for (const job of [...this.jobs]) {
      let lane = this.lanes.get(job.origin);
      if (lane === undefined) { lane = { active: 0, next: 0, cooldown: 0 };this.lanes.set(job.origin, lane); }
      const now = this.time.now();
      if (job.request.signal.aborted || !this.current(job) || lane.cooldown > now) {
        this.jobs.splice(this.jobs.indexOf(job), 1);job.cleanup();
        job.reject(job.request.signal.aborted ? job.request.signal.reason : Object.assign(new Error(lane.cooldown > now ? 'Provider HTTP is cooling down' : 'Provider source selection changed'), lane.cooldown > now ? { retryAfterMs: lane.cooldown - now } : {}));continue;
      }
      if (lane.active >= 2) continue;
      if (lane.next > now) { delay = Math.min(delay, lane.next - now);continue; }
      this.jobs.splice(this.jobs.indexOf(job), 1);job.cleanup();lane.active++;lane.next = now + this.spacing;
      const admitted = lane;
      Promise.resolve().then(() => { job.request.signal.throwIfAborted();if (!this.current(job)) throw new Error('Provider source selection changed');return job.run(); })
        .catch((error: unknown) => { this.cooldown(admitted, error);job.reject(error); })
        .finally(() => { admitted.active--;this.pump(); });
    }
    if (Number.isFinite(delay)) this.timer = this.time.later(() => { this.timer = null;this.pump(); }, Math.max(0, delay));
  }

  private current(job: Job): boolean { try { return job.request.current?.() !== false; } catch { return false; } }

  private cooldown(lane: Lane, error: unknown): void {
    if (typeof error !== 'object' || error === null || Reflect.get(error, 'status') !== 429) return;
    const header: unknown = Reflect.get(error, 'retryAfter');
    const value = typeof header === 'string' ? header.trim() : '';
    const parsed = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - this.time.now();
    lane.cooldown = Math.max(lane.cooldown, this.time.now() + (Number.isFinite(parsed) && parsed >= 0 ? parsed : 60 * 60_000));
  }
}
