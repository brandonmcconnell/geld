/**
 * When each bot check run on the page began, and when it was seen to finish.
 *
 * The merge box shows a running check's start ("Started <relative-time>") and
 * nothing of the kind once it has finished ("Successful in 2m"). The start is
 * what tells a finished check's report from the summary of the run before it
 * (`verdictsFrom`, `RawCheckRun.startedAt`), so it is read while the row runs
 * and kept, per pull request, head and check, past the finish — in memory for
 * the visit and in `storage.local` so a reload in the seconds around the
 * finish does not lose it. The finish itself is the first pass that found the
 * row completed; the report's grace runs from there.
 *
 * Entries go when their head is no longer the pull request's (a push starts
 * every check over) and after a day regardless.
 */

import { storage } from 'wxt/utils/storage';
import type { RawCheckRun } from '@geld/review';

interface RunTimes {
  readonly startedAt: string;
  readonly completedAt?: string;
  /** For pruning: when the entry was last written, ms. */
  readonly at: number;
}

type RunMap = Record<string, RunTimes>;

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const runsItem = storage.defineItem<RunMap>('local:reviewRunStarts', { fallback: {} });

const memory = new Map<string, RunTimes>();
let loaded: Promise<void> | null = null;
let writeQueued = false;

function isRunTimes(value: unknown): value is RunTimes {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return typeof record.startedAt === 'string' && typeof record.at === 'number' && (record.completedAt === undefined || typeof record.completedAt === 'string');
}

/** Bring the stored entries into memory once; `onChange` re-applies when they land so a finished check gets its start. */
function load(onChange: () => void): void {
  if (loaded !== null) return;
  loaded = runsItem
    .getValue()
    .then((stored) => {
      const cutoff = Date.now() - MAX_AGE_MS;
      let any = false;
      for (const [key, value] of Object.entries(stored)) {
        if (!isRunTimes(value) || value.at < cutoff || memory.has(key)) continue;
        memory.set(key, value);
        any = true;
      }
      if (any) onChange();
    })
    .catch(() => undefined);
}

function persist(): void {
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    const cutoff = Date.now() - MAX_AGE_MS;
    const out: RunMap = {};
    for (const [key, value] of memory) if (value.at >= cutoff) out[key] = value;
    void runsItem.setValue(out).catch(() => undefined);
  }, 500);
}

/**
 * The check runs with their start and finish times filled in from what the
 * page shows now and what was remembered: a running row's "Started" time is
 * recorded; a completed row whose start is known gets the start back and,
 * the first time it is seen complete, the finish.
 */
export function withRunTimes(checks: readonly RawCheckRun[], pageKey: string, headSha: string, onChange: () => void): readonly RawCheckRun[] {
  load(onChange);
  if (pageKey === '' || headSha === '') return checks;
  const prefix = `${pageKey}|${headSha.toLowerCase()}|`;
  let changed = false;
  const now = Date.now();
  const out = checks.map((check) => {
    const key = `${prefix}${check.name}`;
    const known = memory.get(key);
    if (check.status !== 'completed') {
      if (check.startedAt !== undefined && known?.startedAt !== check.startedAt) {
        memory.set(key, { startedAt: check.startedAt, at: now });
        changed = true;
      }
      return check.startedAt === undefined && known !== undefined ? { ...check, startedAt: known.startedAt } : check;
    }
    if (known === undefined) return check;
    const completedAt = known.completedAt ?? new Date(now).toISOString();
    if (known.completedAt === undefined) {
      memory.set(key, { ...known, completedAt, at: now });
      changed = true;
    }
    return { ...check, startedAt: known.startedAt, completedAt };
  });
  if (changed) {
    // Another head's entries for this pull request are over: its checks start again on every push.
    const head = `${pageKey}|`;
    for (const key of [...memory.keys()]) if (key.startsWith(head) && !key.startsWith(prefix)) memory.delete(key);
    persist();
  }
  return out;
}

/** The grace a finished check's report is given runs from its finish: a pass is due when the earliest one ends. */
export function nextRunGraceEnd(checks: readonly RawCheckRun[], graceMs: number, now = Date.now()): number | null {
  let soonest: number | null = null;
  for (const check of checks) {
    if (check.status !== 'completed' || check.completedAt === undefined) continue;
    const end = Date.parse(check.completedAt) + graceMs;
    if (Number.isNaN(end) || end <= now) continue;
    soonest = soonest === null ? end : Math.min(soonest, end);
  }
  return soonest;
}
