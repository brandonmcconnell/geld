/**
 * What Geld costs on this tab, kept in memory and nowhere else.
 *
 * `phase` times a named stretch of work: it lands as a `performance.measure`
 * (the Timings track of the DevTools Performance panel) and in a per-tab
 * table of count, total and worst case per phase, with the timestamps of the
 * last minute for a rate. `count` tallies events that have no duration (a
 * batch deferred in a hidden tab, a subsystem skipped by scope). The options
 * page's "Copy diagnostics" asks every GitHub tab for its `snapshot` and
 * appends them to the clipboard text; nothing is written to storage or sent
 * anywhere.
 */

interface PhaseStat {
  count: number;
  totalMs: number;
  maxMs: number;
  /** `performance.now()` of the phase's recent runs, pruned to the last minute. */
  recent: number[];
}

export interface PhaseSnapshot {
  readonly name: string;
  readonly count: number;
  readonly meanMs: number;
  readonly maxMs: number;
  readonly totalMs: number;
  /** Runs in the last minute. */
  readonly lastMinute: number;
}

/** One step of the content script's life on this tab: what happened and when, since the script started. */
export interface TrailMark {
  readonly atMs: number;
  readonly event: string;
}

export interface PerfSnapshot {
  /** Milliseconds since the tab's script started counting. */
  readonly uptimeMs: number;
  readonly hidden: boolean;
  readonly phases: readonly PhaseSnapshot[];
  readonly counters: Readonly<Record<string, number>>;
  /**
   * The script's lifecycle on this tab, oldest first: `script-start`,
   * `settings`, `catalog`, `controller-start`, the first `published`, and
   * how it ended if it did (`retired:takeover`, `retired:invalidated`,
   * `redirect-early`). A copy that never showed anything has a trail that
   * stops where it stopped, which is the whole point of keeping one.
   */
  readonly trail: readonly TrailMark[];
}

const RECENT_MS = 60_000;
/** Measures are dropped from the performance buffer in blocks so a long-lived tab does not accumulate them without bound. */
const MEASURES_KEPT = 500;

const phases = new Map<string, PhaseStat>();
const counters = new Map<string, number>();
const startedAt = performance.now();
/** Bounded: a long-lived tab repeats a few marks (every navigation publishes), and the first and last are what matter. */
const TRAIL_KEPT = 40;
const trail: TrailMark[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPhaseSnapshot(value: unknown): value is PhaseSnapshot {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.count === 'number' &&
    typeof value.meanMs === 'number' &&
    typeof value.maxMs === 'number' &&
    typeof value.totalMs === 'number' &&
    typeof value.lastMinute === 'number'
  );
}

function isTrailMark(value: unknown): value is TrailMark {
  return isRecord(value) && typeof value.atMs === 'number' && typeof value.event === 'string';
}

export function isPerfSnapshot(value: unknown): value is PerfSnapshot {
  return (
    isRecord(value) &&
    typeof value.uptimeMs === 'number' &&
    typeof value.hidden === 'boolean' &&
    Array.isArray(value.phases) &&
    value.phases.every(isPhaseSnapshot) &&
    isRecord(value.counters) &&
    Object.values(value.counters).every((entry) => typeof entry === 'number') &&
    Array.isArray(value.trail) &&
    value.trail.every(isTrailMark)
  );
}

function record(name: string, start: number, end: number): void {
  const ms = end - start;
  let stat = phases.get(name);
  if (stat === undefined) {
    stat = { count: 0, totalMs: 0, maxMs: 0, recent: [] };
    phases.set(name, stat);
  }
  stat.count += 1;
  stat.totalMs += ms;
  if (ms > stat.maxMs) stat.maxMs = ms;
  stat.recent.push(end);
  const cutoff = end - RECENT_MS;
  while (stat.recent.length > 0 && (stat.recent[0] ?? end) < cutoff) stat.recent.shift();
  const mark = `geld:${name}`;
  try {
    performance.measure(mark, { start, end });
    if (stat.count % MEASURES_KEPT === 0) performance.clearMeasures(mark);
  } catch {
    // An environment without user timing: the table above is still kept.
  }
}

/** Run `fn` as the phase `name`, timing it whether it returns or throws. */
export function phase<T>(name: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(name, start, performance.now());
  }
}

/** Record a stretch that began at `start` (a `performance.now()` taken earlier) and ends now, where a callback cannot wrap it. */
export function phaseSince(name: string, start: number): void {
  record(name, start, performance.now());
}

/** Tally an event with no duration of its own. */
export function count(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

/** Note a step of the script's life on this tab (see `PerfSnapshot.trail`). */
export function mark(event: string): void {
  trail.push({ atMs: Math.round(performance.now() - startedAt), event });
  // Keep the beginning (how the script came up) and the latest marks; the middle is navigations repeating.
  if (trail.length > TRAIL_KEPT) trail.splice(TRAIL_KEPT / 2, 1);
}

export function snapshot(): PerfSnapshot {
  const now = performance.now();
  const cutoff = now - RECENT_MS;
  return {
    uptimeMs: now - startedAt,
    hidden: typeof document !== 'undefined' && document.hidden,
    phases: [...phases.entries()].map(([name, stat]) => ({
      name,
      count: stat.count,
      meanMs: stat.count === 0 ? 0 : stat.totalMs / stat.count,
      maxMs: stat.maxMs,
      totalMs: stat.totalMs,
      lastMinute: stat.recent.filter((at) => at >= cutoff).length,
    })),
    counters: Object.fromEntries(counters),
    trail: [...trail],
  };
}

function fixed(value: number, digits = 1): string {
  return value.toFixed(digits);
}

/** Plain-text rendering for the clipboard, one tab per block. */
export function formatPerf(label: string, perf: PerfSnapshot): string {
  const minutes = Math.max(perf.uptimeMs / 60_000, 1 / 60);
  const lines = [`${label}${perf.hidden ? ' (hidden)' : ''}: up ${fixed(perf.uptimeMs / 1000, 0)}s`];
  const phasesSorted = [...perf.phases].sort((a, b) => b.totalMs - a.totalMs);
  for (const entry of phasesSorted) {
    lines.push(
      `  ${entry.name}: ${entry.count} runs (${fixed(entry.count / minutes)}/min, ${entry.lastMinute} in the last minute), mean ${fixed(entry.meanMs)}ms, max ${fixed(entry.maxMs)}ms, total ${fixed(entry.totalMs, 0)}ms`,
    );
  }
  const counterNames = Object.keys(perf.counters).sort();
  if (counterNames.length > 0) lines.push(`  counters: ${counterNames.map((name) => `${name}=${perf.counters[name] ?? 0}`).join(' ')}`);
  if (perf.trail.length > 0) lines.push(`  trail: ${perf.trail.map((entry) => `${entry.event}@${fixed(entry.atMs / 1000)}s`).join(' → ')}`);
  return lines.join('\n');
}
